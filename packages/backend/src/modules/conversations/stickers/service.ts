import {db} from '@rumiai/backend/infrastructure/database/client';
import {hasAdminPermission} from '@rumiai/backend/modules/admin/authorization';
import {recordAdminAudit} from '@rumiai/backend/modules/admin/management-service';
export class StickerError extends Error {constructor(message:string,public status=400){super(message);}}
const select={id:true,label:true,glyph:true,isActive:true,sortOrder:true,version:true} as const;
export async function readStickers(){return db.chatSticker.findMany({where:{isActive:true},select:{id:true,label:true,glyph:true},orderBy:[{sortOrder:'asc'},{id:'asc'}]});}
export async function readManagedStickers(actorId:string){if(!await hasAdminPermission(actorId,'settings.read'))throw new StickerError('没有查看权限。',403);return db.chatSticker.findMany({select,orderBy:[{sortOrder:'asc'},{id:'asc'}]});}
export async function saveSticker(actorId:string,input:unknown,remove=false){
 if(!input||typeof input!=='object'||Array.isArray(input))throw new StickerError('表情包格式无效。');
 const b=input as Record<string,unknown>;
 if(typeof b.id!=='string'||!/^[a-z0-9_-]{1,64}$/.test(b.id))throw new StickerError('标识仅支持小写字母、数字、横线和下划线。');
 const id=b.id;
 if(!Number.isSafeInteger(b.version)||(b.version as number)<0)throw new StickerError('版本无效。');
 if(!remove&&(typeof b.label!=='string'||!b.label.trim()||b.label.length>30||typeof b.glyph!=='string'||!b.glyph.trim()||b.glyph.length>32||typeof b.isActive!=='boolean'||!Number.isSafeInteger(b.sortOrder)||(b.sortOrder as number)<0||(b.sortOrder as number)>100000))throw new StickerError('请填写名称、表情内容和有效排序。');
 return db.$transaction(async tx=>{
 await tx.$executeRaw`UPDATE admin_operators SET version=version WHERE user_id=${actorId}`;
 if(!await hasAdminPermission(actorId,'settings.write',tx))throw new StickerError('没有修改权限。',403);
 const before=await tx.chatSticker.findUnique({where:{id}});
 if((before?.version??0)!==b.version)throw new StickerError('表情包已更新，请刷新后重试。',409);
 if(remove){if(!before)throw new StickerError('表情包不存在。',404);await tx.chatSticker.delete({where:{id}});await recordAdminAudit(tx,actorId,'DELETE_CHAT_STICKER',id,'删除聊天表情',{before});return {id,deleted:true};}
 const data={label:(b.label as string).trim(),glyph:(b.glyph as string).trim(),isActive:b.isActive as boolean,sortOrder:b.sortOrder as number};
 const saved=before?await tx.chatSticker.update({where:{id},data:{...data,version:{increment:1}},select}):await tx.chatSticker.create({data:{id,...data,version:1},select});
 await recordAdminAudit(tx,actorId,before?'UPDATE_CHAT_STICKER':'CREATE_CHAT_STICKER',id,'保存聊天表情',{before,after:saved});return saved;
 });
}
