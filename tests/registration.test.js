const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const { createWxMock } = require('./helpers')

function jsFiles(dir) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const target = path.join(dir, entry.name)
    return entry.isDirectory() ? jsFiles(target) : target.endsWith('.js') ? [target] : []
  })
}

test('所有页面、组件和 App 脚本均可完成注册', () => {
  createWxMock()
  const mini = path.resolve(__dirname, '../miniprogram')
  let pageCount = 0
  let componentCount = 0
  let appCount = 0
  global.Page = (definition) => {
    assert.equal(typeof definition, 'object')
    pageCount += 1
  }
  global.Component = (definition) => {
    assert.equal(typeof definition, 'object')
    componentCount += 1
  }
  global.App = (definition) => {
    assert.equal(typeof definition, 'object')
    appCount += 1
  }

  jsFiles(path.join(mini, 'pages')).forEach((file) => {
    delete require.cache[require.resolve(file)]
    require(file)
  })
  jsFiles(path.join(mini, 'components')).forEach((file) => {
    delete require.cache[require.resolve(file)]
    require(file)
  })
  require(path.join(mini, 'custom-tab-bar/index.js'))
  require(path.join(mini, 'app.js'))

  assert.equal(pageCount, 48)
  assert.equal(componentCount, 5)
  assert.equal(appCount, 1)
})
