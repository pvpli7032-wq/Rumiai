import {createCipheriv, createDecipheriv, randomBytes} from 'node:crypto';

function encryptionKey(){
  const raw=process.env.PAYMENT_MERCHANT_ENCRYPTION_KEY;
  if(!raw||!/^[0-9a-fA-F]{64}$/.test(raw))throw new Error('Payment merchant encryption key is not configured.');
  return Buffer.from(raw,'hex');
}

export function encryptMerchantValue(value:string){
  if(!value.trim()||value.length>12000)throw new Error('Payment merchant secret is invalid.');
  const nonce=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey(),nonce);
  const ciphertext=Buffer.concat([cipher.update(value,'utf8'),cipher.final()]);
  return {ciphertext:ciphertext.toString('base64'),nonce:nonce.toString('base64'),tag:cipher.getAuthTag().toString('base64')};
}

export function decryptMerchantValue(value:{ciphertext:string;nonce:string;tag:string}){
  const nonce=Buffer.from(value.nonce,'base64'),tag=Buffer.from(value.tag,'base64');
  if(nonce.length!==12||tag.length!==16)throw new Error('Payment merchant ciphertext is invalid.');
  const decipher=createDecipheriv('aes-256-gcm',encryptionKey(),nonce);decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(Buffer.from(value.ciphertext,'base64')),decipher.final()]).toString('utf8');
}
