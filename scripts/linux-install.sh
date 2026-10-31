#!/usr/bin/env bash
# Ubuntu 安装 / 升级脚本（需 root）：安装 release/ 下最新的 deb，并修复
# Electron SUID 沙箱的两个坑：
#   1) 安装目录带空格（/opt/MC Launcher）会导致沙箱 helper 被 execvp 截断 → 目录改名去空格
#   2) chrome-sandbox 需要 setuid root（4755）才能作为沙箱 helper 使用 → chmod
#
# 用法： sudo scripts/linux-install.sh      或      pkexec scripts/linux-install.sh
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
DEB="$(ls -1t "$ROOT"/release/*amd64.deb 2>/dev/null | head -1 || true)"
[ -n "$DEB" ] || { echo "错误：release/ 下没有 *.deb，请先执行 npm run build:linux"; exit 1; }

echo "== 1/4 安装 $DEB =="
dpkg -i "$DEB"

echo "== 2/4 安装目录去空格 =="
if [ -d "/opt/MC Launcher" ]; then
  rm -rf /opt/mc-launcher
  mv "/opt/MC Launcher" /opt/mc-launcher
fi

echo "== 3/4 同步菜单项并修正 setuid 沙箱 =="
sed -i 's|Exec="/opt/MC Launcher/mc-launcher"|Exec="/opt/mc-launcher/mc-launcher"|' \
  /usr/share/applications/mc-launcher.desktop
update-desktop-database /usr/share/applications 2>/dev/null || true
chmod 4755 /opt/mc-launcher/chrome-sandbox

echo "== 4/4 修正命令行入口（update-alternatives）=="
update-alternatives --remove mc-launcher "/opt/MC Launcher/mc-launcher" 2>/dev/null || true
update-alternatives --install /usr/bin/mc-launcher mc-launcher /opt/mc-launcher/mc-launcher 100 2>/dev/null || true
update-alternatives --set mc-launcher /opt/mc-launcher/mc-launcher 2>/dev/null || true

echo
stat -c '%A %U:%G %n' /opt/mc-launcher/chrome-sandbox
grep '^Exec' /usr/share/applications/mc-launcher.desktop
echo "== 完成：按 Super 搜索 “MC Launcher” 启动 =="
