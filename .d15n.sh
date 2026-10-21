#!/bin/bash
R=/www/wwwroot/khui-ai/releases/commercial-20261022-c15
cd "$R"
echo '--- 新 UI 文案是否进了构建产物 ---'
for s in 额度特例 继承公共值 回到最新 各任务用哪个模型 生成成功率 已隐藏; do
  n=$(grep -rl "$s" .next-build/static/chunks 2>/dev/null | wc -l)
  printf '%-18s %s\n' "$s" "$n"
done
echo '--- 服务端产物 ---'
grep -rl "额度特例" .next-build/server 2>/dev/null | head -2
grep -rl "opengraph" .next-build/server/app/\[locale\]/mirror 2>/dev/null | head -2
