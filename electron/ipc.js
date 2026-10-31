/**
 * IPC 处理器：渲染进程所有 invoke 调用的入口。
 * 长任务统一走 jobs.run → 推送 job:update 进度事件。
 */
const path = require('path')
const { ipcMain, dialog, shell, app, BrowserWindow } = require('electron')

const settings = require('./core/settings')
const jobs = require('./core/jobs')
const manifest = require('./core/manifest')
const install = require('./core/install')
const javaUtil = require('./core/java')
const launchCore = require('./core/launch')
const accounts = require('./core/accounts')
const microsoft = require('./core/microsoft')
const instances = require('./core/instances')
const loaders = require('./core/loader')
const modrinth = require('./core/modrinth')

function handle(channel, fn) {
  ipcMain.handle(channel, async (_event, payload) => {
    try {
      return { ok: true, data: await fn(payload) }
    } catch (err) {
      return { ok: false, error: (err && err.message) || String(err) }
    }
  })
}

/** 后台启动任务并立即返回 jobId */
function startJob(kind, fn, meta = null) {
  const job = jobs.createJob(kind, { meta })
  ;(async () => {
    try {
      const msg = await fn(job, job.controller && job.controller.signal)
      if (job.status === 'running') jobs.done(job, msg || '')
    } catch (err) {
      if (job.controller && job.controller.signal.aborted) jobs.cancelled(job)
      else jobs.failed(job, err)
    }
  })()
  return { jobId: job.id }
}

function register() {
  // ---------- 设置 ----------
  handle('settings:get', () => settings.get())
  handle('settings:update', (patch) => settings.update(patch))
  handle('settings:reset', () => settings.reset())

  // ---------- 版本 ----------
  handle('versions:remote', async ({ refresh } = {}) => {
    const m = await manifest.getVersionManifest({ refresh: !!refresh })
    const installedIds = new Set(manifest.listInstalled().map((v) => v.id))
    return m.versions.map((v) => ({
      id: v.id,
      type: v.type,
      releaseTime: v.releaseTime,
      url: v.url,
      installed: installedIds.has(v.id),
    }))
  })
  handle('versions:installed', () => manifest.listInstalled())
  handle('versions:install', ({ id }) => startJob('install', (job, signal) => install.installVersion(id, job, signal), { versionId: id }))
  handle('versions:verify', async ({ id }) => {
    const result = await install.verifyVersion(id, null, null)
    if (result.needsRepair && result.missing && result.missing.length) {
      return { ...result, missingNames: result.missing.slice(0, 50).map((t) => t.label) }
    }
    return { needsRepair: false }
  })
  handle('versions:repair', ({ id }) => startJob('install', (job, signal) => install.installVersion(id, job, signal), { versionId: id }))
  handle('versions:delete', ({ id }) => {
    // 引用该版本的实例需要一并提示删除
    const refs = instances.listInstances().filter((i) => i.versionId === id)
    manifest.deleteInstalled(id)
    for (const inst of refs) instances.deleteInstance(inst.id)
    return { removedInstances: refs.map((i) => i.name) }
  })

  // ---------- 加载器（Fabric / Quilt） ----------
  handle('loaders:list', (type) => loaders.listLoaders(type))
  handle('loaders:install', (opts) => startJob('loader', (job, signal) => loaders.installLoader(opts, job, signal), opts))

  // ---------- 实例（版本隔离） ----------
  handle('instances:list', () => {
    const all = instances.listInstances()
    return all.map((i) => ({ ...i, loader: detectLoader(i.versionId) }))
  })
  handle('instances:create', (opts) => instances.createInstance(opts))
  handle('instances:update', ({ id, ...patch }) => instances.updateInstance(id, patch))
  handle('instances:remove', ({ id }) => instances.deleteInstance(id))
  handle('instances:default', () => instances.ensureDefaultInstance())
  handle('instances:gameDir', ({ id }) => instances.instanceGameDir(id))

  // ---------- 账户 ----------
  handle('accounts:list', () => accounts.list())
  handle('accounts:current', () => accounts.getCurrent())
  handle('accounts:addOffline', ({ name }) => accounts.addOffline(name))
  handle('accounts:setCurrent', ({ id }) => accounts.setCurrent(id))
  handle('accounts:remove', ({ id }) => accounts.remove(id))
  handle('accounts:msLogin', async () => {
    const clientId = settings.get().microsoft.clientId
    const profile = await microsoft.login({ clientId })
    return accounts.addMicrosoft(profile)
  })
  handle('accounts:msRefresh', async ({ id }) => {
    const acc = accounts.get(id)
    if (!acc || acc.type !== 'msa') throw new Error('不是微软账户')
    const fresh = await accounts.ensureFresh(acc)
    return fresh
  })

  // ---------- 启动 ----------
  handle('launch:start', async ({ instanceId }) => {
    if (launchCore.isRunning()) throw new Error('已有游戏正在运行')
    let instance = instanceId ? instances.getInstance(instanceId) : null
    if (!instance) instance = instances.ensureDefaultInstance()
    if (!instance) throw new Error('没有可用实例：请先在「版本」页安装游戏并创建实例')
    let account = accounts.getCurrent()
    if (!account) throw new Error('请先在「账户」页添加账户')
    account = await accounts.ensureFresh(account)

    startJobKindLaunch(instance, account)
    return { instance: instance.name, account: account.name }
  })
  handle('launch:stop', () => launchCore.stopGame())
  handle('launch:status', () => ({ running: launchCore.isRunning(), info: launchCore.runningInfo() }))

  // ---------- 任务 ----------
  handle('jobs:cancel', ({ id }) => jobs.cancel(id))
  handle('jobs:list', () => jobs.list())
  handle('jobs:history', () => jobs.historyList())
  handle('jobs:clearHistory', () => jobs.clearHistory())

  // ---------- Java ----------
  handle('java:list', async () => javaUtil.detectSystemJava())
  handle('java:pick', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const result = await dialog.showOpenDialog(win, {
      title: '选择 java 可执行文件',
      properties: ['openFile'],
      filters:
        process.platform === 'win32'
          ? [{ name: 'java.exe', extensions: ['exe'] }, { name: '所有文件', extensions: ['*'] }]
          : [{ name: 'java', extensions: ['*'] }],
    })
    if (result.canceled || !result.filePaths[0]) return null
    const info = await javaUtil.probeJava(result.filePaths[0])
    if (!info) throw new Error('所选文件不是可运行的 Java')
    return info
  })
  handle('java:download', ({ major }) => startJob('java', (job, signal) => javaUtil.downloadJava(major, job, signal), { major }))

  // ---------- 资源下载（Modrinth） ----------
  handle('resources:search', (opts) => modrinth.search(opts))
  handle('resources:project', ({ id }) => modrinth.project(id))
  handle('resources:versions', ({ id, loaders: ls, gameVersions }) => modrinth.versions(id, { loaders: ls, gameVersions }))
  handle('resources:installFile', (opts) => startJob('resource', (job, signal) => modrinth.installVersionFile(opts, job, signal), opts))
  handle('resources:installModpack', (opts) => startJob('modpack', (job, signal) => modrinth.installModpack(opts, job, signal), opts))

  // ---------- 系统 ----------
  handle('system:info', () => {
    // 版本以项目 package.json 为准（脚本入口下 app.getVersion() 会回退为 Electron 版本）
    let version = app.getVersion()
    try {
      version = require(path.join(__dirname, '..', 'package.json')).version || version
    } catch {}
    return {
      platform: process.platform,
      arch: process.arch,
      version,
      gameDir: require('./core/paths').baseGameDir(),
      userData: require('./core/paths').userData(),
    }
  })
  handle('system:openPath', (p) => shell.openPath(p))
  handle('system:showItem', (p) => shell.showItemInFolder(p))
  handle('system:chooseFolder', async () => {
    const win = BrowserWindow.getFocusedWindow()
    const r = await dialog.showOpenDialog(win, { properties: ['openDirectory', 'createDirectory'] })
    return r.canceled ? null : r.filePaths[0]
  })
}

function startJobKindLaunch(instance, account) {
  jobs.run(
    'launch',
    async (job, signal) => launchCore.launch(instance, account, job, signal),
    { cancellable: true }
  ).catch(() => {}) // 错误已通过 job:update 推送
}

function detectLoader(versionId = '') {
  if (/^fabric-loader/i.test(versionId)) return 'fabric'
  if (/^quilt-loader/i.test(versionId)) return 'quilt'
  if (/forge/i.test(versionId)) return 'forge'
  if (/neoforge/i.test(versionId)) return 'neoforge'
  return 'vanilla'
}

module.exports = { register, detectLoader }
