const api = require('../../services/api')
const util = require('../../utils/util')
const shared = require('./page-utils')
function wrapText(ctx, text, width) {
  const lines = []
  String(text || '').split('\n').forEach((paragraph) => {
    if (!paragraph) { lines.push(''); return }
    let line = ''
    Array.from(paragraph).forEach((character) => {
      const next = line + character
      if (line && ctx.measureText(next).width > width) { lines.push(line); line = character }
      else line = next
    })
    lines.push(line)
  })
  return lines
}
Page({
  data: { preview: {}, loading: true, generatingImage: false, saving: false, error: '', imageError: '', saveError: '', filePath: '', canvasHeight: 620, canShare: false, hiddenText: '' },
  onLoad(q) {
    this.__disposed = false
    this.target = { targetType: q.targetType || 'report', targetId: q.targetId || q.id || '', childId: q.childId || '' }
    this.load()
  },
  onShow() {
    const store = require('../../services/store')
    const context = store.getCurrentChildId() + ':' + store.getEpoch()
    if (this.loadedContext && context !== this.loadedContext) this.load()
  },
  load() {
    if (!util.guardAuth()) return
    const version = util.beginRequest(this, 'share')
    util.beginRequest(this, 'image')
    const store = require('../../services/store')
    this.loadedContext = store.getCurrentChildId() + ':' + store.getEpoch()
    util.safeSetData(this, { loading: true, generatingImage: false, saving: false, error: '', imageError: '', saveError: '', filePath: '', canShare: false })
    return api.getSharePreview(this.target).then((preview) => {
      if (!util.isRequestCurrent(this, 'share', version)) return
      if (preview.targetId !== this.target.targetId || preview.targetType !== this.target.targetType || (this.target.childId && preview.childId !== this.target.childId)) throw new Error('分享内容与当前记录不匹配，请返回后重试')
      const canShare = preview.canShare !== false && !preview.generating
      util.safeSetData(this, { preview, loading: false, canShare, hiddenText: (preview.hidden || []).join('、') }, () => { if (canShare) this.generate() })
    }).catch((e) => {
      if (util.isRequestCurrent(this, 'share', version)) util.safeSetData(this, { loading: false, error: shared.errorText(e), canShare: false })
    })
  },
  generate() {
    if (!this.data.canShare || this.data.generatingImage) return
    const version = util.beginRequest(this, 'image')
    util.safeSetData(this, { generatingImage: true, imageError: '', filePath: '' })
    try {
      const ctx = wx.createCanvasContext('shareCanvas', this)
      const preview = this.data.preview
      ctx.setFontSize(25)
      const titles = wrapText(ctx, preview.title, 311)
      ctx.setFontSize(15)
      const body = wrapText(ctx, preview.body, 307)
      const meta = wrapText(ctx, [preview.childAlias || '孩子', preview.range].filter(Boolean).join(' · '), 307)
      const height = Math.max(620, 204 + titles.length * 35 + meta.length * 23 + body.length * 25 + 102)
      util.safeSetData(this, { canvasHeight: height }, () => {
        if (!util.isRequestCurrent(this, 'image', version)) return
        ctx.setFillStyle('#eaf5fb'); ctx.fillRect(0, 0, 375, height)
        ctx.setFillStyle('#ffffff'); ctx.fillRect(16, 16, 343, height - 32)
        ctx.setFillStyle('#158ab1'); ctx.fillRect(32, 40, 32, 4)
        ctx.setFontSize(12); ctx.setFillStyle('#2382a5'); ctx.fillText('AILAB  /  探索成长记录', 32, 72)
        let y = 114
        ctx.setFontSize(25); ctx.setFillStyle('#123a63')
        titles.forEach((line) => { ctx.fillText(line, 32, y); y += 35 })
        y += 10; ctx.setFontSize(13); ctx.setFillStyle('#6a8ba1')
        meta.forEach((line) => { ctx.fillText(line, 32, y); y += 23 })
        y += 20; ctx.setStrokeStyle('#daeaf3'); ctx.setLineWidth(1); ctx.beginPath(); ctx.moveTo(32,y); ctx.lineTo(343,y); ctx.stroke()
        y += 34; ctx.setFontSize(15); ctx.setFillStyle('#355c79')
        body.forEach((line) => { ctx.fillText(line, 34, y); y += 25 })
        ctx.setFontSize(11); ctx.setFillStyle('#7c9aaf')
        ctx.fillText('已隐藏全名、设备及家庭敏感信息', 32, height - 72)
        ctx.fillText('探索覆盖不是能力评分 · 家长自主选择分享', 32, height - 50)
        ctx.draw(false, () => {
          if (!util.isRequestCurrent(this, 'image', version)) return
          wx.canvasToTempFilePath({
            canvasId: 'shareCanvas', width: 375, height, destWidth: 750, destHeight: height * 2, fileType: 'png',
            success: (result) => {
              if (util.isRequestCurrent(this, 'image', version)) util.safeSetData(this, { filePath: result.tempFilePath, generatingImage: false })
            },
            fail: (e) => {
              if (util.isRequestCurrent(this, 'image', version)) util.safeSetData(this, { generatingImage: false, imageError: shared.errorText(e, '图片生成失败，请重试') })
            }
          }, this)
        })
      })
    } catch (e) {
      if (util.isRequestCurrent(this, 'image', version)) util.safeSetData(this, { generatingImage: false, imageError: shared.errorText(e, '图片生成失败，请重试') })
    }
  },
  previewImage() {
    if (this.previewCurrent() && this.data.filePath) wx.previewImage({ current: this.data.filePath, urls: [this.data.filePath] })
  },
  previewCurrent() {
    if (!util.guardAuth()) return false
    const store = require('../../services/store')
    if (this.loadedContext !== store.getCurrentChildId() + ':' + store.getEpoch()) { this.load(); return false }
    return this.data.canShare
  },
  save() {
    if (!this.previewCurrent() || !this.data.filePath || this.data.saving) return
    const version = util.beginRequest(this, 'save')
    util.safeSetData(this, { saving: true, saveError: '' })
    wx.saveImageToPhotosAlbum({
      filePath: this.data.filePath,
      success: () => {
        if (!util.isRequestCurrent(this, 'save', version)) return
        util.safeSetData(this, { saving: false })
        util.toast('已保存到相册', 'success')
      },
      fail: (e) => {
        if (!util.isRequestCurrent(this, 'save', version)) return
        const denied = /auth|deny|denied|cancel/.test((e && e.errMsg) || '')
        util.safeSetData(this, { saving: false, saveError: denied ? '未获得相册权限或已取消保存。预览已保留，可重新保存或打开图片。' : '保存失败，预览已保留，请检查系统相册权限后重试。' })
      }
    })
  },
  onUnload() { util.disposePage(this) }
})
