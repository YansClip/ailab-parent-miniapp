const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { elfInfo, inspect } = require('../scripts/wechat-official-sdk-check')
function sdk(t) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(),'synthetic-official-sdk-'))
  t.after(()=>fs.rmSync(root,{recursive:true,force:true}))
  fs.mkdirSync(path.join(root,'lib')); fs.mkdirSync(path.join(root,'include/wmpf'),{recursive:true})
  fs.writeFileSync(path.join(root,'include/wmpf/cloudvoip_server.h'),'/* synthetic header */')
  const elf = Buffer.alloc(20); elf.writeUInt32BE(0x7f454c46); elf[4]=2; elf[5]=1; elf.writeUInt16LE(3,16); elf.writeUInt16LE(62,18)
  const file = path.join(root,'lib/libwxcloudvoip_server.so'); fs.writeFileSync(file,elf)
  return {root,file}
}
test('官方 SDK 检查：只编译头文件、不链接执行；匹配 Linux 也不声称已就绪', t => {
  const f = sdk(t), calls=[]
  const result = inspect(f.root,{platform:'linux',arch:'x64',run:(cmd,args,options)=>{calls.push({cmd,args,options});return {status:0}}})
  assert.equal(calls.length,1); assert(calls[0].args.includes('-fsyntax-only')); assert(!calls[0].args.some(x=>x.endsWith('.so')))
  assert(calls[0].options.input.includes('wx_cloudvoip_session_cloud_call_join'))
  assert.equal(result.headerCompiled,true); assert.equal(result.hostCompatible,true)
  for (const field of ['nativeSdkLoaded','linked','networkTested','mediaVerified','realCallReady']) assert.equal(result[field],false)
})
test('官方 SDK 检查：Mac arm64/编译失败/非 ELF 不误报兼容', t => {
  const f=sdk(t)
  const result=inspect(f.root,{platform:'darwin',arch:'arm64',run:()=>({status:1,stderr:'potential secret must not echo'})})
  assert.equal(result.hostCompatible,false); assert.equal(result.headerCompiled,false); assert(!JSON.stringify(result).includes('potential secret'))
  fs.writeFileSync(f.file,'not ELF'); assert.equal(elfInfo(f.file).format,'unknown')
  assert.throws(()=>inspect(''),/sdk-dir/)
})
