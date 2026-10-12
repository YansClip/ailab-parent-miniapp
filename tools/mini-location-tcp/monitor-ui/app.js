'use strict'
const $ = id => document.getElementById(id)
// Store only a display preference; no packets, coordinates or credentials.
const themeStorageKey = 'ailab-device-lab-theme'
function applyTheme(theme) {
  const dark = theme === 'dark'
  document.documentElement.dataset.theme = dark ? 'dark' : 'light'
  $('themeToggle').setAttribute('aria-pressed', String(dark))
  $('themeToggle').title = dark ? '切换为浅色模式' : '切换为深色模式'
  $('themeLabel').textContent = dark ? '切换浅色' : '切换深色'
}
let initialTheme = 'light'
try { if (localStorage.getItem(themeStorageKey) === 'dark') initialTheme = 'dark' } catch (_) { /* Storage may be disabled; switching still works. */ }
applyTheme(initialTheme)
$('themeToggle').onclick = () => {
  const theme = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark'
  applyTheme(theme)
  try { localStorage.setItem(themeStorageKey, theme) } catch (_) { /* Keep the current-tab preference in memory. */ }
}
let token = document.querySelector('meta[name="monitor-token"]').content
let state = null
let selected = null
let paused = false
let busy = false
let viewEpoch = 0
let lastGood = 0
let controllingReceiver = false
let controllingTunnel = false
let pairingCode = null
let labSelectionInitialized = false
const stateLabels = { preparing: '准备呼叫', calling: '发起呼叫', ringing: '等待接听', connecting: '建立媒体连接', connected: '上报接通', ending: '正在结束', ended: '已结束' }
const errors = { REJECTED: '孩子拒接', DEVICE_OFFLINE: '设备离线', NO_ANSWER: '无人接听 / 超时', LOCAL_CANCELLED: '本机停止模拟' }
function text(id, value) { $(id).textContent = value }
function time(value) { return value ? new Date(value).toLocaleTimeString('zh-CN', { hour12: false }) : '—' }
function el(tag, value, className) { const node = document.createElement(tag); if (value != null) node.textContent = value; if (className) node.className = className; return node }
async function request(path, body) {
  const res = await fetch(path, { method: body === undefined ? 'GET' : 'POST', headers: { 'x-monitor-token': token, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(5000), cache: 'no-store' })
  if (!res.ok) { const error = new Error((await res.json()).error || '请求失败'); error.status = res.status; throw error }
  return res.json()
}
function notify(message) { text('notice', message); $('notice').hidden = false }
async function reconnectMonitor() {
  // A restarted service has a new ephemeral token. Never retry a control POST.
  try {
    const response = await fetch('/', { cache: 'no-store', signal: AbortSignal.timeout(3000) })
    if (!response.ok) return
    const match = /name="monitor-token" content="([a-f0-9]{64})"/.exec(await response.text())
    if (match) token = match[1]
  } catch (_) { /* The normal poll retries when the service returns. */ }
}
async function action(button, path, body) {
  if (button.disabled) return
  button.disabled = true
  try { await request(path, body); $('notice').hidden = true; await poll() } catch (e) { notify(e.message) } finally { button.disabled = false }
}
function detail() {
  const event = state?.events.find(row => row.id === selected)
  $('facts').replaceChildren()
  text('detail', event ? event.summary : '选择左侧一条记录，检查报文长度、分包方式和解析结果。')
  if (event) {
    const fields = { 时间: time(event.at), 连接: event.connectionId, 类型: event.type, 字节数: event.bytes, 分包依据: event.boundary, 'CR / LF': event.lf !== undefined ? `${event.cr} / ${event.lf}` : undefined, 字面换行: event.literalCRLF === undefined ? undefined : event.literalCRLF ? '发现文字 \\r\\n，不是真换行' : '未发现', 错误码: event.code }
    for (const [key, value] of Object.entries(fields)) if (value != null) $('facts').append(el('dt', key), el('dd', value))
  }
  text('raw', event?.raw ? JSON.stringify(event.raw.text) + (event.raw.truncated ? '\n[仅显示前 512 字节]' : '') : state?.revealUntil > state?.now ? '只捕获开启后的新报文，请等待下一条上传。' : '原文已隐藏 / 已到期')
  text('hex', event?.raw?.hex || '—')
}
function renderEvents() {
  const filter = $('filter').value
  const rows = state.events.filter(row => filter === 'all' || (filter === 'error' ? row.level !== 'info' : ['bytes', 'frame'].includes(row.type))).slice().reverse()
  const fragment = document.createDocumentFragment()
  for (const row of rows) {
    const tr = el('tr', null, row.id === selected ? 'selected' : '')
    tr.append(el('td', time(row.at)), el('td', row.connectionId))
    const td = el('td'); const button = el('button', row.summary, 'row-button ' + row.level)
    button.onclick = () => { selected = row.id; renderEvents(); detail() }
    td.append(button); tr.append(td); fragment.append(tr)
  }
  $('events').replaceChildren(fragment); $('empty').hidden = rows.length > 0
  detail()
}
function renderMedia() {
  const media = state.media
  $('simulate').disabled = media.simulating
  $('stopMedia').disabled = !media.simulating
  const cards = document.createDocumentFragment()
  for (const session of media.sessions.slice().reverse()) {
    const card = el('article', null, 'session')
    const header = el('div', null, 'section-head')
    header.append(el('h3', session.callId), el('span', session.simulated ? '模拟数据' : '本机上报 · 来源未认证', 'badge amber'))
    card.append(header, el('div', `${session.mediaType === 'video' ? '视频' : '语音'} · ${stateLabels[session.state]}`, 'state'))
    const checks = el('div', null, 'checks')
    for (const [label, key] of [['孩子接听', 'childAccepted'], ['媒体就绪', 'mediaReady'], ...(session.mediaType === 'video' ? [['视频就绪', 'videoReady']] : [])]) checks.append(el('span', `${label}：${session[key] ? '已上报' : '未确认'}`))
    card.append(checks)
    if (session.connectedAt !== null) card.append(el('p', `从确认标记齐全起计时：${Math.max(0, Math.floor(((session.endedAt ?? state.now) - session.connectedAt) / 1000))} 秒（按本机收报时间）`, 'meta'))
    if (session.state === 'connected') card.append(el('p', session.confirmed ? '上报标记齐全，仍需真实样机确认双向通话。' : '确认条件不齐，不能认定已接通。', 'meta'))
    if (session.errorCode) card.append(el('p', errors[session.errorCode] || session.errorCode, 'error'))
    const metricNames = { rttMs: ['往返', 'ms'], jitterMs: ['抖动', 'ms'], packetLossPct: ['丢包', '%'], audioKbps: ['音频', 'kbps'], videoKbps: ['视频', 'kbps'], fps: ['帧率', 'fps'] }
    const quality = session.metrics.values ? Object.entries(session.metrics.values).map(([k, v]) => `${metricNames[k][0]} ${v} ${metricNames[k][1]}`).join(' · ') : '网络质量暂无数据；不会用 0 代替缺失值'
    card.append(el('div', quality, 'quality'))
    if (session.metrics.receivedAt) card.append(el('p', `${session.metrics.source} 上报于 ${time(session.metrics.receivedAt)} · 为最近一次采样，不保证持续有效`, 'meta'))
    cards.append(card)
  }
  $('sessions').replaceChildren(cards)
  const fragment = document.createDocumentFragment()
  for (const event of media.events.slice().reverse()) {
    const tr = el('tr')
    tr.append(el('td', `${time(event.receivedAt)} / ${event.source}`), el('td', `${event.simulated ? '[模拟] ' : '[上报] '}${event.callId}`), el('td', `${stateLabels[event.state]} · #${event.seq}${event.ignored ? ' · 忽略：' + event.ignored : ''}${event.errorCode ? ' · ' + (errors[event.errorCode] || event.errorCode) : ''}`, event.ignored || event.errorCode ? 'warning' : ''))
    fragment.append(tr)
  }
  $('mediaEvents').replaceChildren(fragment); $('mediaEmpty').hidden = media.events.length > 0
}
function render() {
  $('reveal').disabled = false; $('pairLab').disabled = false
  text('clock', time(state.now)); text('health', '● 本机监控正常'); $('health').className = 'pill'
  text('connections', state.connections.length); text('parsed', state.stats.parsed); text('rejected', state.stats.rejected)
  text('last', time(state.lastReceivedAt)); text('bytes', `累计收到 ${state.stats.bytes} 字节 · 含本机自测`)
  const t = state.tunnel
  const running = state.receiver.running
  const publicBusy = t.state === 'starting' || t.state === 'stopping'
  const publicExists = t.active || publicBusy
  text('publicBadge', t.state === 'starting' ? '正在开启' : t.state === 'stopping' ? '正在关闭' : t.active ? '公网已开启' : '公网未开启')
  $('publicBadge').className = t.active ? 'badge' : 'badge amber'
  text('publicHelp', t.active ? `测试地址：${t.endpoint.host}:${t.endpoint.port}。${running ? '请从定位页复制给工程师。' : '但本机接收已停，需重新开启接收。'}` : t.reason || '请先开启本机接收，再开启公网测试。')
  $('startPublic').disabled = !t.controllable || !running || publicExists || controllingTunnel || !$('publicConsent').checked
  $('stopPublic').disabled = !t.managed || !publicExists || t.state === 'stopping' || controllingTunnel
  $('publicMinutes').disabled = publicExists || controllingTunnel
  text('receiverBadge', running ? '接收已开启' : '接收已停止')
  $('receiverBadge').className = running ? 'badge' : 'badge amber'
  text('receiverHelp', running ? '正在等待上传。收到数据后，下方记录自动更新。' : '目前不会接收定位数据。点击“开启接收”即可恢复；监控窗口仍在运行。')
  $('startReceiver').disabled = running || state.receiver.changing || controllingReceiver
  $('stopReceiver').disabled = !running || state.receiver.changing || controllingReceiver
  $('test').disabled = !running || state.receiver.changing
  text('tunnelBadge', t.active ? '临时公网' : '仅本地')
  text('endpoint', t.active ? `${t.endpoint.host}:${t.endpoint.port}` : `127.0.0.1:${state.receiver.port}`)
  text('tunnelHelp', t.active ? '只供合成数据测试；地址分配不等于硬件连接成功。' : `${t.reason}。本机地址不能发给远程工程师。`)
  text('expires', t.active ? `剩余 ${Math.max(0, Math.ceil((t.expiresAt - state.now) / 60000))} 分钟${running ? '' : ' · 接收已停，暂不可上传'}` : '公网未开启')
  $('copy').disabled = !t.active || !running
  const fixed = state.receiver.framing === 'fixed17'
  text('protocol', `分包：${fixed ? '固定 17 字节 · DDD.dddd_DD.ddddd · 无需换行 · 开头注册 JSON 单独识别' : state.receiver.framing} / 回包：${state.receiver.ack === 'none' ? '不回复' : state.receiver.ack} / 坐标系：${state.receiver.coordinateSystem}`)
  $('scene').options[0].textContent = fixed ? '完整 17 字节坐标（无换行）' : '完整坐标 + CRLF'
  $('scene').options[1].textContent = fixed ? '字节不足（应报错）' : '缺少换行符'
  $('scene').options[2].textContent = fixed ? '注册 JSON + 坐标粘包' : '设备注册 JSON'
  const revealing = state.revealUntil > state.now
  text('reveal', revealing ? `立即隐藏 · 剩余 ${Math.ceil((state.revealUntil - state.now) / 1000)} 秒` : '临时查看原文 · 60 秒')
  text('privacy', revealing ? '正在临时捕获新报文；不要录屏或转发。到期自动清除。' : '默认隐藏原文、HEX 和坐标；只保留最近 5 分钟的诊断摘要。')
  renderEvents(); renderMedia(); renderLab()
}
function renderLab() {
  const lab = state.lab
  if (!lab) return
  const selectedConnection = labSelectionInitialized ? $('labConnection').value : lab.connectionId || ''
  if (!labSelectionInitialized) $('labCoordinates').value = lab.coordinateSystem || 'UNKNOWN'
  labSelectionInitialized = true
  const options = document.createDocumentFragment()
  const empty = el('option', '暂不接定位（仅通话状态模拟）'); empty.value = ''; options.append(empty)
  for (const connection of state.connections) { const option = el('option', connection.id + (connection.hasCoordinate ? ' · 已收到上报' : ' · 等待上报')); option.value = connection.id; options.append(option) }
  if (selectedConnection && !state.connections.some(c => c.id === selectedConnection)) {
    const offline = el('option', selectedConnection + ' · 已断开（请选择新连接）'); offline.value = selectedConnection; offline.disabled = true; options.append(offline)
  }
  $('labConnection').replaceChildren(options)
  $('labConnection').value = selectedConnection
  text('labBadge', lab.paired ? '小程序已配对' : lab.pairingExpiresAt ? '等待输入配对码' : '未配对')
  $('revokeLab').disabled = !lab.paired && !lab.pairingExpiresAt
  if (lab.paired || !lab.pairingExpiresAt || (pairingCode && pairingCode.expiresAt <= state.now)) pairingCode = null
  text('labCode', pairingCode ? `一次性配对码：${pairingCode.code} · ${time(pairingCode.expiresAt)} 前输入（重新生成会撤销旧配对）` : lab.paired ? `配对有效至 ${time(lab.expiresAt)}；关闭或重启小程序后需重新配对。` : '配对码仅显示在本窗口，不发给硬件工程师。')
  text('labHelp', `当前来源：${lab.connectionId || '未选择定位连接'} / ${lab.coordinateSystem}。断开不自动换设备；30 秒无新上报清点，仅是联调展示时限，不代表设备采集有效期。`)
  const c = lab.call
  text('labCall', c ? `${c.id} · ${c.mediaType === 'video' ? '视频' : '语音'} · ${stateLabels[c.state]}（仅本机模拟）${c.reason ? ' · ' + c.reason : ''}` : '尚无小程序模拟会话。先配对，在守护页发起语音或视频模拟。')
  for (const b of document.querySelectorAll('[data-lab-call]')) {
    const action = b.dataset.labCall
    const required = { ringing: 'calling', accept: 'ringing', connected: 'connecting' }[action]
    b.disabled = !lab.paired || !c || c.state === 'ended' || Boolean(required && c.state !== required)
  }
}
function eraseSensitive() {
  pairingCode = null; text('labCode', '窗口隐藏或服务离线，配对码已隐藏；需要时重新生成。')
  if (state) { state.events.forEach(e => { e.raw = null }); state.connections.forEach(c => { c.coordinate = null }); state.revealUntil = 0 }
  text('raw', '监控离线或窗口隐藏，原文已清除'); text('hex', '—')
}
async function poll() {
  if (busy || paused) return
  busy = true
  const epoch = viewEpoch
  try { const next = await request('/api/state'); if (paused || epoch !== viewEpoch) return; state = next; lastGood = Date.now(); render() }
  catch (error) { if (epoch !== viewEpoch) return; unavailable(); if (error.status === 403) await reconnectMonitor() }
  finally { busy = false }
}
function unavailable() {
  eraseSensitive(); state = null; lastGood = 0
  text('health', '● 状态未确认，等待重新连接'); $('health').className = 'pill offline'
  for (const id of ['copy', 'startReceiver', 'stopReceiver', 'startPublic', 'stopPublic', 'test', 'reveal', 'pairLab', 'revokeLab', 'simulate', 'stopMedia']) $(id).disabled = true
  for (const button of document.querySelectorAll('[data-lab-call]')) button.disabled = true
  text('receiverBadge', '状态未知'); text('publicBadge', '状态未知'); text('endpoint', '状态未确认，不可使用旧地址'); text('expires', '等待重新查询')
  text('receiverHelp', '正在自动重连。若已主动停用后台服务，请双击启动脚本。'); text('tunnelHelp', '无法确认当前公网状态，请先检查接收程序。')
  $('sessions').replaceChildren(); $('mediaEvents').replaceChildren()
  text('labCall', '状态未确认，请等待刷新。')
}
for (const tab of document.querySelectorAll('[data-tab]')) tab.onclick = () => {
  for (const button of document.querySelectorAll('[data-tab]')) { const active = tab === button; button.classList.toggle('active', active); button.setAttribute('aria-selected', String(active)); $(button.dataset.tab).hidden = !active }
}
$('filter').onchange = () => state && renderEvents()
async function controlReceiver(start) {
  if (controllingReceiver) return
  controllingReceiver = true
  $('startReceiver').disabled = true; $('stopReceiver').disabled = true
  text('receiverHelp', start ? '正在开启接收……' : '正在停止接收并断开连接……')
  try {
    await request('/api/receiver/' + (start ? 'start' : 'stop'), {})
    if (!start) eraseSensitive()
    notify(start ? '本机接收已开启。远程上传还需要有效的公网入口。' : '本机接收已停止，当前设备连接已断开。窗口和音视频监控继续运行。')
  } catch (e) { notify(e.message) } finally { controllingReceiver = false; await poll() }
}
$('startReceiver').onclick = () => controlReceiver(true)
$('stopReceiver').onclick = () => controlReceiver(false)
$('publicConsent').onchange = () => { if (state) render() }
async function controlPublic(start) {
  if (controllingTunnel) return
  if (start && !$('publicConsent').checked) return notify('请先确认只发送合成测试数据。')
  controllingTunnel = true
  $('startPublic').disabled = true; $('stopPublic').disabled = true
  try {
    await request('/api/tunnel/' + (start ? 'start' : 'stop'), start ? { syntheticOnly: true, lifetimeMinutes: Number($('publicMinutes').value) } : {})
    notify(start ? '正在申请公网地址，通常需要几秒。地址出现后再发给工程师。' : '公网测试已关闭；本机接收和监控窗口继续运行。')
    if (!start) $('publicConsent').checked = false
  } catch (e) { notify(e.message) } finally { controllingTunnel = false; await poll() }
}
$('startPublic').onclick = () => controlPublic(true)
$('stopPublic').onclick = () => controlPublic(false)
$('test').onclick = () => action($('test'), '/api/test', { scene: $('scene').value })
$('clear').onclick = () => action($('clear'), '/api/clear', {})
$('reveal').onclick = () => {
  if (state?.revealUntil > state?.now) return action($('reveal'), '/api/hide', {})
  if (confirm('仅在本机临时查看新报文，最多 60 秒。报文可能包含位置或设备标识，请勿录屏转发。继续？')) action($('reveal'), '/api/reveal', { confirmLocalOnly: true })
}
$('simulate').onclick = () => action($('simulate'), '/api/media/simulate', { mediaType: $('mediaType').value, outcome: $('outcome').value })
$('stopMedia').onclick = () => action($('stopMedia'), '/api/media/stop', {})
$('clearMedia').onclick = () => action($('clearMedia'), '/api/media/clear', {})
$('pairLab').onclick = async () => {
  if ($('pairLab').disabled) return
  $('pairLab').disabled = true
  try { pairingCode = await request('/api/lab/pairing', { connectionId: $('labConnection').value || null, coordinateSystem: $('labCoordinates').value, confirm: true }); await poll() }
  catch(e) { notify(e.message) } finally { $('pairLab').disabled = false }
}
$('revokeLab').onclick = () => { pairingCode = null; return action($('revokeLab'), '/api/lab/revoke', {}) }
for (const b of document.querySelectorAll('[data-lab-call]')) b.onclick = () => action(b, '/api/lab/call', { action: b.dataset.labCall, callId: state?.lab?.call?.id })
$('copy').onclick = async () => {
  if (!state?.receiver.running || !state?.tunnel.active || Date.now() - lastGood > 3000 || state.tunnel.expiresAt <= Date.now()) return notify('接收未开启或地址状态已过期，请等待刷新后再复制。')
  const t = state.tunnel
  const protocol = state.receiver.framing === 'fixed17' ? '固定 17 字节 ASCII：DDD.dddd_DD.ddddd，例如 120.0001_30.00010；无需换行。连接开头可先发一条完整注册 JSON；随后每 10 秒发送坐标，小数末尾零必须保留' : '经度_纬度，末尾真正的 CRLF（0D 0A）'
  const value = `本轮合成坐标 TCP 测试地址：${t.endpoint.host}，端口：${t.endpoint.port}。格式为${protocol}，无需回复。到期时间：${new Date(t.expiresAt).toLocaleString('zh-CN')}。请只发送合成坐标，不发真实儿童位置或真实设备标识。`
  try { await navigator.clipboard.writeText(value); notify('已复制测试说明，发送前请确认仍在有效期内。') } catch (_) { notify('浏览器未允许复制，请手动复制页面上的当前地址与端口。') }
}
document.addEventListener('visibilitychange', () => { viewEpoch++; paused = document.hidden; unavailable(); if (paused) request('/api/hide', {}).catch(() => {}); else poll() })
setInterval(() => { if (state?.revealUntil && Date.now() >= state.revealUntil) eraseSensitive(); poll() }, 1000)
poll()
