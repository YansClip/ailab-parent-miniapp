'use strict'

const test = require('node:test')
const assert = require('node:assert/strict')
const { parseEndpoint, sshArgs, cleanText } = require('../tools/mini-location-tcp/tunnel')

test('TCP tunnel: 只识别服务商实际 TCP 地址，不接受示意 HTTP、错误域名和端口', () => {
  assert.deepEqual(parseEndpoint('tcp://test.run.pinggy-free.link:39529\n'), { host: 'test.run.pinggy-free.link', port: 39529 })
  assert.deepEqual(parseEndpoint('tcp://test.a.pinggy.link:12345'), { host: 'test.a.pinggy.link', port: 12345 })
  for (const text of ['https://test.pinggy.link:1234', 'tcp://test.evil.link:1234',
    'tcp://test.pinggy.link:65536', 'tcp://test.pinggy.link:0', 'tcp://test.pinggy.link:123456']) {
    assert.equal(parseEndpoint(text), null)
  }
})

test('TCP tunnel: 仅转发定位端口，忽略用户 SSH 配置及 agent，保留主机密钥校验', () => {
  const args = sshArgs('/test/private')
  assert.deepEqual(args.slice(0, 2), ['-F', '/dev/null'])
  assert.equal(args[args.indexOf('-R') + 1], '0:127.0.0.1:18765')
  assert.equal(args.includes('-L'), false)
  assert.ok(args.includes('IdentityAgent=none'))
  assert.ok(args.includes('ForwardAgent=no'))
  assert.ok(args.includes('StrictHostKeyChecking=accept-new'))
  assert.equal(args.includes('StrictHostKeyChecking=no'), false)
  assert.ok(args.includes('/test/private/pinggy-test-key'))
})

test('TCP tunnel: 清除服务商颜色控制符，不执行远程输出', () => {
  const result = cleanText('\x1b[31mtcp://test.pinggy.link:10001\x1b[0m\n')
  assert.equal(result, 'tcp://test.pinggy.link:10001\n')
  assert.equal(cleanText('\x07test').includes('\x07'), false)
})
