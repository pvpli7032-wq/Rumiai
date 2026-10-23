import type {Prisma} from '@prisma/client';
import {GROWTH_MODULES,type GrowthModuleDescriptor,type GrowthModuleId} from '@rumiai/contracts/growth/modules';

type StateReader=Pick<Prisma.TransactionClient,'growthModuleState'>;

/** Trusted adapter boundary. Adding a module requires a reviewed code change and build. */
export interface GrowthModuleAdapter{
  descriptor:GrowthModuleDescriptor;
  /** Absence means enabled so a non-breaking migration cannot silently stop existing rewards. */
  isEnabled(reader:StateReader):Promise<boolean>;
}

function adapter(descriptor:GrowthModuleDescriptor):GrowthModuleAdapter{
  return {descriptor,async isEnabled(reader){return (await reader.growthModuleState.findUnique({where:{moduleId:descriptor.id},select:{isEnabled:true}}))?.isEnabled??true;}};
}

const ADAPTERS=new Map<GrowthModuleId,GrowthModuleAdapter>(GROWTH_MODULES.map(item=>[item.id,adapter(item)]));

export function growthModuleAdapter(id:GrowthModuleId){return ADAPTERS.get(id)!;}
export function growthModuleAdapters(){return GROWTH_MODULES.map(item=>growthModuleAdapter(item.id));}
