import {db,pragmasReady} from '@/lib/db';
import {hasAdminPermission} from '@/lib/admin/authorization';
import {recordAdminAudit} from '@/lib/admin/management-service';
import {readAiModelOptions} from '@/lib/ai/models/runtime-service';
import {CharacterManagementError} from './management-service';
import {readCharacterModelScope} from './model-scope';

export async function readManagedCharacterModels(actor:string,characterId:string){
  if(!await hasAdminPermission(actor,'characters.read'))throw new CharacterManagementError('当前账号没有角色管理查看权限。',403);
  const scope=await readCharacterModelScope(characterId);
  if(!scope)throw new CharacterManagementError('角色不存在。',404);
  return {...scope,options:await readAiModelOptions()};
}

export async function saveManagedCharacterModels(actor:string,characterId:string,input:unknown){
  if(!input||typeof input!=='object'||Array.isArray(input))throw new CharacterManagementError('角色模型范围数据格式错误。');
  const row=input as Record<string,unknown>;
  if(typeof row.restricted!=='boolean'||!Number.isSafeInteger(row.version)||Number(row.version)<0)throw new CharacterManagementError('模型范围开关或版本无效。');
  if(!Array.isArray(row.modelKeys)||row.modelKeys.length>200||row.modelKeys.some(key=>typeof key!=='string'||!key||key.length>100))throw new CharacterManagementError('请选择有效模型，最多 200 个。');
  const modelKeys=[...new Set(row.modelKeys as string[])].sort();
  if(row.restricted&&!modelKeys.length)throw new CharacterManagementError('启用指定范围时至少选择一个模型。');
  if(typeof row.reason!=='string'||!row.reason.trim()||row.reason.trim().length>500)throw new CharacterManagementError('请填写 1–500 字操作理由。');
  const reason=row.reason.trim(),restricted=row.restricted;
  await pragmasReady;
  return db.$transaction(async tx=>{
    await tx.$executeRaw`UPDATE users SET account_version=account_version WHERE id=${actor}`;
    if(!await hasAdminPermission(actor,'characters.read',tx)||!await hasAdminPermission(actor,'characters.write',tx))throw new CharacterManagementError('当前账号没有角色模型范围管理权限。',403);
    const character=await tx.character.findUnique({where:{id:characterId},select:{reviewStatus:true,updatedAt:true}});
    if(!character)throw new CharacterManagementError('角色不存在。',404);
    if(character.reviewStatus==='DELETED')throw new CharacterManagementError('已删除角色不能修改模型范围。',409);
    const before=await readCharacterModelScope(characterId,tx);
    if(before!.version!==row.version)throw new CharacterManagementError('模型范围已被修改，请刷新后重试。',409);
    if(modelKeys.length&&await tx.aiModel.count({where:{key:{in:modelKeys}}})!==modelKeys.length)throw new CharacterManagementError('所选模型不存在，请刷新模型目录。');
    await tx.characterAiModel.deleteMany({where:{characterId}});
    if(restricted)for(const modelKey of modelKeys)await tx.characterAiModel.create({data:{characterId,modelKey}});
    await tx.character.update({where:{id:characterId},data:{aiModelsRestricted:restricted,aiModelScopeVersion:{increment:1},updatedAt:character.updatedAt}});
    const after=await readCharacterModelScope(characterId,tx);
    await recordAdminAudit(tx,actor,'CHARACTER_MODEL_SCOPE_UPDATED',characterId,reason,{before,after});
    return after!;
  });
}
