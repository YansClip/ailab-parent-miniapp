Page({
  retry() { wx.navigateBack() },
  exit() { wx.exitMiniProgram && wx.exitMiniProgram() }
})
