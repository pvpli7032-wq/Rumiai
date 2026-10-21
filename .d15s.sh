echo '--- og.log ---'
tail -12 /tmp/og.log
echo '--- start-production 如何读端口 ---'
grep -n "PORT\|listen\|port" /www/wwwroot/khui-ai/releases/commercial-20261022-c15/scripts/start-production.mjs | head -8
