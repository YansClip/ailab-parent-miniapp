const fs = require('node:fs')
const path = require('node:path')
const { spawnSync } = require('node:child_process')
function elfInfo(file) {
  const fd = fs.openSync(file, 'r'), bytes = Buffer.alloc(20)
  let count
  try { count = fs.readSync(fd, bytes, 0, bytes.length, 0) } finally { fs.closeSync(fd) }
  if (count < 20 || bytes.readUInt32BE(0) !== 0x7f454c46) return { format:'unknown', arch:'unknown' }
  if (bytes[5] !== 1) return { format:'ELF', arch:'unsupported-endian' }
  return { format:'ELF', bits:bytes[4] === 2 ? 64 : 32, type:bytes.readUInt16LE(16),
    arch:bytes.readUInt16LE(18) === 62 ? 'x64' : bytes.readUInt16LE(18) === 183 ? 'arm64' : 'other' }
}
function inspect(sdkDir, { compiler = 'clang', platform = process.platform, arch = process.arch, run = spawnSync } = {}) {
  if (!sdkDir) throw new Error('需要 --sdk-dir，指向含 include/ 与 lib/ 的官方服务端 SDK 目录')
  const root = fs.realpathSync(sdkDir)
  const binary = elfInfo(path.join(root,'lib/libwxcloudvoip_server.so'))
  const header = path.join(root,'include/wmpf/cloudvoip_server.h')
  if (!fs.statSync(header).isFile()) throw new Error('缺少官方头文件')
  const check = fs.readFileSync(path.join(__dirname,'../tools/wechat-official-voip/header-check.c'),'utf8')
  const result = run(compiler,['-fsyntax-only','-x','c','-std=c11','-Werror','-I',path.join(root,'include'),'-'],
    {input:check,encoding:'utf8',timeout:15000,maxBuffer:128*1024})
  const headerCompiled = !result.error && result.status === 0
  const hostCompatible = platform === 'linux' && arch === 'x64' && binary.arch === 'x64' && binary.bits === 64 && binary.type === 3
  return { localOnly:true, binary, host:{platform,arch}, headerCompiled, hostCompatible,
    nativeSdkLoaded:false, linked:false, networkTested:false, mediaVerified:false, realCallReady:false,
    blockers:[...(!headerCompiled ? ['头文件编译检查失败或缺少 C 编译器'] : []),
      ...(!hostCompatible ? ['实际 SDK 为 Linux x86-64，当前主机不匹配'] : []),
      '尚未验证依赖库、glibc/libcurl 版本与实际加载', '微信型号/VoIP 权限、可信回调、设备信令与媒体未实测'],
    // No SDK logs, credentials or arbitrary compiler output are printed.
    compileStatus:result.error ? String(result.error.code || 'COMPILER_ERROR') : result.status }
}
function main(args = process.argv.slice(2)) {
  const index = args.indexOf('--sdk-dir')
  if (index < 0 || !args[index+1]) throw new Error('用法：npm run device:voip:sdk-check -- --sdk-dir /path/to/extracted-server-sdk')
  const report = inspect(args[index+1])
  console.log(JSON.stringify(report,null,2))
  if (!report.headerCompiled || (args.includes('--strict') && !report.realCallReady)) process.exitCode = 1
}
if (require.main === module) { try { main() } catch (e) { console.error(e.code || e.message); process.exitCode=1 } }
module.exports = { elfInfo, inspect }
