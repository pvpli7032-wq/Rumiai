dnf install -y google-noto-sans-cjk-jp-fonts > /tmp/font.log 2>&1; tail -3 /tmp/font.log
echo '--- 装出来的文件 ---'
rpm -ql google-noto-sans-cjk-jp-fonts 2>/dev/null | grep -E '\.(otf|ttf|ttc)$'
