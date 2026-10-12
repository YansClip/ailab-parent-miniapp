#!/bin/zsh
export PATH="/opt/homebrew/bin:/usr/local/bin:$PATH"
cd -- "$(dirname -- "$0")/../.." || exit 1
print '请在监控窗口里勾选合成数据确认，再点击“开启公网测试”。'
print '如果监控窗口已在运行，直接使用窗口里的按钮，不需要再启动此脚本。'
exec /bin/zsh tools/mini-location-tcp/启动接收程序.command
