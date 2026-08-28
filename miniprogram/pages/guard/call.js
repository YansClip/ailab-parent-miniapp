const api = require('../../services/api')
const store = require('../../services/store')
const util = require('../../utils/util')

Page({
  data: {
    stage: 'ready',
    title: '准备呼叫',
    desc: '将检查设备在线与通话能力',
    child: '小满',
    muted: false,
    speaker: false,
    nr: false,
    taskId: '',
    busy: false
  },
  onLoad() {
    const id = store.getCurrentChildId()
    this.setData({ child: id === 'child-xinghe' ? '星河' : '小满' })
  },
  startCall() {
    if (this.data.busy || this.data.stage === 'calling') return
    this.setData({ busy: true, stage: 'calling', title: '呼叫中', desc: '正在检查设备在线状态…' })
    api.getChildren().then((list) => {
      const id = store.getCurrentChildId()
      const child = (list || []).find((c) => c.id === id) || {}
      if (!child.online) {
        this.setData({
          stage: 'failed',
          title: '设备离线',
          desc: '离线时无法发起语音通话。待设备上线后重试。',
          busy: false
        })
        return null
      }
      return api.submitTask('voice-call', {}).then((t) => {
        this.setData({ taskId: t.id, desc: '等待设备接听…' })
        return util.pollTask(t.id).then((x) => {
          if (x.status === 'success') {
            this.setData({ stage: 'connected', title: '已接通', desc: '可静音、扬声器或智能降噪', busy: false })
          } else {
            this.setData({
              stage: 'failed',
              title: '未能接通',
              desc: x.message || '设备忙、离线或超时。可重试。',
              busy: false
            })
          }
        })
      })
    }).catch((e) => {
      util.failToast(e)
      this.setData({ stage: 'failed', title: '未能接通', desc: (e && e.message) || '请稍后重试', busy: false })
    })
  },
  hang() {
    this.setData({ stage: 'ready', title: '通话已结束', desc: '未保存通话内容。可重新呼叫。', busy: false })
  },
  retry() {
    this.setData({ stage: 'ready', title: '准备呼叫', desc: '将检查设备在线与通话能力', busy: false })
  },
  toggleMute() { this.setData({ muted: !this.data.muted }) },
  toggleSpk() { this.setData({ speaker: !this.data.speaker }) },
  toggleNr() { this.setData({ nr: !this.data.nr }) }
})
