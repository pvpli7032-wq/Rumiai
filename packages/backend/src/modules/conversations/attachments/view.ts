import {CHAT_STICKERS,type ChatMessageAttachment} from '@rumiai/contracts/api-types/conversations';
export const attachmentSelect={id:true,type:true,stickerId:true,stickerSnapshotJson:true,durationMs:true,mimeType:true,byteSize:true,uploadAsset:{select:{id:true,url:true}}} as const;
export function messageView<T extends {attachments:Array<{id:string;type:string;stickerId:string|null;stickerSnapshotJson?:string|null;durationMs?:number|null;mimeType:string|null;byteSize:number|null;uploadAsset:{url:string}|null}>}>(row:T){
 const attachments:ChatMessageAttachment[]=[];
 for(const item of row.attachments){
 if(item.type==='IMAGE'&&item.uploadAsset&&item.mimeType&&item.byteSize)attachments.push({id:item.id,type:'IMAGE',url:item.uploadAsset.url,mimeType:item.mimeType,byteSize:item.byteSize});
 else if(item.type==='AUDIO'&&item.uploadAsset&&item.mimeType&&item.byteSize)attachments.push({id:item.id,type:'AUDIO',url:item.uploadAsset.url,mimeType:item.mimeType,byteSize:item.byteSize,durationMs:item.durationMs??0});
 else if(item.type==='STICKER'&&item.stickerId){let snapshot:{label?:string;glyph?:string}|undefined;try{snapshot=JSON.parse(item.stickerSnapshotJson||'null')??undefined;}catch{}const fallback=CHAT_STICKERS.find(s=>s.id===item.stickerId);attachments.push({id:item.id,type:'STICKER',stickerId:item.stickerId,label:snapshot?.label??fallback?.label??'表情包',glyph:snapshot?.glyph??fallback?.glyph??'❔'});}
 }
 const {attachments:_raw,...message}=row;return {...message,attachments};
}
