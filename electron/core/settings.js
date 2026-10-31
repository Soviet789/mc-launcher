const { readJson, writeJson, ensureDir } = require('../util/fs')
const paths = require('./paths')

const DEFAULTS = {
  // 下载源：official 官方 | bmcl BMCLAPI 镜像（国内加速）
  downloadSource: 'official',
  // Java：留空表示自动检测/自动下载
  javaPath: '',
  // 内存（MB）
  memory: { min: 1024, max: 4096 },
  // 附加 JVM 参数（空格分隔）
  jvmArgs: '',
  // 窗口分辨率
  resolution: { custom: false, width: 1280, height: 720 },
  // 微软登录 Azure 应用 clientId（见 README「配置微软登录」）
  microsoft: { clientId: '' },
  // 下载并发数
  concurrency: 16,
  // 是否在游戏退出后保留启动器日志窗口
  keepLog: true,
}

let cache = null

function load() {
  if (cache) return cache
  const file = paths.settingsFile()
  ensureDir(paths.userData())
  const saved = readJson(file, {})
  cache = deepMerge(structuredClone(DEFAULTS), saved || {})
  return cache
}

function save() {
  if (!cache) return
  writeJson(paths.settingsFile(), cache)
}

function get() {
  return load()
}

/** 更新（浅层合并，对象字段递归合并） */
function update(patch) {
  const cur = load()
  cache = deepMerge(cur, patch || {})
  save()
  return cache
}

function reset() {
  cache = structuredClone(DEFAULTS)
  save()
  return cache
}

function deepMerge(target, src) {
  for (const [k, v] of Object.entries(src || {})) {
    if (v && typeof v === 'object' && !Array.isArray(v) && typeof target[k] === 'object' && target[k] !== null && !Array.isArray(target[k])) {
      deepMerge(target[k], v)
    } else if (v !== undefined) {
      target[k] = v
    }
  }
  return target
}

module.exports = { DEFAULTS, get, update, reset, save }
