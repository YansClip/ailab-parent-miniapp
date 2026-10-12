#!/bin/zsh
# Local synthetic-only tool. Does not deploy or read cloud configuration.
cd -- "${0:A:h}/../.." || exit 1
if ! command -v node >/dev/null 2>&1; then
  print '未找到 Node.js，请让开发人员帮助启动。不会自动安装软件。'
  read -r '?按回车关闭。'
  exit 1
fi
print '启动后请在浏览器打开 http://127.0.0.1:18868'
print '仅虚构数据；不连接云端。按 Control+C 停止并清空本次数据。'
node tools/synthetic-location-lab/server.js
