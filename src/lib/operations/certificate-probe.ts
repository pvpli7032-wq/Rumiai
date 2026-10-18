import {connect,checkServerIdentity,type ConnectionOptions,type TLSSocket} from 'node:tls';
import {isIP} from 'node:net';

export type CertificateTarget={hostname:string;port:number};
export type CertificateObservation={
  hostname:string;port:number;status:'VALID'|'EXPIRING'|'EXPIRED'|'INVALID'|'UNAVAILABLE';verified:boolean;
  validFrom:Date|null;validUntil:Date|null;checkedAt:Date;errorCode:string|null;fingerprint256:string|null;
};

export function certificateValidity(validFrom:Date|null,validUntil:Date|null,verified:boolean,now=new Date()){
  if(!validFrom||!validUntil)return 'INVALID' as const;
  if(validUntil.getTime()<=now.getTime())return 'EXPIRED' as const;
  if(!verified||validFrom.getTime()>now.getTime())return 'INVALID' as const;
  return validUntil.getTime()-now.getTime()<=30*86400000?'EXPIRING' as const:'VALID' as const;
}

const safeCode=(value:unknown,fallback:string)=>typeof value==='string'&&/^[A-Z0-9_]{1,80}$/.test(value)?value:fallback;
function date(value:string|undefined){const timestamp=Date.parse(value??'');return Number.isFinite(timestamp)?new Date(timestamp):null;}

/** Observation-only TLS socket. Sends no HTTP or credentials; an untrusted peer is never reported as verified. */
export async function probeTlsCertificate(target:CertificateTarget,options:{ca?:ConnectionOptions['ca'];timeoutMs?:number}={}):Promise<CertificateObservation>{
  return new Promise(resolve=>{
    let socket:TLSSocket|undefined,finished=false;
    const finish=(observation:Omit<CertificateObservation,'hostname'|'port'|'checkedAt'>)=>{
      if(finished)return;finished=true;clearTimeout(timer);socket?.destroy();resolve({...target,...observation,checkedAt:new Date()});
    };
    const unavailable=(errorCode:string)=>finish({status:'UNAVAILABLE',verified:false,validFrom:null,validUntil:null,errorCode,fingerprint256:null});
    const timer=setTimeout(()=>unavailable('TLS_TIMEOUT'),options.timeoutMs??5000);
    try{
      socket=connect({host:target.hostname,port:target.port,servername:isIP(target.hostname)?undefined:target.hostname,rejectUnauthorized:false,...(options.ca?{ca:options.ca}:{})});
      socket.once('secureConnect',()=>{
        try{
        const certificate=socket!.getPeerCertificate();
        if(!certificate?.raw){finish({status:'INVALID',verified:false,validFrom:null,validUntil:null,errorCode:'TLS_CERTIFICATE_MISSING',fingerprint256:null});return;}
        const identityError=checkServerIdentity(target.hostname,certificate);
        const verified=socket!.authorized&&!identityError;
        const validFrom=date(certificate.valid_from),validUntil=date(certificate.valid_to);
        const errorCode=identityError?safeCode((identityError as NodeJS.ErrnoException).code,'TLS_HOSTNAME_MISMATCH'):!socket!.authorized?safeCode(socket!.authorizationError,'TLS_CERTIFICATE_INVALID'):!validFrom||!validUntil?'TLS_CERTIFICATE_INVALID':null;
        finish({status:certificateValidity(validFrom,validUntil,verified),verified,validFrom,validUntil,errorCode,fingerprint256:certificate.fingerprint256??null});
        }catch{finish({status:'INVALID',verified:false,validFrom:null,validUntil:null,errorCode:'TLS_CERTIFICATE_INVALID',fingerprint256:null});}
      });
      socket.once('error',error=>unavailable(safeCode((error as NodeJS.ErrnoException).code,'TLS_CONNECTION_FAILED')));
      socket.once('close',()=>{if(!finished)unavailable('TLS_CONNECTION_CLOSED');});
    }catch{unavailable('TLS_CONNECTION_FAILED');}
  });
}
