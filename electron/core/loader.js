/**
 * 模组加载器安装：Fabric / Quilt（通过各自官方 meta API 生成版本 JSON）。
 * Forge 暂未支持（安装器需要执行 jar，后续版本计划）。
 */
const paths = require('./paths')
const manifest = require('./manifest')
const install = require('./install')
const jobs = require('./jobs')
const { fetchJson } = require('../util/net')

const PROVIDERS = {
  fabric: {
    api: 'https://meta.fabricmc.net/v2',
    async gameVersions() {
      const list = await fetchJson(`${this.api}/versions/game`)
      return list.map((v) => ({ id: v.version, stable: !!v.stable, type: v.version.includes('-') ? 'snapshot' : 'release' }))
    },
    async loaders() {
      const list = await fetchJson(`${this.api}/versions/loader`)
      return list.slice(0, 30).map((l) => ({ id: l.version, stable: !!l.stable }))
    },
    profileUrl(game, loader) {
      return `${this.api}/versions/loader/${encodeURIComponent(game)}/${encodeURIComponent(loader)}/profile/json`
    },
    idFor(game, loader) {
      return `fabric-loader-${loader}-${game}`
    },
  },
  quilt: {
    api: 'https://meta.quiltmc.org/v3',
    async gameVersions() {
      const list = await fetchJson(`${this.api}/versions/game`)
      return list.map((v) => ({ id: v.version, stable: !!v.stable, type: v.version.includes('-') ? 'snapshot' : 'release' }))
    },
    async loaders() {
      const list = await fetchJson(`${this.api}/versions/loader`)
      // v3 条目无 stable 字段，用是否含预发布后缀判断
      return list.slice(0, 30).map((l) => ({ id: l.version, stable: !/-/.test(l.version) }))
    },
    profileUrl(game, loader) {
      return `${this.api}/versions/loader/${encodeURIComponent(game)}/${encodeURIComponent(loader)}/profile/json`
    },
    idFor(game, loader) {
      return `quilt-loader-${loader}-${game}`
    },
  },
}

function getProvider(type) {
  const p = PROVIDERS[type]
  if (!p) throw new Error(`暂不支持的加载器：${type}（目前支持 Fabric / Quilt）`)
  return p
}

async function listLoaders(type) {
  const p = getProvider(type)
  const [games, loaders] = await Promise.all([p.gameVersions(), p.loaders()])
  return { games, loaders }
}

/**
 * 安装加载器版本：拉取 profile JSON → 合并原版 → 落盘 → 补装依赖库
 * @param {{type, gameVersion, loaderVersion}} opts
 */
async function installLoader({ type, gameVersion, loaderVersion }, job, signal) {
  const p = getProvider(type)
  if (!manifest.isInstalled(gameVersion)) {
    throw new Error(`请先安装原版 ${gameVersion}，再安装 ${type}`)
  }

  job && (job.message = `获取 ${type} ${loaderVersion} 配置...`)
  const profile = await fetchJson(p.profileUrl(gameVersion, loaderVersion))
  if (!profile) throw new Error('加载器配置获取失败')

  // profile JSON 自带 inheritsFrom，与已安装的原版合并
  const parent = manifest.readInstalledVersion(profile.inheritsFrom || gameVersion)
  if (!parent) throw new Error(`缺少原版 ${profile.inheritsFrom || gameVersion} 的版本信息`)
  const merged = manifest.mergeVersionJson(profile, parent)
  const id = merged.id || p.idFor(gameVersion, loaderVersion)
  merged.id = id
  manifest.saveInstalledVersion(id, merged)

  // 下载加载器自身的依赖库
  const tasks = install.collectTasks(merged)
  if (job) jobs.setPhase(job, 'libraries', '加载器依赖')
  await install.installLibraries(tasks, job, signal)

  return `${id} 安装完成`
}

module.exports = { PROVIDERS, listLoaders, installLoader, getProvider }
