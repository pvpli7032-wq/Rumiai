import {createHash} from 'node:crypto';
import type {Prisma} from '@prisma/client';
import {db,pragmasReady} from '@/lib/db';
import {hasAdminPermission} from '@/lib/admin/authorization';

export class StatementReconciliationError extends Error{
  constructor(message:string,readonly status:number=400){super(message);this.name='StatementReconciliationError';}
}

type InputRow={lineNumber:number;providerTradeNo:string;orderNo:string;grossCnyCents:number;feeCnyCents:number;paidAt:Date};
type ReconciliationOrder={id:string;orderNo:string;providerTradeNo:string|null;provider:string;currency:string;status:string;amountCnyCents:number};
const HEADER=['trade_no','out_trade_no','money','fee','paid_at','status'];
const MATCH_LABELS:Record<string,string>={
  MATCHED:'已匹配',ORDER_NOT_FOUND:'本地订单不存在',PROVIDER_MISMATCH:'支付渠道不匹配',ORDER_NUMBER_MISMATCH:'商户订单号不匹配',TRADE_NUMBER_MISMATCH:'渠道交易号不匹配',AMOUNT_MISMATCH:'订单金额不匹配',PAYMENT_STATUS_MISMATCH:'本地订单未确认支付',IDENTITY_CONFLICT:'订单号与渠道交易号指向不同记录',MISSING_IN_STATEMENT:'本地已支付订单未出现在渠道账单',
};

function assertReason(value:unknown){if(typeof value!=='string'||!value.trim()||value.trim().length>300)throw new StatementReconciliationError('请填写 1–300 字导入原因。');return value.trim();}

function csvRows(raw:string){
  if(raw.length>2*1024*1024)throw new StatementReconciliationError('CSV 文件不能超过2MB。');
  if(raw.includes('\0'))throw new StatementReconciliationError('CSV 含有无效字符。');
  const source=raw.replace(/^\uFEFF/,'');let rows:string[][]=[],row:string[]=[],field='',quoted=false,afterQuote=false;
  const endField=()=>{row.push(field);field='';afterQuote=false;};
  const endRow=()=>{endField();if(row.some(value=>value.trim()!==''))rows.push(row);row=[];};
  for(let index=0;index<source.length;index++){
    const char=source[index];
    if(quoted){
      if(char==='"'){
        if(source[index+1]==='"'){field+='"';index++;}
        else{quoted=false;afterQuote=true;}
      }else field+=char;
      continue;
    }
    if(afterQuote){
      if(char===' '||char==='\t')continue;
      if(char===','){endField();continue;}
      if(char==='\r'||char==='\n'){if(char==='\r'&&source[index+1]==='\n')index++;endRow();continue;}
      throw new StatementReconciliationError('CSV 引号后的字段格式无效。');
    }
    if(char==='"'){
      if(field.length)throw new StatementReconciliationError('CSV 引号位置无效。');
      quoted=true;continue;
    }
    if(char===','){endField();continue;}
    if(char==='\r'||char==='\n'){if(char==='\r'&&source[index+1]==='\n')index++;endRow();continue;}
    field+=char;
  }
  if(quoted)throw new StatementReconciliationError('CSV 引号未闭合。');
  if(field.length||row.length)endRow();
  return rows;
}

function cents(value:string,line:number,column:string){
  const match=/^(\d{1,9})(?:\.(\d{1,2}))?$/.exec(value.trim());
  if(!match)throw new StatementReconciliationError(`第 ${line} 行 ${column} 必须是最多两位小数的正人民币金额。`);
  const cents=Number(match[1])*100+Number((match[2]??'').padEnd(2,'0')||'0');
  if(!Number.isSafeInteger(cents)||cents<0||cents>2_000_000_000)throw new StatementReconciliationError(`第 ${line} 行 ${column} 超出支持范围。`);
  return cents;
}

function parseStatement(rawInput:unknown){
  if(typeof rawInput!=='string'||!rawInput.trim())throw new StatementReconciliationError('请选择包含对账数据的 CSV 文件。');
  const rows=csvRows(rawInput);if(rows.length<2)throw new StatementReconciliationError('CSV 至少需要表头和一笔支付记录。');
  const headers=rows[0].map(value=>value.trim().toLowerCase());
  if(headers.length!==HEADER.length||headers.some((value,index)=>value!==HEADER[index]))throw new StatementReconciliationError(`CSV 表头必须依次为：${HEADER.join(',')}。`);
  const data=rows.slice(1);if(data.length>5000)throw new StatementReconciliationError('单次最多导入5000笔支付记录。');
  const orderNos=new Set<string>(),tradeNos=new Set<string>();
  const parsed=data.map((values,index)=>{
    const line=index+2;if(values.length!==HEADER.length)throw new StatementReconciliationError(`第 ${line} 行列数不正确。`);
    const [tradeRaw,orderRaw,moneyRaw,feeRaw,paidRaw,statusRaw]=values.map(value=>value.trim());
    const providerTradeNo=tradeRaw,orderNo=orderRaw;
    if(!/^[A-Za-z0-9_-]{1,100}$/.test(providerTradeNo))throw new StatementReconciliationError(`第 ${line} 行渠道交易号格式无效。`);
    if(!/^[A-Z0-9]{20,40}$/.test(orderNo))throw new StatementReconciliationError(`第 ${line} 行商户订单号格式无效。`);
    if(orderNos.has(orderNo)||tradeNos.has(providerTradeNo))throw new StatementReconciliationError(`第 ${line} 行订单号或渠道交易号重复。`);
    orderNos.add(orderNo);tradeNos.add(providerTradeNo);
    if(!['PAID','TRADE_SUCCESS','1'].includes(statusRaw))throw new StatementReconciliationError(`第 ${line} 行状态必须表示支付成功。`);
    const grossCnyCents=cents(moneyRaw,line,'money'),feeCnyCents=cents(feeRaw,line,'fee');
    if(grossCnyCents<1||feeCnyCents>grossCnyCents)throw new StatementReconciliationError(`第 ${line} 行金额或手续费范围无效。`);
    if(!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(paidRaw)||!Number.isFinite(Date.parse(paidRaw)))throw new StatementReconciliationError(`第 ${line} 行 paid_at 必须包含时区的 ISO 8601 时间。`);
    return {lineNumber:line,providerTradeNo,orderNo,grossCnyCents,feeCnyCents,paidAt:new Date(paidRaw)};
  });
  if(!parsed.length)throw new StatementReconciliationError('CSV 没有可导入的支付记录。');
  const grossTotal=parsed.reduce((sum,row)=>sum+row.grossCnyCents,0),feeTotal=parsed.reduce((sum,row)=>sum+row.feeCnyCents,0);
  if(!Number.isSafeInteger(grossTotal)||!Number.isSafeInteger(feeTotal))throw new StatementReconciliationError('本批金额合计超过支持范围。');
  return {rows:parsed,grossTotal,feeTotal};
}

function parsePeriod(value:unknown,label:string){if(typeof value!=='string'||!/^\d{4}-\d{2}-\d{2}T.*(?:Z|[+-]\d{2}:\d{2})$/.test(value)||!Number.isFinite(Date.parse(value)))throw new StatementReconciliationError(`${label} 必须是包含时区的 ISO 8601 时间。`);return new Date(value);}

async function requirePermission(actorId:string,permission:'finance.read'|'finance.reconciliation.import',tx?:Prisma.TransactionClient){
  if(!await hasAdminPermission(actorId,permission,tx))throw new StatementReconciliationError('当前账号没有渠道对账权限。',403);
}

function batchView(batch:{id:string;provider:string;sourceSha256:string;importedById:string;importReason:string;rowCount:number;matchedRowCount:number;exceptionRowCount:number;grossCnyCents:bigint;feeCnyCents:bigint;periodStart:Date;periodEnd:Date;createdAt:Date},duplicate=false){
  const {sourceSha256,...publicBatch}=batch;
  return {...publicBatch,grossCnyCents:Number(batch.grossCnyCents),feeCnyCents:Number(batch.feeCnyCents),netCnyCents:Number(batch.grossCnyCents-batch.feeCnyCents),createdAt:batch.createdAt.toISOString(),periodStart:batch.periodStart.toISOString(),periodEnd:batch.periodEnd.toISOString(),duplicate};
}

export async function listPaymentReconciliationBatches(actorId:string){
  await pragmasReady;await requirePermission(actorId,'finance.read');
  const batches=await db.paymentReconciliationBatch.findMany({orderBy:[{createdAt:'desc'},{id:'desc'}],take:30});
  return {batches:batches.map(batch=>batchView(batch)),matchLabels:MATCH_LABELS};
}

export async function readPaymentReconciliationBatch(actorId:string,id:string,input:{page?:unknown;pageSize?:unknown}){
  await pragmasReady;await requirePermission(actorId,'finance.read');
  if(!/^[A-Za-z0-9_-]{1,100}$/.test(id))throw new StatementReconciliationError('对账批次编号无效。');
  const page=input.page===undefined?1:Number(input.page),pageSize=input.pageSize===undefined?25:Number(input.pageSize);
  if(!Number.isInteger(page)||page<1||!Number.isInteger(pageSize)||pageSize<1||pageSize>100)throw new StatementReconciliationError('分页参数无效。');
  const batch=await db.paymentReconciliationBatch.findUnique({where:{id}});if(!batch)throw new StatementReconciliationError('对账批次不存在。',404);
  const [total,entries]=await Promise.all([
    db.paymentReconciliationEntry.count({where:{batchId:id}}),
    db.paymentReconciliationEntry.findMany({where:{batchId:id},orderBy:[{entrySource:'desc'},{lineNumber:'asc'}],skip:(page-1)*pageSize,take:pageSize,select:{entrySource:true,lineNumber:true,providerTradeNo:true,orderNo:true,grossCnyCents:true,feeCnyCents:true,paidAt:true,matchStatus:true,exceptionCode:true,internalAmountCnyCents:true,internalOrderStatus:true}}),
  ]);
  return {batch:batchView(batch),page,pageSize,total,entries:entries.map(entry=>({...entry,netCnyCents:entry.grossCnyCents===null||entry.feeCnyCents===null?null:entry.grossCnyCents-entry.feeCnyCents,paidAt:entry.paidAt.toISOString(),matchLabel:MATCH_LABELS[entry.matchStatus]??entry.matchStatus}))};
}

export async function importPaymentStatement(actorId:string,input:unknown){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new StatementReconciliationError('导入请求格式无效。');
  const body=input as Record<string,unknown>,reason=assertReason(body.reason),statement=parseStatement(body.csv),periodStart=parsePeriod(body.periodStart,'核对开始时间'),periodEnd=parsePeriod(body.periodEnd,'核对结束时间');
  if(periodStart>=periodEnd||statement.rows.some(row=>row.paidAt<periodStart||row.paidAt>periodEnd))throw new StatementReconciliationError('核对时间范围无效，且必须完整覆盖 CSV 中的支付时间。');
  const sourceSha256=createHash('sha256').update(JSON.stringify({csvHash:createHash('sha256').update(body.csv as string,'utf8').digest('hex'),periodStart:periodStart.toISOString(),periodEnd:periodEnd.toISOString()}),'utf8').digest('hex');
  await pragmasReady;await requirePermission(actorId,'finance.reconciliation.import');
  const existing=await db.paymentReconciliationBatch.findUnique({where:{sourceSha256}});
  if(existing)return {...batchView(existing,true),created:false};

  const orderByNo=new Map<string,ReconciliationOrder>(),orderByTrade=new Map<string,ReconciliationOrder>();
  for(let offset=0;offset<statement.rows.length;offset+=300){
    const chunk=statement.rows.slice(offset,offset+300);
    const orders=await db.paymentOrder.findMany({where:{OR:[{orderNo:{in:chunk.map(row=>row.orderNo)}},{providerTradeNo:{in:chunk.map(row=>row.providerTradeNo)}}]},select:{id:true,orderNo:true,providerTradeNo:true,provider:true,currency:true,status:true,amountCnyCents:true}});
    for(const order of orders){orderByNo.set(order.orderNo,order);if(order.providerTradeNo)orderByTrade.set(order.providerTradeNo,order);}
  }
  const mapped=statement.rows.map(row=>{
    const byNo=orderByNo.get(row.orderNo),byTrade=orderByTrade.get(row.providerTradeNo),order=byNo??byTrade;
    let matchStatus='MATCHED',exceptionCode:string|null=null;
    if(byNo&&byTrade&&byNo.id!==byTrade.id){matchStatus='IDENTITY_CONFLICT';exceptionCode='identity_conflict';}
    else if(!order){matchStatus='ORDER_NOT_FOUND';exceptionCode='order_not_found';}
    else if(order.provider!=='EZFP'||order.currency!=='CNY'){matchStatus='PROVIDER_MISMATCH';exceptionCode='provider_or_currency_mismatch';}
    else if(order.orderNo!==row.orderNo){matchStatus='ORDER_NUMBER_MISMATCH';exceptionCode='order_no_mismatch';}
    else if(order.providerTradeNo!==row.providerTradeNo){matchStatus='TRADE_NUMBER_MISMATCH';exceptionCode='trade_no_mismatch';}
    else if(!['PAID','REFUND_PENDING','REFUNDED'].includes(order.status)){matchStatus='PAYMENT_STATUS_MISMATCH';exceptionCode='internal_status_not_paid';}
    else if(order.amountCnyCents!==row.grossCnyCents){matchStatus='AMOUNT_MISMATCH';exceptionCode='amount_mismatch';}
    return {...row,paymentOrderId:order?.id??null,internalAmountCnyCents:order?.amountCnyCents??null,internalOrderStatus:order?.status??null,matchStatus,exceptionCode};
  });
  const localOrders=await db.paymentOrder.findMany({where:{provider:'EZFP',currency:'CNY',status:{in:['PAID','REFUND_PENDING','REFUNDED']},paidAt:{gte:periodStart,lte:periodEnd}},take:5001,select:{id:true,orderNo:true,providerTradeNo:true,status:true,amountCnyCents:true,paidAt:true}});
  if(localOrders.length>5000)throw new StatementReconciliationError('时间范围内本地支付订单超过5000笔，请缩短时间范围分批核对。');
  const seenOrderIds=new Set(mapped.map(row=>row.paymentOrderId).filter((id):id is string=>id!==null));
  const missing=localOrders.filter(order=>!seenOrderIds.has(order.id)).map(order=>({entrySource:'LOCAL_MISSING',lineNumber:null,providerTradeNo:order.providerTradeNo,orderNo:order.orderNo,grossCnyCents:null,feeCnyCents:null,paidAt:order.paidAt??periodStart,matchStatus:'MISSING_IN_STATEMENT',exceptionCode:'missing_in_statement',paymentOrderId:order.id,internalAmountCnyCents:order.amountCnyCents,internalOrderStatus:order.status}));
  const allRows=[...mapped,...missing];
  const matchedRowCount=mapped.filter(row=>row.matchStatus==='MATCHED').length;
  try{
    const batch=await db.$transaction(async tx=>{
      await tx.$executeRaw`UPDATE admin_operators SET version = version WHERE user_id = ${actorId}`;
      await requirePermission(actorId,'finance.reconciliation.import',tx);
      const created=await tx.paymentReconciliationBatch.create({data:{provider:'EZFP',sourceSha256,importedById:actorId,importReason:reason,rowCount:allRows.length,matchedRowCount,exceptionRowCount:allRows.length-matchedRowCount,grossCnyCents:BigInt(statement.grossTotal),feeCnyCents:BigInt(statement.feeTotal),periodStart,periodEnd}});
      await tx.paymentReconciliationEntry.createMany({data:allRows.map(row=>({...row,batchId:created.id}))});
      return created;
    },{maxWait:10_000,timeout:15_000});
    return {...batchView(batch),created:true};
  }catch(error){
    if(typeof error==='object'&&error!==null&&'code'in error&&error.code==='P2002'){
      const duplicate=await db.paymentReconciliationBatch.findUnique({where:{sourceSha256}});
      if(duplicate)return {...batchView(duplicate,true),created:false};
    }
    throw error;
  }
}
