#!/bin/bash
set -e
R=/www/wwwroot/khui-ai/releases/commercial-20261022-c15
cd "$R"
cp /www/wwwroot/khui-ai/shared/database.db /tmp/ogtest.db
CHAR=$(node -e "const{DatabaseSync}=require('node:sqlite');const d=new DatabaseSync('/tmp/ogtest.db');const r=d.prepare('select id from characters limit 1').get();console.log(r?r.id:'');d.close()")
echo "character: $CHAR"
node -e "
const{DatabaseSync}=require('node:sqlite');
const d=new DatabaseSync('/tmp/ogtest.db');
const now=new Date().toISOString();
d.prepare('insert into mirror_results (id,share_id,character_id,answers_json,title,observations_json,quote,indices_json,status,created_at,updated_at) values (?,?,?,?,?,?,?,?,?,?,?)').run(
 'ogtest1','ogtestshare1','$CHAR','[]','温和但有边界的人','[\"遇事先想对方的处境\",\"不喜欢把话说死\"]','你更愿意先听别人讲完，再决定要不要坚持。','{}','READY',now,now);
d.close();
"
echo '--- 起隔离实例 3102 ---'
DATABASE_URL=file:/tmp/ogtest.db PORT=3102 NEXT_DIST_DIR=.next-build NODE_ENV=production node scripts/start-production.mjs > /tmp/og.log 2>&1 &
PID=$!
sleep 9
echo '--- 取预览图 ---'
curl -s -o /tmp/og.png -w 'status %{http_code} type %{content_type} bytes %{size_download}\n' http://127.0.0.1:3102/zh/mirror/ogtestshare1/opengraph-image
echo '--- 分享页 ---'
curl -s -o /dev/null -w 'share %{http_code}\n' http://127.0.0.1:3102/zh/mirror/ogtestshare1
kill $PID 2>/dev/null || true
sleep 1
echo '--- 字体命中日志 ---'
grep -i "font\|preview" /tmp/og.log | head -3 || echo '(no font log)'
