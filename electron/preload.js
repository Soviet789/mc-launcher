const { contextBridge, ipcRenderer } = require('electron')

function invoke(channel, payload) {
  return ipcRenderer.invoke(channel, payload).then((res) => {
    if (res && res.ok) return res.data
    throw new Error((res && res.error) || '主进程调用失败')
  })
}

function subscribe(channel, cb) {
  const handler = (_event, ...args) => cb(...args)
  ipcRenderer.on(channel, handler)
  return () => ipcRenderer.removeListener(channel, handler)
}

contextBridge.exposeInMainWorld('api', {
  settings: {
    get: () => invoke('settings:get'),
    update: (patch) => invoke('settings:update', patch),
    reset: () => invoke('settings:reset'),
  },
  versions: {
    remote: (opts) => invoke('versions:remote', opts || {}),
    installed: () => invoke('versions:installed'),
    install: (id) => invoke('versions:install', { id }),
    repair: (id) => invoke('versions:repair', { id }),
    verify: (id) => invoke('versions:verify', { id }),
    delete: (id) => invoke('versions:delete', { id }),
  },
  loaders: {
    list: (type) => invoke('loaders:list', type),
    install: (opts) => invoke('loaders:install', opts),
  },
  instances: {
    list: () => invoke('instances:list'),
    create: (opts) => invoke('instances:create', opts),
    update: (id, patch) => invoke('instances:update', { id, ...patch }),
    remove: (id) => invoke('instances:remove', { id }),
    ensureDefault: () => invoke('instances:default'),
    gameDir: (id) => invoke('instances:gameDir', { id }),
  },
  accounts: {
    list: () => invoke('accounts:list'),
    current: () => invoke('accounts:current'),
    addOffline: (name) => invoke('accounts:addOffline', { name }),
    setCurrent: (id) => invoke('accounts:setCurrent', { id }),
    remove: (id) => invoke('accounts:remove', { id }),
    msLogin: () => invoke('accounts:msLogin'),
    msRefresh: (id) => invoke('accounts:msRefresh', { id }),
  },
  launch: {
    start: (instanceId) => invoke('launch:start', { instanceId }),
    stop: () => invoke('launch:stop'),
    status: () => invoke('launch:status'),
  },
  jobs: {
    cancel: (id) => invoke('jobs:cancel', { id }),
    list: () => invoke('jobs:list'),
    history: () => invoke('jobs:history'),
    clearHistory: () => invoke('jobs:clearHistory'),
  },
  java: {
    list: () => invoke('java:list'),
    pick: () => invoke('java:pick'),
    download: (major) => invoke('java:download', { major }),
  },
  resources: {
    search: (opts) => invoke('resources:search', opts),
    project: (id) => invoke('resources:project', { id }),
    versions: (id, filters) => invoke('resources:versions', { id, ...(filters || {}) }),
    installFile: (opts) => invoke('resources:installFile', opts),
    installModpack: (opts) => invoke('resources:installModpack', opts),
  },
  system: {
    info: () => invoke('system:info'),
    openPath: (p) => invoke('system:openPath', p),
    showItem: (p) => invoke('system:showItem', p),
    chooseFolder: () => invoke('system:chooseFolder'),
  },
  on: {
    job: (cb) => subscribe('job:update', cb),
    launchLog: (cb) => subscribe('launch:log', cb),
    launchState: (cb) => subscribe('launch:state', cb),
  },
})
