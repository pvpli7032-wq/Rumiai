import type {Prisma} from '@prisma/client';
import {db} from '@/lib/db';

/** Internal projection shared by model selection and execution; no character content is exposed. */
export async function readCharacterModelScope(characterId:string,reader:Pick<Prisma.TransactionClient,'character'>=db){
  const row=await reader.character.findUnique({where:{id:characterId},select:{aiModelsRestricted:true,aiModelScopeVersion:true,allowedAiModels:{select:{modelKey:true},orderBy:{modelKey:'asc'}}}});
  if(!row)return null;
  return {restricted:row.aiModelsRestricted,version:row.aiModelScopeVersion,modelKeys:row.allowedAiModels.map(model=>model.modelKey)};
}
