'use strict'
const token = document.querySelector('meta[name="sim-control"]').content
document.querySelector('meta[name="sim-control"]').remove()
const $ = id => document.getElementById(id)
let latest = null, requestedAt = 0, running = false, changing = false, version = 0
function clear(message, retry = false) { latest = null; $('marker').hidden = true; $('empty').hidden = false; $('empty').textContent = '暂不显示位置'; $('status').textContent = '本机连接未确认'; $('status').className = 'warn'; $('hint').textContent = message; $('ttl').textContent = '—'; $('coords').textContent = '— / —'; $('permission').textContent = '—'; $('binding').textContent = '—'; $('pair-code').textContent = '—'; $('reconnect').hidden = !retry }
$('reconnect').onclick = () => window.location.reload()
async function request(path, body) {
  const response = await fetch(path, { method: body ? 'POST' : 'GET', headers: { 'content-type': 'application/json', 'x-sim-token': token }, ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(5000), cache: 'no-store' })
  const result = await response.json()
  if (!response.ok || !result.ok) throw Error(result.error && result.error.message || '本机工具请求失败')
  return result.data
}
function render() {
  if (!latest) return
  let v
  try { v = SyntheticView.project(latest, requestedAt, Date.now()) } catch (e) { clear(e.message, true); return }
  $('marker').hidden = !v.hasPoint; $('empty').hidden = v.hasPoint; $('empty').textContent = v.label
  $('marker').style.left = v.x + '%'; $('marker').style.top = v.y + '%'; $('point-name').textContent = v.pointName
  $('status').textContent = v.label; $('status').className = v.tone; $('hint').textContent = v.hint
  $('ttl').textContent = v.hasPoint ? '剩余 ' + v.remainingSeconds + ' 秒' : '旧点不保留'
  $('coords').textContent = v.longitude + ' / ' + v.latitude; $('permission').textContent = v.permission; $('binding').textContent = v.bindingVersion
}
function apply(data, started) {
  latest = data; requestedAt = started; render()
  if (!latest) return
  $('reconnect').hidden = true
  $('pair-code').textContent = data.pairingCode || (data.paired ? '已配对' : '请重新生成')
  $('pair-hint').textContent = data.paired ? '开发者工具已配对；重新生成会使旧查看会话失效。' : '配对码单次使用，有效 5 分钟；只读会话有效 30 分钟。'
  if (data.lastResult) $('action-result').textContent = data.lastResult.message
  $('history').replaceChildren(...data.history.map(item => { const li = document.createElement('li'), small = document.createElement('span'); li.textContent = item.message; small.textContent = item.code; li.append(small); return li }))
}
async function poll() {
  if (running || changing || document.hidden) return
  running = true; const current = version, started = Date.now()
  try { const data = await request('/api/state'); if (current === version) apply(data, started) }
  catch (e) { if (current === version) clear('无法确认本机连接。工具重启后，请点「重新连接工具」再生成配对码；不会连接云端。', true) }
  finally { running = false }
}
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', async () => {
  const current = ++version, started = Date.now()
  changing = true
  document.querySelectorAll('button').forEach(b => { b.disabled = true })
  // Mutations clear the old view until the new response passes validation.
  clear('正在发送预设测试场景…')
  try { const data = await request('/api/action', { action: button.dataset.action }); if (current === version) apply(data, started) }
  catch (e) { if (current === version) { clear(e.message, true); $('action-result').textContent = e.message } }
  finally { changing = false; document.querySelectorAll('button').forEach(b => { b.disabled = false }) }
}))
document.addEventListener('visibilitychange', () => { version++; clear('页面已切换，等待重新查询。'); if (!document.hidden) poll() })
setInterval(poll, 2000); setInterval(render, 250); poll()
