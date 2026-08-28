#!/usr/bin/env python3
"""Generate remaining WeChat miniprogram pages."""
from pathlib import Path

ROOT = Path("/Users/sc/WeChatProjects/miniprogram-1/miniprogram/pages")

NAV_JSON = """{
  "usingComponents": {
    "nav-bar": "/components/nav-bar/index"
  }
}
"""

NAV_EMPTY = """{
  "usingComponents": {
    "nav-bar": "/components/nav-bar/index",
    "empty-state": "/components/empty-state/index"
  }
}
"""

FOOTER = ".footer { padding: 24rpx 40rpx calc(24rpx + env(safe-area-inset-bottom)); }\n.card-p { padding: 32rpx; }\n.item { background:#fff; border-radius:32rpx; padding:28rpx; margin-top:16rpx; box-shadow: 0 8rpx 24rpx rgba(16,42,67,.06); }\n.danger { color:#e85d69; }\n.status { font-size:24rpx; color:#40b352; }\n.call-stage { text-align:center; padding:80rpx 40rpx; }\n.big { font-size:40rpx; font-weight:700; }\n.actions { display:flex; justify-content:center; gap:32rpx; margin-top:48rpx; }\n.fab { width:112rpx; height:112rpx; border-radius:40rpx; display:flex; align-items:center; justify-content:center; color:#fff; font-size:24rpx; }\n.share-mask { position:fixed; inset:0; background:rgba(16,42,67,.4); display:flex; align-items:flex-end; }\n.share-sheet { width:100%; background:#fff; border-radius:32rpx 32rpx 0 0; padding:32rpx 32rpx calc(24rpx + env(safe-area-inset-bottom)); }\n"

def write(rel, json_s, wxml, js, wxss=""):
    d = ROOT / rel
    d.mkdir(parents=True, exist_ok=True)
    (d / "index.json").write_text(json_s, encoding="utf-8")
    (d / "index.wxml").write_text(wxml.strip() + "\n", encoding="utf-8")
    (d / "index.js").write_text(js.strip() + "\n", encoding="utf-8")
    (d / "index.wxss").write_text((wxss or FOOTER), encoding="utf-8")
    print("wrote", rel)

# Some pages already live as path/file.js not path/index.js
# Our app.json uses pages/home/footprint not pages/home/footprint/index
# So files should be footprint.js not footprint/index.js

def write_files(rel, json_s, wxml, js, wxss=""):
    """rel like home/footprint -> pages/home/footprint.js etc."""
    d = ROOT / Path(rel).parent
    name = Path(rel).name
    d.mkdir(parents=True, exist_ok=True)
    (d / f"{name}.json").write_text(json_s, encoding="utf-8")
    (d / f"{name}.wxml").write_text(wxml.strip() + "\n", encoding="utf-8")
    (d / f"{name}.js").write_text(js.strip() + "\n", encoding="utf-8")
    (d / f"{name}.wxss").write_text((wxss or FOOTER), encoding="utf-8")
    print("wrote", rel)

pages = []

pages.append(("home/footprint", NAV_JSON, """
<view class="page">
  <nav-bar title="兴趣足迹" action="{{followed ? '已关注' : '关注'}}" bind:action="toggle" />
  <view class="pad">
    <view class="pill pill-lavender">{{item.type}}</view>
    <text class="h1 mt-16">{{item.title}}</text>
    <text class="sub mt-8">{{item.date}} · {{item.scene}}</text>
    <view class="card card-p mt-20">
      <text class="h3">事件摘要</text>
      <text class="sub mt-8">{{item.summary}}</text>
    </view>
    <view class="card card-p mt-16">
      <text class="h3">关联概念</text>
      <view class="row mt-12" style="flex-wrap:wrap;gap:12rpx;">
        <view class="pill pill-mint" wx:for="{{item.concepts}}" wx:key="*this">{{item}}</view>
      </view>
    </view>
    <view class="card card-p mt-16">
      <text class="h3">后续探索</text>
      <text class="sub mt-8">{{item.follow}}</text>
    </view>
    <text class="sub mt-16">来源：{{item.source}}。足迹仅家庭可见，关注不会形成公开点赞或排名。</text>
  </view>
</view>
""", """
const api = require('../../services/api')
const store = require('../../services/store')
Page({
  data: { item: {}, followed: false },
  onLoad(q) {
    api.getFootprint(q.id || 'fp1').then((item) => this.setData({ item, followed: item.followed }))
  },
  toggle() {
    const on = store.toggleFollow(this.data.item.id)
    this.setData({ followed: on })
    wx.showToast({ title: on ? '已关注，仅自己可见' : '已取消关注', icon: 'none' })
  }
})
"""))

pages.append(("home/feed", NAV_JSON, """
<view class="page">
  <nav-bar title="全部动态" />
  <view class="pad">
    <view class="item" wx:for="{{list}}" wx:key="id">
      <text class="h3">{{item.title}}</text>
      <text class="sub">{{item.desc}} · {{item.time}}</text>
    </view>
  </view>
</view>
""", """
const api = require('../../services/api')
Page({
  data: { list: [] },
  onShow() {
    api.getHome().then((h) => this.setData({ list: h.dynamics || [] }))
  }
})
"""))

# CALL
pages.append(("guard/call", NAV_JSON, """
<view class="page">
  <nav-bar title="语音通话" />
  <view class="call-stage">
    <view class="avatar-lg">{{child}}</view>
    <text class="big mt-16">{{title}}</text>
    <text class="sub mt-8">{{desc}}</text>
    <view class="actions">
      <view class="fab" style="background:#61758a;" wx:if="{{stage==='connected'}}" bindtap="toggleMute">{{muted ? '取消静音' : '静音'}}</view>
      <view class="fab" style="background:#1ac7cc;" wx:if="{{stage==='connected'}}" bindtap="toggleSpk">{{speaker ? '听筒' : '扬声器'}}</view>
      <view class="fab" style="background:#8b78e6;" wx:if="{{stage==='connected'}}" bindtap="toggleNr">{{nr ? '降噪开' : '降噪'}}</view>
    </view>
  </view>
  <view class="footer">
    <button class="btn btn-primary" wx:if="{{stage==='ready'}}" bindtap="startCall">呼叫 Mini</button>
    <button class="btn btn-danger" wx:if="{{stage==='calling' || stage==='connected'}}" bindtap="hang">结束通话</button>
    <button class="btn btn-secondary mt-12" wx:if="{{stage==='failed'}}" bindtap="retry">失败重试</button>
    <text class="sub mt-12" style="text-align:center;display:block;">不启用摄像头，不保存通话内容。</text>
  </view>
</view>
""", """
const api = require('../../services/api')
const store = require('../../services/store')
Page({
  data: { stage: 'ready', title: '准备呼叫', desc: '将检查设备在线与通话能力', child: '小满', muted: false, speaker: false, nr: false, taskId: '' },
  onLoad() {
    const id = store.getCurrentChildId()
    this.setData({ child: id === 'child-xinghe' ? '星河' : '小满' })
  },
  startCall() {
    this.setData({ stage: 'calling', title: '呼叫中', desc: '等待设备接听…' })
    api.submitTask('voice-call', {}).then((t) => {
      this.setData({ taskId: t.id })
      setTimeout(() => {
        if (store.getScenario() === 'fail') {
          this.setData({ stage: 'failed', title: '未能接通', desc: '设备忙、离线或超时。可重试。' })
        } else {
          this.setData({ stage: 'connected', title: '已接通', desc: '可静音、扬声器或智能降噪' })
        }
      }, 1600)
    })
  },
  hang() {
    this.setData({ stage: 'ready', title: '通话已结束', desc: '未保存通话内容。可重新呼叫。' })
  },
  retry() { this.setData({ stage: 'ready', title: '准备呼叫', desc: '将检查设备在线与通话能力' }) },
  toggleMute() { this.setData({ muted: !this.data.muted }) },
  toggleSpk() { this.setData({ speaker: !this.data.speaker }) },
  toggleNr() { this.setData({ nr: !this.data.nr }) }
})
""", FOOTER + ".avatar-lg { width:160rpx;height:160rpx;border-radius:56rpx;background:#f0ebff;color:#8b78e6;font-size:40rpx;font-weight:700;display:flex;align-items:center;justify-content:center;margin:0 auto; }\n"))

pages.append(("guard/contacts", NAV_JSON, """
<view class="page">
  <nav-bar title="通讯录" action="新增" bind:action="add" />
  <view class="pad">
    <view class="item" wx:for="{{list}}" wx:key="id" data-id="{{item.id}}" bindtap="edit">
      <view class="between">
        <view>
          <text class="h3">{{item.name}}</text>
          <text class="sub">{{item.relation}} · {{item.phone}}</text>
        </view>
        <text class="status">{{item.deviceCall ? '可通话' : '仅保存'}}</text>
      </view>
    </view>
  </view>
</view>
""", """
const api = require('../../services/api')
Page({
  data: { list: [] },
  onShow() { api.getContacts().then((list) => this.setData({ list })) },
  add() { wx.navigateTo({ url: '/pages/guard/contact-edit' }) },
  edit(e) { wx.navigateTo({ url: '/pages/guard/contact-edit?id=' + e.currentTarget.dataset.id }) }
})
"""))

pages.append(("guard/contact-edit", NAV_JSON, """
<view class="page">
  <nav-bar title="{{id ? '编辑联系人' : '新增联系人'}}" />
  <view class="pad">
    <input class="input" placeholder="姓名" value="{{name}}" bindinput="setName" />
    <input class="input mt-12" placeholder="关系" value="{{relation}}" bindinput="setRel" />
    <input class="input mt-12" placeholder="手机号" value="{{phone}}" bindinput="setPhone" />
    <view class="item mt-16 between" bindtap="toggle">
      <text>允许设备通话</text>
      <text class="status">{{deviceCall ? '开' : '关'}}</text>
    </view>
    <text class="sub mt-16">保存后显示后台已受理、设备同步中、同步成功或失败。</text>
    <text class="status mt-8" wx:if="{{task}}">{{task.message}}（{{task.status}}）</text>
  </view>
  <view class="footer">
    <button class="btn btn-primary" bindtap="save">保存并同步到设备</button>
    <button class="btn btn-ghost mt-12" wx:if="{{id}}" bindtap="remove">删除</button>
  </view>
</view>
""", """
const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { id: '', name: '', relation: '', phone: '', deviceCall: true, task: null },
  onLoad(q) { this.setData({ id: q.id || '' }) },
  setName(e) { this.setData({ name: e.detail.value }) },
  setRel(e) { this.setData({ relation: e.detail.value }) },
  setPhone(e) { this.setData({ phone: e.detail.value }) },
  toggle() { this.setData({ deviceCall: !this.data.deviceCall }) },
  save() {
    api.saveContact(this.data).then((t) => {
      this.setData({ task: t })
      this.poll(t.id)
    })
  },
  poll(id) {
    setTimeout(() => api.getTask(id).then((t) => {
      this.setData({ task: t })
      if (t.status === 'submitted' || t.status === 'executing') this.poll(id)
      else util.toast(t.message)
    }), 700)
  },
  async remove() {
    const ok = await util.confirm('删除联系人', '删除前将检查是否被紧急联系人引用。')
    if (!ok) return
    api.submitTask('contact-delete', { id: this.data.id }).then(() => {
      util.toast('已提交删除')
      wx.navigateBack()
    })
  }
})
"""))

pages.append(("guard/find", NAV_JSON, """
<view class="page">
  <nav-bar title="查找设备" />
  <view class="pad">
    <text class="h1">{{title}}</text>
    <text class="sub mt-12">{{desc}}</text>
    <view class="card card-p mt-24" wx:if="{{stage==='ringing'}}">
      <text class="h3">设备响铃中</text>
      <text class="sub">剩余 {{left}} 秒，最长 60 秒。离开页面后任务仍由后台维护。</text>
    </view>
  </view>
  <view class="footer">
    <button class="btn btn-primary" wx:if="{{stage==='start'}}" bindtap="start">确认响铃查找</button>
    <button class="btn btn-secondary" wx:if="{{stage==='ringing'}}" bindtap="stop">手动停止</button>
    <button class="btn btn-primary" wx:if="{{stage==='found' || stage==='timeout' || stage==='offline'}}" bindtap="reset">再次查找</button>
  </view>
</view>
""", """
const api = require('../../services/api')
const store = require('../../services/store')
Page({
  data: { stage: 'start', title: '让 Mini 响铃', desc: '响铃可能打扰身边的人，请确认后再提交。单次最长 60 秒。', left: 60, timer: null, taskId: '' },
  start() {
    const childOffline = store.getCurrentChildId() === 'child-xinghe' || store.getScenario() === 'offline'
    if (childOffline) {
      this.setData({ stage: 'offline', title: '设备离线', desc: '离线时不能发起查找。请待设备上线后重试。' })
      return
    }
    api.submitTask('find-device', {}).then((t) => {
      this.setData({ stage: 'ringing', title: '正在查找', desc: '请求已提交，设备响铃中。', left: 60, taskId: t.id })
      const timer = setInterval(() => {
        const left = this.data.left - 1
        if (left <= 0) {
          clearInterval(timer)
          this.setData({ stage: 'timeout', title: '查找超时', desc: '可再次发起。超时不等于设备未执行，可查询最终状态。', left: 0 })
        } else this.setData({ left })
      }, 1000)
      this.timer = timer
      setTimeout(() => {
        if (this.data.stage === 'ringing' && store.getScenario() !== 'timeout') {
          clearInterval(this.timer)
          this.setData({ stage: 'found', title: '已找到设备', desc: 'Mini 已响应响铃。' })
        }
      }, 4000)
    })
  },
  stop() {
    if (this.timer) clearInterval(this.timer)
    this.setData({ stage: 'found', title: '已手动停止', desc: '响铃已停止。' })
  },
  reset() { this.setData({ stage: 'start', title: '让 Mini 响铃', desc: '响铃可能打扰身边的人，请确认后再提交。单次最长 60 秒。' }) },
  onUnload() { if (this.timer) clearInterval(this.timer) }
})
"""))

pages.append(("guard/alarm", NAV_JSON, """
<view class="page">
  <nav-bar title="闹钟" action="新建" bind:action="add" />
  <view class="pad">
    <view class="item" wx:for="{{list}}" wx:key="id" data-id="{{item.id}}" bindtap="edit">
      <view class="between">
        <view>
          <text class="h1">{{item.time}}</text>
          <text class="sub">{{item.label}} · {{item.repeat}}</text>
        </view>
        <text class="status">{{item.enabled ? '开启 · 已同步' : '关闭'}}</text>
      </view>
    </view>
  </view>
</view>
""", """
const api = require('../../services/api')
Page({
  data: { list: [] },
  onShow() { api.getAlarms().then((list) => this.setData({ list })) },
  add() { wx.navigateTo({ url: '/pages/guard/alarm-edit' }) },
  edit(e) { wx.navigateTo({ url: '/pages/guard/alarm-edit?id=' + e.currentTarget.dataset.id }) }
})
"""))

pages.append(("guard/alarm-edit", NAV_JSON, """
<view class="page">
  <nav-bar title="{{id ? '编辑闹钟' : '新建闹钟'}}" />
  <view class="pad">
    <picker mode="time" value="{{time}}" bindchange="onTime">
      <view class="item between"><text>时间</text><text>{{time}}</text></view>
    </picker>
    <input class="input mt-12" value="{{label}}" bindinput="onLabel" placeholder="标签" />
    <view class="item mt-12 between" bindtap="toggle"><text>启用</text><text>{{enabled ? '开' : '关'}}</text></view>
    <text class="sub mt-16">提交后显示保存结果和设备同步状态。启停以设备最终状态为准。</text>
    <text class="status mt-8" wx:if="{{task}}">{{task.message}}</text>
  </view>
  <view class="footer">
    <button class="btn btn-primary" bindtap="save">保存并同步</button>
    <button class="btn btn-ghost danger mt-12" wx:if="{{id}}" bindtap="del">删除闹钟</button>
  </view>
</view>
""", """
const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { id: '', time: '07:20', label: '起床', enabled: true, task: null },
  onLoad(q) { this.setData({ id: q.id || '' }) },
  onTime(e) { this.setData({ time: e.detail.value }) },
  onLabel(e) { this.setData({ label: e.detail.value }) },
  toggle() { this.setData({ enabled: !this.data.enabled }) },
  save() {
    api.submitTask('alarm-save', this.data).then((t) => {
      this.setData({ task: t })
      const poll = () => api.getTask(t.id).then((x) => {
        this.setData({ task: x })
        if (x.status === 'submitted' || x.status === 'executing') setTimeout(poll, 600)
        else util.toast(x.message)
      })
      poll()
    })
  },
  async del() {
    const ok = await util.confirm('删除闹钟', '删除后设备将不再在该时间响铃。')
    if (!ok) return
    api.submitTask('alarm-delete', { id: this.data.id }).then(() => wx.navigateBack())
  }
})
"""))

pages.append(("guard/sos", NAV_JSON, """
<view class="page">
  <nav-bar title="紧急联系人" action="添加" bind:action="add" />
  <view class="pad">
    <text class="sub">至少 1 名、最多 3 名。仅可从已授权联系人中选择。</text>
    <view class="item" wx:for="{{list}}" wx:key="id">
      <view class="between">
        <view>
          <text class="h3">{{index + 1}}. {{item.name}}</text>
          <text class="sub">{{item.relation}}</text>
        </view>
        <text class="danger" data-id="{{item.id}}" catchtap="remove">移除</text>
      </view>
    </view>
    <text class="status mt-16" wx:if="{{task}}">{{task.message}}</text>
  </view>
</view>
""", """
const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { list: [], task: null },
  onShow() { api.getSos().then((list) => this.setData({ list })) },
  add() {
    if (this.data.list.length >= 3) {
      util.toast('最多设置 3 名紧急联系人')
      return
    }
    wx.navigateTo({ url: '/pages/guard/contacts' })
  },
  async remove(e) {
    if (this.data.list.length <= 1) {
      util.toast('至少保留 1 名紧急联系人')
      return
    }
    const ok = await util.confirm('移除紧急联系人', '变更将同步至设备，以最终状态为准。')
    if (!ok) return
    api.submitTask('sos-update', { remove: e.currentTarget.dataset.id }).then((t) => this.setData({ task: t }))
  }
})
"""))

# GROWTH secondary
pages.append(("growth/overview", NAV_JSON, """
<view class="page">
  <nav-bar title="成长总览详情" />
  <view class="pad">
    <text class="h1">本周成长洞察</text>
    <text class="sub mt-8">统计周期、规则版本与数据充分性同屏展示。</text>
    <view class="card card-p mt-20">
      <text class="h3">数据依据</text>
      <text class="sub mt-8">11 次正式提问、2 项项目成果、规则 v2.4。当前位置不参与能力评分。</text>
    </view>
    <view class="item" wx:for="{{dims}}" wx:key="key" data-key="{{item.key}}" bindtap="goDim">
      <view class="between"><text class="h3">{{item.name}}</text><text>{{item.value}}（{{item.delta > 0 ? '+' : ''}}{{item.delta}}）</text></view>
    </view>
  </view>
</view>
""", """
const api = require('../../services/api')
Page({
  data: { dims: [] },
  onShow() { api.getGrowth().then((g) => this.setData({ dims: g.dimensions || [] })) },
  goDim(e) { wx.navigateTo({ url: '/pages/growth/dimension?key=' + e.currentTarget.dataset.key }) }
})
"""))

pages.append(("growth/dimension", NAV_JSON, """
<view class="page">
  <nav-bar title="维度详情" />
  <view class="pad">
    <text class="h1">{{dim.name}} {{dim.value}}</text>
    <text class="sub mt-8">近期变化 {{dim.delta > 0 ? '+' : ''}}{{dim.delta}}。小程序不自行计算分数。</text>
    <view class="card card-p mt-20">
      <text class="h3">代表证据</text>
      <text class="sub mt-8">来自正式互动事件与项目成果。数据不足的维度不会用默认值补齐。</text>
    </view>
    <view class="card card-p mt-16">
      <text class="h3">陪伴建议</text>
      <text class="sub mt-8">关注孩子如何说明理由，而不是单一分数高低。</text>
    </view>
  </view>
</view>
""", """
const api = require('../../services/api')
Page({
  data: { dim: {} },
  onLoad(q) {
    api.getGrowth().then((g) => {
      const dim = (g.dimensions || []).find((d) => d.key === q.key) || (g.dimensions || [])[0] || {}
      this.setData({ dim })
    })
  }
})
"""))

pages.append(("growth/curiosity", NAV_JSON, """
<view class="page">
  <nav-bar title="好奇成长简报" />
  <view class="pad" wx:if="{{brief.status === 'ready'}}">
    <text class="h1">{{brief.question}}</text>
    <text class="sub mt-8">{{brief.date}} · 有效追问 {{brief.followups}} 次</text>
    <view class="card card-p mt-20">
      <text class="h3">关联概念</text>
      <text class="sub mt-8">{{brief.concepts}}</text>
    </view>
    <view class="card card-p mt-16">
      <text class="h3">主动验证</text>
      <text class="sub mt-8">{{brief.verified ? '孩子用积木模拟了喷气方向改变运动方向。' : '今日尚未记录主动验证。'}}</text>
    </view>
    <view class="card card-p mt-16">
      <text class="h3">家庭陪伴提示</text>
      <text class="sub mt-8">{{brief.tip}}</text>
    </view>
    <text class="sub mt-16">简报不使用位置、出行或单一分数形成评价。</text>
  </view>
  <view class="pad" wx:else>
    <text class="h1">今日数据不足</text>
    <text class="sub mt-12">{{brief.reason || '缺少代表性提问或验证事件，不生成虚构结论。'}}</text>
  </view>
</view>
""", """
const api = require('../../services/api')
Page({
  data: { brief: {} },
  onShow() {
    api.getGrowth().then((g) => {
      const brief = g.brief || {}
      brief.concepts = (brief.concepts || []).join('、')
      this.setData({ brief })
    })
  }
})
"""))

report_js = """
const api = require('../../services/api')
Page({
  data: { report: {} },
  onLoad(q) { this.rid = q.id || '%s'; this.load() },
  load() {
    api.getReport(this.rid).then((report) => this.setData({ report }))
  },
  retry() { this.load() },
  share() { wx.navigateTo({ url: '/pages/growth/share?id=' + this.rid }) }
})
"""

report_wxml = """
<view class="page">
  <nav-bar title="{{report.title || '成长报告'}}" action="分享" bind:action="share" />
  <view class="pad" wx:if="{{report.status === 'generating'}}">
    <text class="h1">正在生成</text>
    <text class="sub mt-12">长耗时任务异步进行，可离开后回来查询。</text>
    <button class="btn btn-secondary mt-24" bindtap="retry">刷新状态</button>
  </view>
  <view class="pad" wx:elif="{{report.status === 'failed'}}">
    <text class="h1">生成失败</text>
    <text class="sub mt-12">{{report.message}}</text>
    <button class="btn btn-primary mt-24" bindtap="retry">重新生成</button>
  </view>
  <view class="pad" wx:else>
    <text class="sub">{{report.range}} · {{report.generatedAt}}</text>
    <text class="sub">{{report.version}} · {{report.sufficiency}}</text>
    <view class="card card-p mt-20" wx:for="{{report.sections}}" wx:key="title">
      <text class="h3">{{item.title}}</text>
      <text class="sub mt-8">{{item.body}}</text>
    </view>
  </view>
</view>
"""

pages.append(("growth/weekly", NAV_JSON, report_wxml, report_js % "w1"))
pages.append(("growth/phase", NAV_JSON, report_wxml, report_js % "p1"))

pages.append(("growth/share", NAV_JSON, """
<view class="page">
  <nav-bar title="脱敏分享预览" />
  <view class="pad">
    <view class="card card-p">
      <text class="h3">成长周报（脱敏）</text>
      <text class="sub mt-8">孩子：小满（已隐藏全名）</text>
      <text class="sub">位置、账号、设备 ID 与精确行为时间已隐藏。</text>
      <text class="h3 mt-16">本周变化</text>
      <text class="sub mt-8">观察与表达更稳定。依据正式提问与项目成果，规则 v2.4。</text>
    </view>
  </view>
  <view class="footer">
    <button class="btn btn-primary" bindtap="openShare">生成长图并分享</button>
  </view>
  <view class="share-mask" wx:if="{{sheet}}" bindtap="close">
    <view class="share-sheet" catchtap="noop">
      <text class="h3">分享到</text>
      <view class="item" bindtap="doShare">微信好友 / 收藏</view>
      <view class="item" bindtap="save">保存到相册</view>
      <view class="item" bindtap="close">取消</view>
    </view>
  </view>
</view>
""", """
Page({
  data: { sheet: false },
  openShare() { this.setData({ sheet: true }) },
  close() { this.setData({ sheet: false }) },
  noop() {},
  doShare() {
    wx.showToast({ title: '演示环境：已按脱敏规则处理', icon: 'none' })
    this.setData({ sheet: false })
  },
  save() {
    wx.showToast({ title: '已保存（演示）', icon: 'none' })
    this.setData({ sheet: false })
  }
})
"""))

pages.append(("growth/achievement", NAV_JSON, """
<view class="page">
  <nav-bar title="成果详情" />
  <view class="pad">
    <text class="h1">{{title}}</text>
    <text class="sub mt-8">正式事件，可追溯原始记录。不以演示分数填充。</text>
    <view class="card card-p mt-20">
      <text class="h3">形成过程</text>
      <text class="sub mt-8">来源场景、能力变化与时间均来自后台正式数据。</text>
    </view>
    <button class="btn btn-secondary mt-24" bindtap="share">脱敏分享</button>
  </view>
</view>
""", """
Page({
  data: { title: '声音波形挑战' },
  onLoad(q) { if (q.id === 'a2') this.setData({ title: '机械臂协作演示' }) },
  share() { wx.navigateTo({ url: '/pages/growth/share' }) }
})
"""))

# MY pages
pages.append(("my/family", NAV_JSON, """
<view class="page">
  <nav-bar title="家庭管理" />
  <view class="pad">
    <text class="h1">{{family.name}}</text>
    <text class="sub">主管理员 {{family.admin}}</text>
    <view class="item" wx:for="{{family.members}}" wx:key="id">
      <view class="between">
        <view>
          <text class="h3">{{item.name}}</text>
          <text class="sub">{{item.role}} · {{item.relation}} · {{item.status}}</text>
        </view>
      </view>
    </view>
    <button class="btn btn-secondary mt-20" bindtap="goChild">孩子管理</button>
    <button class="btn btn-secondary mt-12" bindtap="goTransfer">转移主管理员</button>
  </view>
</view>
""", """
const api = require('../../services/api')
Page({
  data: { family: { members: [] } },
  onShow() { api.getFamily().then((family) => this.setData({ family })) },
  goChild() { wx.navigateTo({ url: '/pages/my/child' }) },
  goTransfer() { wx.navigateTo({ url: '/pages/my/transfer' }) }
})
"""))

pages.append(("my/child", NAV_JSON, """
<view class="page">
  <nav-bar title="孩子管理" />
  <view class="pad">
    <view class="item" wx:for="{{list}}" wx:key="id">
      <text class="h3">{{item.name}}</text>
      <text class="sub">{{item.deviceName}} · 陪伴 {{item.days}} 天</text>
    </view>
    <button class="btn btn-danger mt-24" bindtap="unbind">解除孩子关系</button>
  </view>
</view>
""", """
const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { list: [] },
  onShow() { api.getChildren().then((list) => this.setData({ list })) },
  async unbind() {
    const ok = await util.confirm('解除关系', '将停止位置、成长与设备访问。不会误删其他家庭的合法数据。需身份核验。')
    if (!ok) return
    api.submitTask('child-unbind', {}).then(() => util.toast('已提交，服务端处理中'))
  }
})
"""))

pages.append(("my/transfer", NAV_JSON, """
<view class="page">
  <nav-bar title="转移主管理员" />
  <view class="pad">
    <text class="h1">将主管理权转移给林屿</text>
    <text class="sub mt-12">转移前核验接收方身份和有效监护关系。成功后双方权限立即更新。</text>
    <button class="btn btn-primary mt-24" bindtap="go">二次确认并提交</button>
  </view>
</view>
""", """
const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  async go() {
    const ok = await util.confirm('确认转移', '你将失去主管理员权限。此操作不可仅以前端成功结束。')
    if (!ok) return
    api.submitTask('admin-transfer', {}).then(() => util.toast('已提交转移'))
  }
})
"""))

pages.append(("my/device", NAV_JSON, """
<view class="page">
  <nav-bar title="设备中心" />
  <view class="pad">
    <view class="item" wx:for="{{list}}" wx:key="id" data-id="{{item.id}}" bindtap="detail">
      <view class="between">
        <view>
          <text class="h3">{{item.name}}</text>
          <text class="sub">{{item.childName}} · {{item.locate}} · {{item.updatedAt}}</text>
        </view>
        <text class="status">{{item.online ? '在线' : '离线'}} {{item.battery}}%</text>
      </view>
    </view>
  </view>
</view>
""", """
const api = require('../../services/api')
Page({
  data: { list: [] },
  onShow() { api.getDevices().then((list) => this.setData({ list })) },
  detail(e) { wx.navigateTo({ url: '/pages/my/device-detail?id=' + e.currentTarget.dataset.id }) }
})
"""))

pages.append(("my/device-detail", NAV_JSON, """
<view class="page">
  <nav-bar title="设备详情" />
  <view class="pad">
    <view class="card card-p">
      <text class="h3">{{dev.name}}</text>
      <text class="sub mt-8">绑定 {{dev.childName}}</text>
      <text class="sub">固件 {{dev.firmware}} · {{dev.locate}}</text>
      <text class="sub">状态过期时不会把缓存值显示为当前。</text>
    </view>
    <button class="btn btn-danger mt-24" bindtap="unbind">解绑设备</button>
  </view>
  <view class="share-mask" wx:if="{{confirm}}" bindtap="close">
    <view class="share-sheet" catchtap="noop">
      <text class="h3">确认解绑？</text>
      <text class="sub mt-8">解绑后清除相关位置与守护访问，需主管理员权限。</text>
      <button class="btn btn-danger mt-16" bindtap="ok">确认解绑</button>
      <button class="btn btn-ghost mt-12" bindtap="close">取消</button>
    </view>
  </view>
</view>
""", """
const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { dev: {}, confirm: false },
  onLoad(q) {
    api.getDevices().then((list) => this.setData({ dev: list.find((d) => d.id === q.id) || list[0] || {} }))
  },
  unbind() { this.setData({ confirm: true }) },
  close() { this.setData({ confirm: false }) },
  noop() {},
  ok() {
    api.submitTask('device-unbind', { id: this.data.dev.id }).then(() => {
      util.toast('解绑已提交')
      this.setData({ confirm: false })
    })
  }
})
"""))

pages.append(("my/guide", NAV_JSON, """
<view class="page">
  <nav-bar title="玩机指南" />
  <view class="pad">
    <view class="item" wx:for="{{list}}" wx:key="id">
      <text class="h3">{{item.title}}</text>
      <text class="sub">{{item.desc}}</text>
      <text class="status">{{item.status}}</text>
    </view>
  </view>
</view>
""", """
const api = require('../../services/api')
Page({
  data: { list: [] },
  onShow() { api.getGuide().then((list) => this.setData({ list })) }
})
"""))

pages.append(("my/message", NAV_JSON, """
<view class="page">
  <nav-bar title="消息中心" action="订阅" bind:action="sub" />
  <view class="pad">
    <view class="item" wx:for="{{list}}" wx:key="id" data-url="{{item.url}}" bindtap="open">
      <view class="between">
        <text class="pill pill-lavender">{{item.type}}</text>
        <text class="sub">{{item.time}}</text>
      </view>
      <text class="h3 mt-8">{{item.title}}</text>
      <text class="status" wx:if="{{item.unread}}">未读</text>
    </view>
  </view>
</view>
""", """
const api = require('../../services/api')
Page({
  data: { list: [] },
  onShow() { api.getMessages().then((list) => this.setData({ list })) },
  sub() { wx.navigateTo({ url: '/pages/my/subscribe' }) },
  open(e) {
    const url = e.currentTarget.dataset.url
    if (url) wx.navigateTo({ url })
  }
})
"""))

pages.append(("my/subscribe", NAV_JSON, """
<view class="page">
  <nav-bar title="微信订阅消息" />
  <view class="pad">
    <text class="h1">由你主动授权</text>
    <text class="sub mt-12">拒绝或发送失败时，站内消息仍完整保留。不承诺永久订阅。</text>
    <view class="item mt-20 between"><text>设备离线提醒</text><text class="status">未授权</text></view>
    <view class="item between"><text>成长报告完成</text><text class="status">未授权</text></view>
    <button class="btn btn-primary mt-24" bindtap="ask">申请订阅</button>
  </view>
</view>
""", """
Page({
  ask() {
    wx.showToast({ title: '演示：记录订阅状态，不强制弹窗循环', icon: 'none' })
  }
})
"""))

pages.append(("my/support", NAV_JSON, """
<view class="page">
  <nav-bar title="专属支持" />
  <view class="pad">
    <view class="item" bindtap="goFb"><text class="h3">意见反馈</text><text class="sub">可关联设备与时间</text></view>
    <view class="item">
      <text class="h3">服务单 AIL-20260825-03</text>
      <text class="sub">处理中 · 已脱敏设备日志</text>
    </view>
    <view class="item">
      <text class="h3">常见问题</text>
      <text class="sub">位置过期、绑定码失效、通话失败重试</text>
    </view>
  </view>
</view>
""", """
Page({
  goFb() { wx.navigateTo({ url: '/pages/my/feedback' }) }
})
"""))

pages.append(("my/account", NAV_JSON, """
<view class="page">
  <nav-bar title="我的账号" />
  <view class="pad">
    <view class="item" bindtap="go" data-url="/pages/my/privacy"><text class="h3">儿童信息</text><text class="sub">查看、更正或申请删除</text></view>
    <view class="item" bindtap="go" data-url="/pages/my/withdraw"><text class="h3">撤回同意</text><text class="sub">停止新的相关数据处理</text></view>
    <view class="item" bindtap="go" data-url="/pages/my/delete"><text class="h3">申请删除数据</text><text class="sub">服务端闭环并留痕</text></view>
    <view class="item" bindtap="go" data-url="/pages/my/cancel"><text class="h3">账号注销</text><text class="sub">冷静期与主管理员责任</text></view>
  </view>
</view>
""", """
Page({
  go(e) { wx.navigateTo({ url: e.currentTarget.dataset.url }) }
})
"""))

risk_js = """
const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { task: null },
  async submit() {
    const ok = await util.confirm('%s', '%s')
    if (!ok) return
    api.submitTask('%s', {}).then((t) => {
      this.setData({ task: t })
      const poll = () => api.getTask(t.id).then((x) => {
        this.setData({ task: x })
        if (x.status === 'submitted' || x.status === 'executing') setTimeout(poll, 700)
      })
      poll()
    })
  }
})
"""

pages.append(("my/privacy", NAV_JSON, """
<view class="page">
  <nav-bar title="儿童信息" />
  <view class="pad">
    <text class="h1">处理范围与进度</text>
    <text class="sub mt-12">可申请查看、更正或删除。页面显示影响、进度和最终结果，必须由服务端完成。</text>
    <view class="card card-p mt-20">
      <text class="h3">当前授权</text>
      <text class="sub mt-8">监护人同意有效 · 最近变更 2026-08-20</text>
    </view>
    <button class="btn btn-secondary mt-24" bindtap="submit">申请查看/更正</button>
    <text class="status mt-12" wx:if="{{task}}">{{task.message}}</text>
  </view>
</view>
""", risk_js % ("提交申请", "将生成可追踪的处理单，并通知结果。", "child-data-request")))

pages.append(("my/withdraw", NAV_JSON, """
<view class="page">
  <nav-bar title="撤回同意" />
  <view class="pad">
    <text class="h1">撤回后的影响</text>
    <text class="sub mt-12">停止新的相关数据处理。依法或为履行必要服务保留的数据会说明依据和期限。</text>
    <button class="btn btn-danger mt-24" bindtap="submit">确认撤回</button>
    <text class="status mt-12" wx:if="{{task}}">{{task.message}}</text>
  </view>
</view>
""", risk_js % ("撤回同意", "撤回后无法继续使用家庭、位置与成长服务。", "consent-withdraw")))

pages.append(("my/delete", NAV_JSON, """
<view class="page">
  <nav-bar title="申请删除" />
  <view class="pad">
    <text class="h1">删除儿童相关数据</text>
    <text class="sub mt-12">高风险操作。完成后可在此查询处理进度，不会仅以前端成功提示结束。</text>
    <button class="btn btn-danger mt-24" bindtap="submit">提交删除申请</button>
    <text class="status mt-12" wx:if="{{task}}">{{task.message}}</text>
  </view>
</view>
""", risk_js % ("申请删除", "删除范围、影响和保留期限将写入处理单。", "data-delete")))

pages.append(("my/cancel", NAV_JSON, """
<view class="page">
  <nav-bar title="账号注销" />
  <view class="pad">
    <text class="h1">注销前请确认</text>
    <text class="sub mt-12">需处理家庭主管理员责任，提供冷静取消路径，并由服务端通知最终结果。</text>
    <button class="btn btn-danger mt-24" bindtap="submit">申请注销</button>
    <text class="status mt-12" wx:if="{{task}}">{{task.message}}</text>
  </view>
</view>
""", risk_js % ("申请注销", "若你是唯一主管理员，需先转移或解散家庭。", "account-cancel")))

pages.append(("my/about", NAV_JSON, """
<view class="page">
  <nav-bar title="关于我们" />
  <view class="pad">
    <text class="h1">AILab 家长端</text>
    <text class="sub mt-8">版本 1.0.0-mock · 基础库 3.17</text>
    <view class="item" bindtap="policy" data-type="user"><text class="h3">用户协议</text></view>
    <view class="item" bindtap="policy" data-type="privacy"><text class="h3">隐私政策</text></view>
    <view class="item" bindtap="policy" data-type="child"><text class="h3">儿童信息处理规则</text></view>
    <view class="item" bindtap="fb"><text class="h3">意见反馈</text></view>
    <view class="item" bindtap="debug"><text class="sub">演示场景（开发）</text></view>
  </view>
</view>
""", """
Page({
  policy(e) { wx.navigateTo({ url: '/pages/my/policy?type=' + e.currentTarget.dataset.type }) },
  fb() { wx.navigateTo({ url: '/pages/my/feedback' }) },
  debug() { wx.navigateTo({ url: '/pages/my/debug' }) }
})
"""))

pages.append(("my/feedback", NAV_JSON, """
<view class="page">
  <nav-bar title="意见反馈" />
  <view class="pad">
    <textarea class="textarea" placeholder="描述问题，可选择是否附带必要日志" bindinput="onInput" />
    <button class="btn btn-primary mt-24" bindtap="send">提交</button>
  </view>
</view>
""", """
const api = require('../../services/api')
const util = require('../../utils/util')
Page({
  data: { text: '' },
  onInput(e) { this.setData({ text: e.detail.value }) },
  send() {
    api.submitTask('feedback', { text: this.data.text }).then(() => util.toast('已提交，可在专属支持查看进度'))
  }
})
"""))

pages.append(("my/policy", NAV_JSON, """
<view class="page">
  <nav-bar title="{{title}}" />
  <view class="pad">
    <text class="sub">版本 2026-08-25 · 生效日期以正文为准</text>
    <text class="sub mt-16">{{body}}</text>
  </view>
</view>
""", """
Page({
  data: { title: '协议', body: '' },
  onLoad(q) {
    const map = {
      privacy: ['隐私政策', '说明账号、家庭、位置、成长与儿童信息的处理目的、方式和期限。位置超过有效期后不再作为当前值展示。'],
      user: ['用户协议', '约定家长端服务范围：陪伴查看、实时守护与家庭管理，不含历史轨迹与远程摄像头。'],
      child: ['儿童信息处理规则', '监护人可查看、更正、删除和撤回。高风险操作由服务端留痕。']
    }
    const t = map[q.type] || map.privacy
    this.setData({ title: t[0], body: t[1] })
  }
})
"""))

pages.append(("my/debug", NAV_JSON, """
<view class="page">
  <nav-bar title="演示场景" />
  <view class="pad">
    <text class="sub">用于对照原型空/加载/离线/失败状态。不影响正式产品文案。</text>
    <view class="item" wx:for="{{list}}" wx:key="id" data-id="{{item.id}}" bindtap="pick">
      <text class="h3">{{item.name}}</text>
      <text class="status" wx:if="{{item.id === current}}">当前</text>
    </view>
  </view>
</view>
""", """
const store = require('../../services/store')
Page({
  data: {
    current: 'default',
    list: [
      { id: 'default', name: '默认（林小满 · 在线）' },
      { id: 'empty', name: '空数据' },
      { id: 'loading', name: '加载变慢' },
      { id: 'offline', name: '弱网/请求失败' },
      { id: 'stale', name: '位置已过期' },
      { id: 'fail', name: '设备任务失败' },
      { id: 'timeout', name: '任务超时' },
      { id: 'generating', name: '报告生成中' }
    ]
  },
  onShow() { this.setData({ current: store.getScenario() }) },
  pick(e) {
    store.setScenario(e.currentTarget.dataset.id)
    this.setData({ current: e.currentTarget.dataset.id })
    wx.showToast({ title: '已切换场景', icon: 'none' })
  }
})
"""))

for rel, jsong, wxml, js, *rest in pages:
    wxss = rest[0] if rest else FOOTER
    write_files(rel, jsong, wxml, js, wxss)

print("done", len(pages))
