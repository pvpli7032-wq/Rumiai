import {lstat,readdir,readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import type {Stats} from 'node:fs';
import path from 'node:path';
import {validateStateBackupManifest,validateStateRestoreRecord} from './state-backup.mjs';
import {backupDirectory} from './backup-directory.mjs';

const defaultDirectory=backupDirectory;
const MAX_METADATA_BYTES=8*1024*1024;
const PAGE_SIZE=20;
type FileInfo=Stats;
type Candidate={name:string;directory:string;kind:'DATABASE'|'STATE';database:FileInfo|null;manifest:FileInfo|null;modifiedAt:number};
type Manifest={createdAt:string;database:{bytes:number;sha256:string};uploads:Array<{bytes:number}>;referenceCount:number};
export type BackupInventoryItem={
  id:string;kind:'DATABASE'|'STATE_BACKUP'|'STATE_RESTORE';recordedAt:string;
  databaseBytes:number|null;uploadCount:number|null;uploadBytes:number|null;referenceCount:number|null;
  verification:'NOT_RECORDED'|'RECORDED_AT_OPERATION'|'INCOMPLETE'|'INVALID_METADATA';reasonCode:string|null;
};

async function info(file:string){
  try{return await lstat(file);}catch(error){if((error as NodeJS.ErrnoException).code==='ENOENT')return null;throw error;}
}
async function regularFile(file:string){const value=await info(file);return value?.isFile()&&!value.isSymbolicLink()?value:null;}
const identifier=(value:string)=>createHash('sha256').update(value).digest('hex').slice(0,20);

async function scan(directory:string){
  const root=await info(directory);
  if(!root)return {directoryPresent:false,candidates:[] as Candidate[]};
  if(!root.isDirectory()||root.isSymbolicLink())throw Error('备份目录类型异常。');
  const candidates:Candidate[]=[];
  for(const entry of await readdir(directory,{withFileTypes:true})){
    if(entry.isSymbolicLink())continue;
    const location=path.join(directory,entry.name);
    if(entry.isFile()&&entry.name.toLowerCase().endsWith('.db')){
      const database=await regularFile(location);
      if(database)candidates.push({name:entry.name,directory:location,kind:'DATABASE',database,manifest:null,modifiedAt:database.mtimeMs});
    }else if(entry.isDirectory()){
      const [database,manifest]=await Promise.all([regularFile(path.join(location,'database.db')),regularFile(path.join(location,'manifest.json'))]);
      if(database||manifest)candidates.push({name:entry.name,directory:location,kind:'STATE',database,manifest,modifiedAt:Math.max(database?.mtimeMs??0,manifest?.mtimeMs??0)});
    }
  }
  candidates.sort((a,b)=>b.modifiedAt-a.modifiedAt||a.name.localeCompare(b.name));
  return{directoryPresent:true,candidates};
}
function summary(inventory:Awaited<ReturnType<typeof scan>>){
  return{directoryPresent:inventory.directoryPresent,singleFileBackups:inventory.candidates.filter(item=>item.kind==='DATABASE'&&Number(item.database?.size)>0).length,stateBundles:inventory.candidates.filter(item=>item.kind==='STATE'&&item.manifest).length,incompleteBundles:inventory.candidates.filter(item=>item.kind==='STATE'&&(!item.manifest||!item.database)).length,newestAt:inventory.candidates[0]?new Date(inventory.candidates[0].modifiedAt).toISOString():null};
}

async function metadata(file:string){
  const value=await regularFile(file);
  if(!value)throw Error('METADATA_MISSING');
  if(value.size>MAX_METADATA_BYTES)throw Error('METADATA_TOO_LARGE');
  return JSON.parse(await readFile(file,'utf8')) as unknown;
}

async function stateItem(candidate:Candidate,id=identifier(candidate.name),historical=false):Promise<BackupInventoryItem>{
  const item:BackupInventoryItem={id,kind:'STATE_BACKUP',recordedAt:new Date(candidate.modifiedAt).toISOString(),databaseBytes:candidate.database?.size??null,uploadCount:null,uploadBytes:null,referenceCount:null,verification:'INCOMPLETE',reasonCode:'MANIFEST_OR_DATABASE_MISSING'};
  if(!candidate.manifest||!candidate.database)return item;
  try{
    const raw=await metadata(path.join(candidate.directory,'manifest.json'));validateStateBackupManifest(raw);
    const manifest=raw as Manifest;
    item.recordedAt=manifest.createdAt;item.uploadCount=manifest.uploads.length;item.referenceCount=manifest.referenceCount;item.databaseBytes=manifest.database.bytes;
    const uploadedBytes=manifest.uploads.reduce((sum,file)=>sum+file.bytes,0);
    if(!Number.isSafeInteger(uploadedBytes))throw Error('METADATA_INVALID');
    item.uploadBytes=uploadedBytes;
    if(!historical){const uploads=await info(path.join(candidate.directory,'uploads'));if(candidate.database.size!==manifest.database.bytes||!uploads?.isDirectory()||uploads.isSymbolicLink()){item.reasonCode='DATA_FILES_INCOMPLETE';return item;}}
    const restoreFile=path.join(candidate.directory,'restore-result.json');
    if(await info(restoreFile)){
      item.kind='STATE_RESTORE';
      const restoration=await metadata(restoreFile);validateStateRestoreRecord(restoration,manifest);
      item.recordedAt=(restoration as {completedAt:string}).completedAt;
    }
    item.verification='RECORDED_AT_OPERATION';item.reasonCode=null;
  }catch(error){item.verification='INVALID_METADATA';item.reasonCode=error instanceof Error&&error.message==='METADATA_TOO_LARGE'?'METADATA_TOO_LARGE':'METADATA_INVALID';}
  return item;
}

/** Directory metadata only; never rehashes database or upload contents in an HTTP request. */
export async function readBackupInventory(directory=defaultDirectory()){
  return summary(await scan(directory));
}

/** A projection of existing manifests, not a fresh restoration/integrity guarantee. */
export async function readBackupCatalog(page=1,options:{directory?:string;activeDatabase?:string}={}){
  const inventory=await scan(options.directory??defaultDirectory());
  const activeDirectory=options.activeDatabase&&path.basename(options.activeDatabase).toLowerCase()==='database.db'?path.dirname(options.activeDatabase):undefined;
  const hasActiveRecord=activeDirectory&&await info(path.join(activeDirectory,'restore-result.json'));
  const selected=inventory.candidates.slice((page-1)*PAGE_SIZE,page*PAGE_SIZE);
  const items=await Promise.all(selected.map(async candidate=>candidate.kind==='STATE'?stateItem(candidate,identifier(candidate.name),Boolean(hasActiveRecord&&activeDirectory&&path.resolve(candidate.directory)===path.resolve(activeDirectory))):({id:identifier(candidate.name),kind:'DATABASE',recordedAt:new Date(candidate.modifiedAt).toISOString(),databaseBytes:candidate.database!.size,uploadCount:null,uploadBytes:null,referenceCount:null,verification:candidate.database!.size>0?'NOT_RECORDED':'INCOMPLETE',reasonCode:candidate.database!.size>0?null:'EMPTY_DATABASE'} satisfies BackupInventoryItem)));
  let activeRestore:BackupInventoryItem|null=null;
  if(activeDirectory&&hasActiveRecord){
    const [database,manifest]=await Promise.all([regularFile(options.activeDatabase!),regularFile(path.join(activeDirectory,'manifest.json'))]);
    activeRestore=await stateItem({name:'active',directory:activeDirectory,kind:'STATE',database,manifest,modifiedAt:manifest?.mtimeMs??database?.mtimeMs??0},identifier('active:'+activeDirectory),true);
  }
  return{...summary(inventory),items,page,pageSize:PAGE_SIZE,total:inventory.candidates.length,activeRestore};
}
