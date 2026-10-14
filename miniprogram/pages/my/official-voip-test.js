const { createRehearsal } = require('../../services/device/official-rehearsal')
Page({
  data: { view: null, error: '', direction: 'phone-to-device', mediaType: 'voice' },
  onLoad() { this.rehearsal = createRehearsal(); this.refresh() },
  onShow() { if (!this.rehearsal) this.rehearsal = createRehearsal(); this.refresh() },
  onHide() { this.clear() },
  onUnload() { if (this.rehearsal) this.rehearsal.reset(); this.rehearsal = null },
  clear() { if (this.rehearsal) { this.rehearsal.reset(); this.refresh() } },
  refresh() { this.setData({ view: this.rehearsal.snapshot(), error: '' }) },
  run(work) {
    if (!this.rehearsal) return
    try { work(); this.refresh() }
    catch (e) { this.setData({ view: this.rehearsal.snapshot(), error: e.message || '模拟操作未完成' }) }
  },
  chooseDirection(e) { if (!this.data.view.active) this.setData({ direction: e.detail.value, error: '' }) },
  chooseMedia(e) { if (!this.data.view.active) this.setData({ mediaType: e.detail.value, error: '' }) },
  changePolicy(e) { this.run(() => this.rehearsal.policy(e.currentTarget.dataset.name, e.detail.value)) },
  changeReminder(e) { this.run(() => this.rehearsal.policy('incomingReminder', e.detail.value ? 'authorized' : 'missing')) },
  start() { this.run(() => this.rehearsal.start(this.data.direction, this.data.mediaType)) },
  step(e) {
    this.run(() => {
      const type = e.currentTarget.dataset.type, receiver = this.data.view.receiver
      const actor = ['accept', 'reject'].includes(type) ? receiver : type === 'cancel' ? (receiver === 'phone' ? 'device' : 'phone') : 'phone'
      this.rehearsal.event(type, actor)
    })
  },
  advance() { this.run(() => this.rehearsal.advance()) },
  reset() { this.clear() }
})
