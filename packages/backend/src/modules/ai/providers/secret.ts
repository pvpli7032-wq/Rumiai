import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto';

function encryptionKey(){
  const raw=process.env.AI_PROVIDER_ENCRYPTION_KEY;
  if(!raw||!/^[0-9a-fA-F]{64}$/.test(raw))throw new Error('AI provider encryption key is not configured.');
  return Buffer.from(raw,'hex');
}

export function encryptProviderSecret(secret:string){
  if(!secret.trim()||secret.length>4096)throw new Error('Provider secret is invalid.');
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),nonce);
  const ciphertext=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
  return {secretCiphertext:ciphertext.toString('base64'),secretNonce:nonce.toString('base64'),secretTag:cipher.getAuthTag().toString('base64')};
}

export function decryptProviderSecret(value:{secretCiphertext:string|null;secretNonce:string|null;secretTag:string|null}){
  if(!value.secretCiphertext||!value.secretNonce||!value.secretTag)throw new Error('Provider secret has not been configured.');
  const nonce=Buffer.from(value.secretNonce,'base64'),tag=Buffer.from(value.secretTag,'base64');
  if(nonce.length!==12||tag.length!==16)throw new Error('Provider secret ciphertext is invalid.');
  const decipher=createDecipheriv('aes-256-gcm',encryptionKey(),nonce);decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(value.secretCiphertext,'base64')),decipher.final()]).toString('utf8');
}

export function validateProviderBaseUrl(value:unknown){
  if(typeof value!=='string'||value.length>300)throw new Error('服务地址无效。');
  let url:URL;try{url=new URL(value.trim());}catch{throw new Error('服务地址必须是有效的 HTTPS 地址。');}
  const host=url.hostname.toLowerCase();
  if(url.protocol!=='https:'||url.username||url.password||url.search||url.hash||!host||host==='localhost'||host.endsWith('.localhost')||host.endsWith('.local')||host.includes(':')||/^\d{1,3}(\.\d{1,3}){3}$/.test(host))throw new Error('服务地址必须使用公开 HTTPS 域名，不能包含账号、查询参数或本机/IP 地址。');
  url.pathname=url.pathname.replace(/\/+$/,'');
  return url.toString().replace(/\/$/,'');
}
