export type MigrationRecord={migration_name:string;finished_at:number|null;rolled_back_at:number|null};

export function compareMigrationHistory(records:MigrationRecord[],available:string[]|null){
  const applied=records.filter(record=>record.finished_at!==null&&record.rolled_back_at===null);
  const names=new Set(applied.map(record=>record.migration_name));
  const availableNames=available===null?null:new Set(available);
  const latest=[...applied].sort((a,b)=>Number(b.finished_at)-Number(a.finished_at)||b.migration_name.localeCompare(a.migration_name))[0];
  return {
    appliedCount:names.size,availableCount:availableNames?.size??null,
    pendingCount:availableNames===null?null:[...availableNames].filter(name=>!names.has(name)).length,
    unexpectedCount:availableNames===null?null:[...names].filter(name=>!availableNames.has(name)).length,
    failedCount:records.filter(record=>record.finished_at===null&&record.rolled_back_at===null).length,
    lastMigration:latest?.migration_name??null,
    lastAppliedAt:latest?new Date(Number(latest.finished_at)).toISOString():null,
  };
}

