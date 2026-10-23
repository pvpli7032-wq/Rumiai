import {db,pragmasReady} from '@rumiai/backend/infrastructure/database/client';
import {hasAdminPermission} from '@rumiai/backend/modules/admin/authorization';
import {recordAdminAudit} from '@rumiai/backend/modules/admin/management-service';
import {certificateValidity,probeTlsCertificate,type CertificateTarget} from './certificate-probe';

export class CertificateStatusError extends Error{
  constructor(message:string,readonly status=400){super(message);this.name='CertificateStatusError';}
}

/** Fixed operator configuration only; HTTP callers cannot select a connection destination. */
export function configuredCertificateTarget():CertificateTarget|null{
  try{const url=new URL(process.env.NEXT_PUBLIC_SITE_URL??'');if(url.protocol!=='https:'||url.username||url.password)return null;return{hostname:url.hostname.replace(/^\[|\]$/g,''),port:Number(url.port||443)};}catch{return null;}
}

async function requireRead(actor:string){if(!await hasAdminPermission(actor,'operations.read'))throw new CertificateStatusError('当前账号没有运维查看权限。',403);}

export async function readSiteCertificateStatus(actor:string){
  await requireRead(actor);
  const target=configuredCertificateTarget(),saved=await db.siteCertificateStatus.findUniqueOrThrow({where:{id:'primary'}});
  const matching=target&&saved.hostname===target.hostname&&saved.port===target.port;
  const lastCheck=matching&&saved.checkedAt?{...saved,status:['VALID','EXPIRING','EXPIRED','INVALID'].includes(saved.status)?certificateValidity(saved.validFrom,saved.validUntil,saved.verified):saved.status,remainingDays:saved.validUntil?Math.ceil((saved.validUntil.getTime()-Date.now())/86400000):null}:null;
  return{target,lastCheck};
}

export async function checkSiteCertificate(actor:string){
  await requireRead(actor);
  if(!await hasAdminPermission(actor,'operations.certificates.check'))throw new CertificateStatusError('当前账号没有证书检查权限。',403);
  const target=configuredCertificateTarget();
  if(!target)throw new CertificateStatusError('请先在服务器将站点地址配置为 HTTPS 域名。',409);
  const result=await probeTlsCertificate(target);
  await pragmasReady;
  await db.$transaction(async tx=>{
    await tx.$executeRaw`UPDATE users SET account_version=account_version WHERE id=${actor}`;
    if(!await hasAdminPermission(actor,'operations.read',tx)||!await hasAdminPermission(actor,'operations.certificates.check',tx))throw new CertificateStatusError('当前账号没有证书检查权限。',403);
    const before=await tx.siteCertificateStatus.findUniqueOrThrow({where:{id:'primary'}});
    await tx.siteCertificateStatus.update({where:{id:'primary'},data:result});
    await recordAdminAudit(tx,actor,'CHECK_SITE_CERTIFICATE','site-certificate:primary','检查当前站点 HTTPS 证书',{before,after:result});
  });
  return readSiteCertificateStatus(actor);
}
