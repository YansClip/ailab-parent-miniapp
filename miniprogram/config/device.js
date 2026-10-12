// Public, non-secret configuration. Device UI remains a local simulation;
// explicit QA identity/connection checks can use the deployed cloud service.
// Real mode requires a company-owned verified backend AND server-side binding.
module.exports = {
  appId: 'wxc5abf3407ed4ef30',
  mode: 'demo', // demo | cloud; no automatic fallback
  transport: 'cloudrun', // cloudrun | function; independent of demo/cloud UI mode
  cloudrun: {
    envId: 'prod-d4gzywf6m065e947c',
    serviceName: 'ailab-device-gateway', // independent business service; keep django-dmgd intact
    path: '/api/gateway',
    enabled: true // user confirmed deployment and private ingress; verify identity in QA next
  },
  envId: '', // CloudBase FUNCTION env only; do not copy the CloudRun env here
  functionName: 'miniDeviceGateway',
  requestTimeoutMs: 12000,
  voip: { enabled: false, pluginAlias: 'wmpf-voip' }
}
