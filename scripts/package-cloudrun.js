// Isolated, explicit allowlist. Never upload the whole project/monitor data.
const fs = require('node:fs')
const path = require('node:path')
const crypto = require('node:crypto')
const root = path.resolve(__dirname, '..')
function sources() {
  const folders = ['server/mini-device-cloudrun', 'cloudfunctions/miniDeviceGateway/lib', 'cloudfunctions/miniDeviceGateway/providers']
  const files = folders.flatMap(folder => fs.readdirSync(path.join(root, folder)).filter(name => name.endsWith('.js')).map(name => folder + '/' + name))
  return files.concat(['.dockerignore', 'tools/mini-location-tcp/protocol.js', ...['Dockerfile', 'package.json', 'package-lock.json', 'schema.sql', '.env.example', '.env.relay.example'].map(name => 'server/mini-device-cloudrun/' + name)])
}
function entries() {
  // The web console expects Dockerfile beside the build root. Keep all COPY
  // paths relative to that root; narrowing the context would omit shared code.
  return sources().map(file => ({ file, source: file })).concat([
    { file: 'Dockerfile', source: 'server/mini-device-cloudrun/Dockerfile' }
  ])
}
function packageCode() {
  const relative = 'output/cloudrun-package-' + Date.now(), dir = path.join(root, relative), files = entries()
  fs.mkdirSync(path.join(root, 'output'), { recursive: true })
  fs.mkdirSync(dir) // Fail on collision; do not overwrite user artifacts.
  const manifest = files.map(({ file, source }) => {
    const data = fs.readFileSync(path.join(root, source)), target = path.join(dir, file)
    fs.mkdirSync(path.dirname(target), { recursive: true }); fs.copyFileSync(path.join(root, source), target)
    return { file, source, bytes: data.length, sha256: crypto.createHash('sha256').update(data).digest('hex') }
  })
  fs.writeFileSync(path.join(dir, 'MANIFEST.json'), JSON.stringify({ localOnly: true, createdAt: new Date().toISOString(), files: manifest }, null, 2) + '\n')
  return relative
}
if (require.main === module) console.log(packageCode() + '\n仅生成本地白名单部署包；没有上传、部署或连接云端。')
module.exports = { sources, entries, packageCode }
