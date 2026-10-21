echo '--- 发行版 ---'
cat /etc/os-release | head -3
echo '--- 可装的中文字体包 ---'
(dnf list --available 'google-noto-sans-cjk*' 'wqy-*' 2>/dev/null || yum list available 'google-noto-sans-cjk*' 'wqy-*' 2>/dev/null) | head -10
