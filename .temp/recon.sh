#!/bin/bash
echo "=== OS ==="; cat /etc/os-release | head -3; uname -r
echo "=== NODE ==="; which node; node -v; which npm; npm -v; which pm2; pm2 -v
echo "=== WWWROOT ==="; ls -la /www/wwwroot/
echo "=== KHUI-AI ==="; ls -la /www/wwwroot/khui-ai/ 2>/dev/null
echo "=== RELEASES ==="; ls -lat /www/wwwroot/khui-ai/releases/ 2>/dev/null | head -25
echo "=== SHARED ==="; ls -la /www/wwwroot/khui-ai/shared/ 2>/dev/null
echo "=== PM2 ==="; pm2 list 2>/dev/null; echo "--- pm2 jlist cwd ---"; pm2 jlist 2>/dev/null | head -c 2000
echo "=== NGINX VHOSTS ==="; ls -la /www/server/panel/vhost/nginx/ 2>/dev/null
echo "=== DISK ==="; df -h / /www 2>/dev/null | head -5
echo "=== MEM ==="; free -m | head -3
