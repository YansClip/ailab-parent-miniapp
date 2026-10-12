#!/bin/zsh
# Double-click to enable the installed local service, or run a foreground fallback.
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd -- "$(dirname -- "$0")/../.." || exit 1
if ! command -v node >/dev/null 2>&1; then
  print '没有找到 Node.js，请在已能运行 npm 的终端执行 npm run device:tcp。'
  read '?按回车关闭'
  exit 1
fi
if [[ -f /Users/sc/Library/LaunchAgents/com.ailab.mini-device-monitor.plist ]]; then
  node tools/mini-location-tcp/service.js start || exit 1
  /usr/bin/open http://127.0.0.1:18866
  exit 0
fi
node tools/mini-location-tcp/cli.js --monitor --open-monitor
read '?接收程序已结束，按回车关闭'
