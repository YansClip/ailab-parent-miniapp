// This is intentionally fail-closed. Map the vendor's documented SDK/API here;
// never add a successful fake response in the deployed gateway.
const { fail } = require('../lib/contracts')
module.exports = function unconfiguredProvider() {
  const unavailable = async () => fail('PROVIDER_NOT_CONFIGURED', '设备云尚未接入，请先完成接口配置与联调')
  return {
    getDevice: unavailable, getLocation: unavailable, refreshLocation: unavailable,
    startWatch: unavailable, stopWatch: unavailable, inviteCall: unavailable, endCall: unavailable,
    getOperation: unavailable, getCall: unavailable
  }
}
