echo '--- 服务器可用中文字体 ---'
for f in /usr/share/fonts/opentype/noto/NotoSansSC-Regular.otf /usr/share/fonts/truetype/arphic/uming.ttf; do
  [ -f "$f" ] && echo "FOUND $f" || echo "MISS $f"
done
echo '--- 系统里所有含 CJK 的字体 ---'
fc-list :lang=zh 2>/dev/null | head -5
echo '--- 任意 ttf/otf ---'
find /usr/share/fonts -name "*.ttf" -o -name "*.otf" 2>/dev/null | head -8
