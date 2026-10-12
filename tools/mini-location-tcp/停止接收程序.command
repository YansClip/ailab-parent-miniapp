#!/bin/zsh
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd -- "$(dirname -- "$0")/../.." || exit 1
node tools/mini-location-tcp/stop-monitor.js
read '?按回车关闭'
