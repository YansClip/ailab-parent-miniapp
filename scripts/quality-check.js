const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const childProcess = require('child_process')

const root = path.resolve(__dirname, '..')
const mini = path.join(root, 'miniprogram')
const app = JSON.parse(fs.readFileSync(path.join(mini, 'app.json'), 'utf8'))
const errors = []
const warnings = []

function walk(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name)
    return entry.isDirectory() ? walk(target) : [target]
  })
}

function rel(file) {
  return path.relative(root, file)
}

function existsMini(target) {
  return fs.existsSync(path.join(mini, target.replace(/^\//, '')))
}

const pages = app.pages || []
const pageSet = new Set(pages)
if (pages.length !== 48) errors.push(`页面注册数量应为 48，当前为 ${pages.length}`)

pages.forEach((page) => {
  ;['.js', '.json', '.wxml', '.wxss'].forEach((ext) => {
    const file = path.join(mini, page + ext)
    if (!fs.existsSync(file)) errors.push(`缺少页面文件：${rel(file)}`)
  })
})

const files = walk(mini)
const backend = walk(path.join(root, 'cloudfunctions', 'miniDeviceGateway')).filter(file => !file.includes(`${path.sep}node_modules${path.sep}`))
const cloudrun = walk(path.join(root, 'server', 'mini-device-cloudrun')).filter(file => !file.includes(`${path.sep}node_modules${path.sep}`))
const testFiles = walk(path.join(root, 'tests')).filter(file => file.endsWith('.js'))
const tcpTools = walk(path.join(root, 'tools', 'mini-location-tcp')).filter(file => file.endsWith('.js'))
const syntheticTools = walk(path.join(root, 'tools', 'synthetic-location-lab')).filter(file => file.endsWith('.js'))
const voipTools = walk(path.join(root, 'tools', 'voip-rehearsal')).filter(file => file.endsWith('.js'))
const jsFiles = files.concat(backend, cloudrun, testFiles, tcpTools, syntheticTools, voipTools, [path.join(root, 'scripts', 'voip-preflight.js')]).filter((file) => file.endsWith('.js'))
jsFiles.forEach((file) => {
  try {
    childProcess.execFileSync(process.execPath, ['--check', file], { stdio: 'pipe' })
  } catch (error) {
    errors.push(`JavaScript 语法错误：${rel(file)}\n${String(error.stderr || error.message)}`)
  }
})

const textFiles = files.filter((file) => /\.(js|json|wxml|wxss)$/.test(file))
const allText = textFiles.map((file) => fs.readFileSync(file, 'utf8')).join('\n')

files.filter((file) => file.endsWith('.wxml')).forEach((file) => {
  const wxml = fs.readFileSync(file, 'utf8')
  for (const binding of wxml.matchAll(/current-id="{{([^}]+)}}"/g)) {
    if (!binding[1].includes("|| ''")) errors.push(`孩子选择组件需要空字符串回退，避免 null 属性告警：${rel(file)}`)
  }
  const jsFile = file.replace(/\.wxml$/, '.js')
  const js = fs.existsSync(jsFile) ? fs.readFileSync(jsFile, 'utf8') : ''
  const handlers = [...wxml.matchAll(/(?:bind|catch)(?::)?(?:tap|change|input|submit|action|close|confirm|blur)="([A-Za-z_$][\w$]*)"/g)].map((match) => match[1])
  handlers.forEach((handler) => {
    const methodPattern = new RegExp(`(?:^|[,\\n]\\s*)(?:async\\s+)?${handler}\\s*(?:\\([^)]*\\)\\s*\\{|:)`, 'm')
    if (!methodPattern.test(js)) errors.push(`事件方法缺失：${rel(file)} -> ${handler}`)
  })

  const pageJson = file.replace(/\.wxml$/, '.json')
  const usingComponents = fs.existsSync(pageJson)
    ? Object.keys((JSON.parse(fs.readFileSync(pageJson, 'utf8')).usingComponents || {}))
    : []
  ;['nav-bar', 'empty-state', 'child-switcher', 'public-preview'].forEach((tag) => {
    if (wxml.includes('<' + tag) && usingComponents.indexOf(tag) < 0) {
      errors.push(`页面使用组件但未注册：${rel(file)} -> ${tag}`)
    }
  })

  if (!file.endsWith(`${path.sep}my${path.sep}debug.wxml`)) {
    ;['Mock', '高保真', '演示任务', '演示版', '规则 v', '错误追踪'].forEach((word) => {
      if (wxml.includes(word)) errors.push(`普通用户界面包含技术文案：${rel(file)} -> ${word}`)
    })
  }

  for (const match of wxml.matchAll(/(?:data-url|url)="(\/pages\/[^"?]+)(?:\?[^\"]*)?"/g)) {
    const route = match[1].replace(/^\//, '')
    if (!pageSet.has(route)) errors.push(`跳转页面未注册：${rel(file)} -> ${match[1]}`)
  }

  for (const match of wxml.matchAll(/(?:src|icon-path)="(\/assets\/[^\"]+)"/g)) {
    if (match[1].includes('{{')) continue
    if (!existsMini(match[1])) errors.push(`资源不存在：${rel(file)} -> ${match[1]}`)
  }
})

textFiles.filter((file) => /\.(js|wxml)$/.test(file)).forEach((file) => {
  const content = fs.readFileSync(file, 'utf8')
  for (const match of content.matchAll(/["'](\/pages\/[A-Za-z0-9_\-/]+)(?:\?[^"']*)?["']/g)) {
    const route = match[1].replace(/^\//, '')
    if (!pageSet.has(route)) errors.push(`代码中的跳转页面未注册：${rel(file)} -> ${match[1]}`)
  }
})

files.filter((file) => file.endsWith('.json') && file !== path.join(mini, 'app.json')).forEach((file) => {
  let json
  try { json = JSON.parse(fs.readFileSync(file, 'utf8')) } catch (error) {
    errors.push(`JSON 格式错误：${rel(file)}`)
    return
  }
  Object.values(json.usingComponents || {}).forEach((componentPath) => {
    if (!existsMini(componentPath + '.json')) errors.push(`组件不存在：${rel(file)} -> ${componentPath}`)
  })
})

const forbidden = [
  [/\b(?:AppSecret|appSecret)\b\s*[:=]\s*['\"][^'\"]+/g, '疑似 AppSecret'],
  [/-----BEGIN (?:RSA |EC )?PRIVATE KEY-----/g, '私钥内容']
]
forbidden.forEach(([pattern, label]) => {
  if (pattern.test(allText)) errors.push(`${label}不应写入项目文件`)
})

const assetFiles = files.filter((file) => file.includes(`${path.sep}assets${path.sep}`))
assetFiles.forEach((file) => {
  const assetPath = '/' + path.relative(mini, file).split(path.sep).join('/')
  if (!allText.includes(assetPath) && !allText.includes(assetPath.slice(1))) warnings.push(`未引用资源：${assetPath}`)
})

const styles = files.filter((file) => file.endsWith('.wxss'))
styles.filter((file) => file.includes(`${path.sep}components${path.sep}`)).forEach((file) => {
  const source = fs.readFileSync(file, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '')
  for (const match of source.matchAll(/([^{}]+)\{/g)) {
    const selector = match[1].trim()
    if (selector.startsWith('@')) continue
    if (/[\[\]#]/.test(selector) || /(?:^|[\s,>+~])(?:view|text|image|button|input)(?=[\s,.:[>+~]|$)/.test(selector)) {
      errors.push(`自定义组件使用不受支持的标签、属性或 ID 选择器：${rel(file)} -> ${selector}`)
    }
  }
})
const hashes = new Map()
styles.forEach((file) => {
  const content = fs.readFileSync(file)
  const hash = crypto.createHash('sha1').update(content).digest('hex')
  const list = hashes.get(hash) || []
  list.push(file)
  hashes.set(hash, list)
})
hashes.forEach((list) => {
  const content = fs.readFileSync(list[0], 'utf8').trim()
  if (list.length >= 3 && !content.startsWith('@import')) warnings.push(`${list.length} 个样式文件内容完全相同：${list.slice(0, 3).map(rel).join('、')}`)
})

console.log(`AILab MiniApp quality check: ${pages.length} pages, ${files.length} files`)
warnings.forEach((warning) => console.warn(`WARN  ${warning}`))
errors.forEach((error) => console.error(`ERROR ${error}`))
console.log(`Result: ${errors.length} error(s), ${warnings.length} warning(s)`)
if (errors.length) process.exitCode = 1
