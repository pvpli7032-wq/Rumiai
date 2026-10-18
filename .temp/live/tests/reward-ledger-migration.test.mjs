import test from 'node:test';
import assert from 'node:assert/strict';
import {DatabaseSync} from 'node:sqlite';
import {cpSync,mkdirSync,mkdtempSync,readdirSync,rmSync} from 'node:fs';
import {spawnSync} from 'node:child_process';
import path from 'node:path';

test('reward source migration classifies legacy ledger rows without changing amounts or descriptions',()=>{
  const artifactRoot=path.resolve('artifacts');mkdirSync(artifactRoot,{recursive:true});
  const work=mkdtempSync(path.join(artifactRoot,'reward-ledger-migration-'));
  assert.equal(path.dirname(work),artifactRoot);
  const schema=path.join(work,'prisma');mkdirSync(path.join(schema,'migrations'),{recursive:true});
  cpSync('prisma/schema.prisma',path.join(schema,'schema.prisma'));
  const migrationName='20261014240000_reward_ledger_sources';
  for(const entry of readdirSync('prisma/migrations',{withFileTypes:true})){
    if(entry.name===migrationName)continue;
    if(entry.isDirectory())cpSync(path.join('prisma/migrations',entry.name),path.join(schema,'migrations',entry.name),{recursive:true});
    else cpSync(path.join('prisma/migrations',entry.name),path.join(schema,'migrations',entry.name));
  }
  const file=path.join(work,'legacy.db'),url=`file:${file.split(path.sep).join('/')}`,env={...process.env,DATABASE_URL:url};delete env.RUST_LOG;
  const deploy=()=>{const result=spawnSync(process.execPath,['node_modules/prisma/build/index.js','migrate','deploy','--schema',path.join(schema,'schema.prisma')],{env,encoding:'utf8',windowsHide:true});assert.equal(result.status,0,result.stdout+result.stderr);};
  let sqlite;
  try{
    deploy();sqlite=new DatabaseSync(file);const now=Date.now();
    sqlite.prepare('INSERT INTO users (id,username,email,password_hash,created_at,updated_at) VALUES (?,?,?,?,?,?)').run('legacy_fixture_user','legacy_fixture','legacy-fixture@example.invalid','synthetic',now,now);
    const insert=sqlite.prepare('INSERT INTO coin_transactions (id,user_id,amount,type,description,created_at) VALUES (?,?,?,?,?,?)');
    const rows=[
      ['checkin',10,'EARNED','每日签到第 1 天','CHECKIN_REWARD'],
      ['mission',25,'EARNED','任务奖励：每日任务','MISSION_REWARD'],
      ['character',30,'EARNED','ภารกิจตัวละคร: 连续聊天','CHARACTER_QUEST_REWARD'],
      ['payment',600,'PURCHASE','EZFP 充值订单 A','PAYMENT_PURCHASE'],
      ['release',60,'REFUND_RELEASE','退款被拒后返还','REFUND_RELEASE'],
      ['reservation',-60,'REFUND','退款申请预留金币 A','REFUND_RESERVATION'],
      ['gift',-12,'SPENT','赠送礼物 star 给角色','GIFT_PURCHASE'],
      ['unknown',1,'EARNED','人工测试调整','OTHER'],
    ];
    for(const [id,amount,type,description] of rows)insert.run(id,'legacy_fixture_user',amount,type,description,now);
    const before=sqlite.prepare('SELECT id,amount,type,description FROM coin_transactions ORDER BY id').all().map(row=>({...row}));sqlite.close();sqlite=null;
    cpSync(`prisma/migrations/${migrationName}`,path.join(schema,'migrations',migrationName),{recursive:true});deploy();sqlite=new DatabaseSync(file);
    const after=sqlite.prepare('SELECT id,amount,type,description,source_key FROM coin_transactions ORDER BY id').all().map(row=>({...row}));
    assert.deepEqual(after.map(({id,amount,type,description})=>({id,amount,type,description})),before);
    assert.deepEqual(after.map(row=>[row.id,row.source_key]),rows.map(([id,,,,source])=>[id,source]).sort(([left],[right])=>left.localeCompare(right)));
    assert.equal(sqlite.prepare("SELECT COUNT(*) AS count FROM coin_transactions WHERE source_key='OTHER'").get().count,1);
  }finally{sqlite?.close();assert.equal(path.dirname(path.resolve(work)),artifactRoot);rmSync(work,{recursive:true,force:true});}
});
