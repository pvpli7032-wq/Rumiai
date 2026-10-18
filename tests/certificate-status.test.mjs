import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer as createTlsServer,createSecureContext} from 'node:tls';
import {createServer as createTcpServer} from 'node:net';
import {randomBytes} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {writeFileSync,rmSync} from 'node:fs';
import path from 'node:path';
import selfsigned from 'selfsigned';

const file=`certificate-status-${process.pid}-${Date.now()}.db`;
process.env.DATABASE_URL=`file:./${file}`;process.env.JWT_SECRET=randomBytes(48).toString('hex');process.env.MODERATOR_USER_IDS='';process.env.PAYMENT_ADMIN_USER_IDS='';process.env.NEXT_PUBLIC_SITE_URL='http://localhost:3000';
writeFileSync(path.resolve('prisma',file),'',{flag:'wx'});
const env={...process.env};delete env.RUST_LOG;const migration=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy'],{env,encoding:'utf8',windowsHide:true});assert.equal(migration.status,0,migration.stdout+migration.stderr);
const {db,pragmasReady}=await import('../src/lib/db.ts');await pragmasReady;
const {bootstrapOwner,saveOperator}=await import('../src/lib/admin/management-service.ts');
const {probeTlsCertificate}=await import('../src/lib/operations/certificate-probe.ts');
const {readSiteCertificateStatus,checkSiteCertificate}=await import('../src/lib/operations/certificate-service.ts');
const {GET,POST}=await import('../src/app/api/admin/operations/certificate/route.ts');
const {signToken}=await import('../src/lib/auth.ts');
test.after(async()=>{await db.$disconnect();for(const suffix of ['','-wal','-shm','-journal'])rmSync(path.resolve('prisma',file+suffix),{force:true});});

async function certificate(hostname='localhost',days=90,starts=-60000){
  return selfsigned.generate([{name:'commonName',value:hostname}],{keyType:'ec',algorithm:'sha256',notBeforeDate:new Date(Date.now()+starts),notAfterDate:new Date(Date.now()+days*86400000)});
}
async function listen(server,names=[]){
  const sockets=new Set();
  server.on('connection',socket=>{sockets.add(socket);socket.once('close',()=>sockets.delete(socket));});
  server.on('tlsClientError',()=>{});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(0,resolve);});
  return {target:{hostname:'localhost',port:server.address().port},names,close:async()=>{for(const socket of sockets)socket.destroy();await new Promise(resolve=>server.close(resolve));}};
}
async function tlsFixture(pems){
  const names=[],context=createSecureContext({key:pems.private,cert:pems.cert});
  return listen(createTlsServer({key:pems.private,cert:pems.cert,SNICallback:(name,callback)=>{names.push(name);callback(null,context);}}),names);
}

test('real local TLS probes validate trust, hostname, expiry and SNI without exporting private keys',async()=>{
  const valid=await certificate();const fixture=await tlsFixture(valid);
  try{
    const trusted=await probeTlsCertificate(fixture.target,{ca:valid.cert});assert.equal(trusted.status,'VALID');assert.equal(trusted.verified,true);assert(trusted.validUntil instanceof Date);assert(trusted.fingerprint256);assert.equal(trusted.errorCode,null);
    const untrusted=await probeTlsCertificate(fixture.target);assert.equal(untrusted.status,'INVALID');assert.equal(untrusted.verified,false);assert(untrusted.errorCode);assert.equal(untrusted.fingerprint256,trusted.fingerprint256);
    await new Promise(resolve=>setImmediate(resolve));assert(fixture.names.every(name=>name==='localhost'));assert(fixture.names.length>0);assert(!JSON.stringify(trusted).includes('PRIVATE KEY'));
  }finally{await fixture.close();}
  for(const [pems,expected] of [[await certificate('wrong.example.invalid'),'INVALID'],[await certificate('localhost',5),'EXPIRING'],[await certificate('localhost',-1,-2*86400000),'EXPIRED'],[await certificate('localhost',2,86400000),'INVALID']]){
    const server=await tlsFixture(pems);try{const result=await probeTlsCertificate(server.target,{ca:pems.cert});assert.equal(result.status,expected);if(expected!=='EXPIRING')assert.equal(result.verified,false);}finally{await server.close();}
  }
});

test('a stalled TLS handshake times out and releases the owned connection',async()=>{
  const server=await listen(createTcpServer());try{const result=await probeTlsCertificate(server.target,{timeoutMs:100});assert.equal(result.status,'UNAVAILABLE');assert.equal(result.errorCode,'TLS_TIMEOUT');assert.equal(result.verified,false);}finally{await server.close();}
});

test('certificate API checks only the configured site, enforces permissions and records safe metadata/audit',async()=>{
  const users=[];for(const name of ['owner','manager','viewer','ordinary'])users.push(await db.user.create({data:{username:`certificate_${name}`,email:`certificate-${name}@example.invalid`,passwordHash:'synthetic-only'}}));const [owner,manager,viewer,ordinary]=users;await bootstrapOwner(owner.email);
  for(const [user,code] of [[manager,'OPERATIONS_MANAGER'],[viewer,'OPERATIONS_VIEWER']]){const role=await db.adminRole.findUniqueOrThrow({where:{code}});await saveOperator(owner.id,{userId:user.id,enabled:true,roleIds:[role.id],version:0,reason:'证书权限隔离测试'});}
  assert.deepEqual(await readSiteCertificateStatus(viewer.id),{target:null,lastCheck:null});await assert.rejects(()=>checkSiteCertificate(manager.id),error=>error.status===409);await assert.rejects(()=>readSiteCertificateStatus(ordinary.id),error=>error.status===403);
  const pems=await certificate(),server=await tlsFixture(pems);
  try{
    process.env.NEXT_PUBLIC_SITE_URL=`https://localhost:${server.target.port}`;
    const viewerToken=await signToken({userId:viewer.id,email:viewer.email}),managerToken=await signToken({userId:manager.id,email:manager.email});
    assert.equal((await GET(new Request('http://local.test/api/admin/operations/certificate'))).status,401);
    assert.equal((await GET(new Request('http://local.test/api/admin/operations/certificate',{headers:{Authorization:`Bearer ${viewerToken}`}}))).status,200);assert.equal(server.names.length,0,'reading saved status must not connect');
    assert.equal((await POST(new Request('http://local.test/api/admin/operations/certificate',{method:'POST',headers:{Authorization:`Bearer ${viewerToken}`}}))).status,403);assert.equal(server.names.length,0);
    const response=await POST(new Request('http://local.test/api/admin/operations/certificate',{method:'POST',headers:{Authorization:`Bearer ${managerToken}`,'Content-Type':'application/json'},body:JSON.stringify({url:'https://arbitrary-target.example.invalid'})}));assert.equal(response.status,200);
    const result=await response.json();assert.deepEqual(result.target,server.target);assert.equal(result.lastCheck.status,'INVALID');assert.equal(result.lastCheck.verified,false);assert(result.lastCheck.validUntil);assert(result.lastCheck.checkedAt);
    const audit=await db.adminAuditLog.findMany({where:{action:'CHECK_SITE_CERTIFICATE'}});assert.equal(audit.length,1);assert(!JSON.stringify(audit).includes('BEGIN'));assert(!JSON.stringify(result).includes(pems.private));
    await db.siteCertificateStatus.update({where:{id:'primary'},data:{status:'VALID',verified:true,validUntil:new Date(Date.now()-1000)}});assert.equal((await readSiteCertificateStatus(viewer.id)).lastCheck.status,'EXPIRED');
    process.env.NEXT_PUBLIC_SITE_URL='https://changed.example.invalid';assert.equal((await readSiteCertificateStatus(viewer.id)).lastCheck,null);
  }finally{process.env.NEXT_PUBLIC_SITE_URL='http://localhost:3000';await server.close();}
});
