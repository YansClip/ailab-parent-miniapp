'use strict'
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')

const script = fs.readFileSync(path.join(__dirname, '../tools/mini-location-tcp/monitor-ui/app.js'), 'utf8')
function page(storage) {
  const nodes = new Map()
  const document = { documentElement: { dataset: {} },
    getElementById(id) { if (!nodes.has(id)) nodes.set(id, { attrs: {}, setAttribute(k, v) { this.attrs[k] = v } }); return nodes.get(id) },
    querySelector() { return { content: 'test-page-token' } }, querySelectorAll() { return [] }, addEventListener() {} }
  let requests = 0
  const context = { document, localStorage: storage, setInterval() {}, fetch() { requests++; return new Promise(() => {}) }, AbortSignal, Date, console }
  vm.runInNewContext(script, context)
  return { document, nodes, requests: () => requests }
}
test('monitor theme: toggles both ways, persists choice across reload, no control requests', () => {
  const values = new Map()
  const storage = { getItem: key => values.get(key), setItem: (key, value) => values.set(key, value) }
  const first = page(storage)
  assert.equal(first.document.documentElement.dataset.theme, 'light')
  first.nodes.get('themeToggle').onclick()
  assert.equal(first.document.documentElement.dataset.theme, 'dark')
  assert.equal(first.nodes.get('themeToggle').attrs['aria-pressed'], 'true')
  assert.equal(first.nodes.get('themeLabel').textContent, '切换浅色')
  const second = page(storage)
  assert.equal(second.document.documentElement.dataset.theme, 'dark')
  second.nodes.get('themeToggle').onclick()
  assert.equal(second.document.documentElement.dataset.theme, 'light')
  assert.equal(second.nodes.get('themeToggle').attrs['aria-pressed'], 'false')
  assert.deepEqual([...values.keys()], ['ailab-device-lab-theme'])
  assert.equal(first.requests(), 1) // Only the existing initial status fetch.
  assert.equal(second.requests(), 1)
})
test('monitor theme: disabled storage and invalid stored values do not break controls', () => {
  const failed = page({ getItem() { throw new Error('blocked') }, setItem() { throw new Error('blocked') } })
  failed.nodes.get('themeToggle').onclick()
  assert.equal(failed.document.documentElement.dataset.theme, 'dark')
  assert.equal(typeof failed.nodes.get('startReceiver').onclick, 'function')
  const invalid = page({ getItem: () => 'untrusted-value', setItem() {} })
  assert.equal(invalid.document.documentElement.dataset.theme, 'light')
})
