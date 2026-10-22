#!/bin/bash
set -e
R=/www/wwwroot/khui-ai/releases/commercial-20261022-c17
S=/www/wwwroot/khui-ai/shared
rm -rf "$R" && mkdir -p "$R"
tar xzf /tmp/c17.tar.gz -C "$R" 2>/dev/null
cd "$R"
ln -sfn "$S/app.env" .env
cp -r "$S/uploads" ./public/uploads 2>/dev/null || true
echo '--- deps ---'
npm ci --no-audit --no-fund > /tmp/c17-npm.log 2>&1 || { tail -15 /tmp/c17-npm.log; exit 1; }
tail -1 /tmp/c17-npm.log
npx prisma generate > /tmp/c17-gen.log 2>&1 || { tail -8 /tmp/c17-gen.log; exit 1; }
echo '--- build ---'
NODE_OPTIONS=--max-old-space-size=3072 NEXT_DIST_DIR=.next-build npm run build > /tmp/c17-build.log 2>&1 || { tail -25 /tmp/c17-build.log; exit 1; }
tail -3 /tmp/c17-build.log
echo "BUILD_ID=$(cat .next-build/BUILD_ID)"
