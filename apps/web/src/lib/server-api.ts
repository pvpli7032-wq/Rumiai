export class PublicApiError extends Error { constructor(readonly status:number, message:string){super(message);this.name='PublicApiError';} }
function origin(){return (process.env.INTERNAL_API_ORIGIN||'http://127.0.0.1:3012').replace(/\/$/,'');}
export async function fetchPublicApi<T>(pathname:string, options:{headers?:Record<string,string>}={}):Promise<T>{
  if(!pathname.startsWith('/')||pathname.startsWith('//')) throw new Error('Invalid internal API path');
  const response=await fetch(`${origin()}${pathname}`,{cache:'no-store',headers:{Accept:'application/json',...(options.headers??{})}}).catch(()=>null);
  if(!response) throw new PublicApiError(503,'Internal API unavailable');
  if(!response.ok) throw new PublicApiError(response.status,`Internal API ${response.status}`);
  return response.json() as Promise<T>;
}
export async function fetchPublicApiText(pathname:string):Promise<string>{
  if(!pathname.startsWith('/')||pathname.startsWith('//')) throw new Error('Invalid internal API path');
  const response=await fetch(`${origin()}${pathname}`,{cache:'no-store',headers:{Accept:'application/xml'}}).catch(()=>null);
  if(!response) throw new PublicApiError(503,'Internal API unavailable');
  if(!response.ok) throw new PublicApiError(response.status,`Internal API ${response.status}`);
  return response.text();
}
