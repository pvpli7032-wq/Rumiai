import type {Prisma} from '@prisma/client';
import {db} from '@/lib/db';
import {hasAdminPermission} from '@/lib/admin/authorization';
import {recordAdminAudit} from '@/lib/admin/management-service';

type Tx=Prisma.TransactionClient;
type PolicyInput={ageGateEnabled:boolean;minimumAge:number|null;agePolicyVersion:string|null;termsVersion:string|null;privacyVersion:string|null;version:number;reason:string};

export class CompliancePolicyError extends Error {
  constructor(message:string,readonly status=400){super(message);this.name='CompliancePolicyError';}
}
export class RegistrationConsentError extends Error {
  constructor(message:string){super(message);this.name='RegistrationConsentError';}
}

const fallback={id:'primary',ageGateEnabled:false,minimumAge:null,agePolicyVersion:null,termsVersion:null,privacyVersion:null,version:0,updatedAt:null};
function version(value:unknown,label:string):string|null{
  if(value===null||value===undefined||value==='')return null;
  if(typeof value!=='string'||value.trim().length>80||!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(value.trim()))throw new CompliancePolicyError(`${label}格式无效，只能使用字母、数字、点、下划线和连字符。`);
  return value.trim();
}
function normalizePolicy(input:unknown):Omit<PolicyInput,'version'|'reason'>{
  if(!input||typeof input!=='object'||Array.isArray(input))throw new CompliancePolicyError('合规策略数据格式不正确。');
  const row=input as Record<string,unknown>;
  if(typeof row.ageGateEnabled!=='boolean')throw new CompliancePolicyError('年龄确认开关无效。');
  let minimumAge:number|null=null;
  if(row.minimumAge!==null&&row.minimumAge!==undefined&&row.minimumAge!==''){
    if(typeof row.minimumAge!=='number'||!Number.isSafeInteger(row.minimumAge)||row.minimumAge<1||row.minimumAge>120)throw new CompliancePolicyError('最低年龄须为 1–120 的整数。');
    minimumAge=row.minimumAge;
  }
  const agePolicyVersion=version(row.agePolicyVersion,'年龄政策版本');
  const termsVersion=version(row.termsVersion,'服务条款版本');
  const privacyVersion=version(row.privacyVersion,'隐私政策版本');
  if(row.ageGateEnabled&&(!minimumAge||!agePolicyVersion))throw new CompliancePolicyError('启用年龄确认前，必须配置最低年龄和年龄政策版本。');
  return {ageGateEnabled:row.ageGateEnabled,minimumAge,agePolicyVersion,termsVersion,privacyVersion};
}
function publicProjection(policy:typeof fallback|Awaited<ReturnType<Tx['compliancePolicy']['findUnique']>>){
  return {ageGate:{enabled:policy?.ageGateEnabled??false,minimumAge:policy?.ageGateEnabled?policy.minimumAge:null,version:policy?.ageGateEnabled?policy.agePolicyVersion:null},termsVersion:policy?.termsVersion??null,privacyVersion:policy?.privacyVersion??null};
}

/** Public registration requirements contain version identifiers only, never legal text or user data. */
export async function readRegistrationPolicy(){
  const policy=await db.compliancePolicy.findUnique({where:{id:'primary'}});
  return publicProjection(policy);
}

/** Called by account registration inside its user-creation transaction. */
export async function recordRegistrationConsents(tx:Tx,userId:string,input:unknown){
  const policy=await tx.compliancePolicy.findUnique({where:{id:'primary'}});
  if(!policy)return;
  if(input!==undefined&&(!input||typeof input!=='object'||Array.isArray(input)))throw new RegistrationConsentError('注册确认数据无效。');
  const consent=(input??{}) as Record<string,unknown>;
  const records:Array<{policyType:string;policyVersion:string}> = [];
  if(policy.ageGateEnabled){
    if(consent.ageConfirmed!==true)throw new RegistrationConsentError(`请确认已达到 ${policy.minimumAge} 周岁。`);
    if(!policy.minimumAge||!policy.agePolicyVersion)throw new RegistrationConsentError('年龄确认策略尚未完整配置，请联系管理员。');
    records.push({policyType:'AGE',policyVersion:policy.agePolicyVersion});
  }
  if(policy.termsVersion){if(consent.termsAccepted!==true)throw new RegistrationConsentError('请先阅读并接受服务条款。');records.push({policyType:'TERMS',policyVersion:policy.termsVersion});}
  if(policy.privacyVersion){if(consent.privacyAccepted!==true)throw new RegistrationConsentError('请先阅读并接受隐私政策。');records.push({policyType:'PRIVACY',policyVersion:policy.privacyVersion});}
  for(const row of records)await tx.userConsent.create({data:{userId,...row,source:'REGISTER'}});
}

export async function readCompliancePolicy(actor:string){
  return db.$transaction(async tx=>{
    if(!await hasAdminPermission(actor,'compliance.read',tx))throw new CompliancePolicyError('当前账号没有合规设置查看权限。',403);
    const policy=await tx.compliancePolicy.findUnique({where:{id:'primary'}});
    const consentCounts=await tx.userConsent.groupBy({by:['policyType','policyVersion'],_count:{_all:true},orderBy:[{policyType:'asc'},{policyVersion:'asc'}]});
    return {policy:policy??fallback,consentCounts:consentCounts.map(row=>({policyType:row.policyType,policyVersion:row.policyVersion,count:row._count._all}))};
  });
}

export async function saveCompliancePolicy(actor:string,input:unknown){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new CompliancePolicyError('合规设置数据格式不正确。');
  const row=input as Record<string,unknown>;
  if(typeof row.reason!=='string'||!row.reason.trim()||row.reason.trim().length>500)throw new CompliancePolicyError('请填写 1–500 字变更理由。');
  const reason=row.reason.trim();
  if(!Number.isSafeInteger(row.version)||Number(row.version)<0)throw new CompliancePolicyError('版本信息无效，请刷新后重试。');
  const normalized=normalizePolicy(row);
  return db.$transaction(async tx=>{
    if(!await hasAdminPermission(actor,'compliance.manage',tx))throw new CompliancePolicyError('当前账号没有合规设置管理权限。',403);
    const before=await tx.compliancePolicy.findUnique({where:{id:'primary'}});
    const currentVersion=before?.version??0;
    if(currentVersion!==row.version)throw new CompliancePolicyError('合规设置已被其他管理员修改，请刷新后重试。',409);
    const saved=await tx.compliancePolicy.upsert({where:{id:'primary'},create:{id:'primary',...normalized,version:currentVersion+1},update:{...normalized,version:currentVersion+1}});
    await recordAdminAudit(tx,actor,'UPDATE_COMPLIANCE_POLICY','compliance-policy:primary',reason,{before:before?{ageGateEnabled:before.ageGateEnabled,minimumAge:before.minimumAge,agePolicyVersion:before.agePolicyVersion,termsVersion:before.termsVersion,privacyVersion:before.privacyVersion,version:before.version}:null,after:{ageGateEnabled:saved.ageGateEnabled,minimumAge:saved.minimumAge,agePolicyVersion:saved.agePolicyVersion,termsVersion:saved.termsVersion,privacyVersion:saved.privacyVersion,version:saved.version}});
    return saved;
  });
}
