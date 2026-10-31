/**
 * 下源地址映射：官方 / BMCLAPI 国内镜像。
 * BMCLAPI 已验证规则（2026-10）：
 *   manifest  /mc/game/version_manifest.json   （302 跳转，fetch 自动跟随）
 *   版本 JSON /version/{id}/json
 *   客户端    /version/{id}/client
 *   依赖库    /maven/{path}
 * assets 相关路径见 ASSET_* 常量，不可用时自动回退官方。
 */
const BMCL = 'https://bmclapi2.bangbang93.com'

// BMCLAPI 资源索引/对象路径（探测结果写入；null 表示回退官方）
const ASSET_INDEX_TPL = null // 例：`${BMCL}/assets/index/{id}`
const ASSET_OBJECT_TPL = null // 例：`${BMCL}/assets/{sha1}`

const OFFICIAL_MANIFEST = 'https://piston-meta.mojang.com/mc/game/version_manifest_v2.json'
const OFFICIAL_LIB = 'https://libraries.minecraft.net/'
const OFFICIAL_ASSET = 'https://resources.download.minecraft.net/'

function source() {
  // settings 懒加载避免循环依赖
  try {
    const settings = require('./settings')
    return settings.get().downloadSource === 'bmcl' ? 'bmcl' : 'official'
  } catch {
    return 'official'
  }
}

function isMirror() {
  return source() === 'bmcl'
}

/** 版本列表 */
function manifestUrl() {
  return isMirror() ? `${BMCL}/mc/game/version_manifest.json` : OFFICIAL_MANIFEST
}

/** 官方 manifest 兜底地址（镜像失败时使用） */
function fallbackManifestUrl() {
  return OFFICIAL_MANIFEST
}

/** 版本 JSON */
function versionJsonUrl(id) {
  return isMirror() ? `${BMCL}/version/${encodeURIComponent(id)}/json` : null // null = 使用 manifest 中的官方 URL
}

/** 客户端/服务端 jar */
function clientJarUrl(id) {
  return isMirror() ? `${BMCL}/version/${encodeURIComponent(id)}/client` : null
}
function serverJarUrl(id) {
  return isMirror() ? `${BMCL}/version/${encodeURIComponent(id)}/server` : null
}

/** 依赖库：按 path（libraries.minecraft.net 下相对路径）重写 */
function libraryUrl(lib) {
  const artifact = lib.downloads && lib.downloads.artifact
  if (isMirror() && artifact && artifact.path && isMojangLib(artifact.url || '')) {
    return `${BMCL}/maven/${artifact.path}`
  }
  return artifact ? artifact.url : null
}

/** 原生库 classifier 下载地址 */
function classifierUrl(lib, classifierEntry) {
  if (!classifierEntry) return null
  if (isMirror() && classifierEntry.path && isMojangLib(classifierEntry.url || '')) {
    return `${BMCL}/maven/${classifierEntry.path}`
  }
  return classifierEntry.url
}

function isMojangLib(url) {
  return !url || url.startsWith('https://libraries.minecraft.net/')
}

/** 资源索引 JSON */
function assetIndexUrl(entry) {
  // entry: { id, url, sha1 }
  if (isMirror() && ASSET_INDEX_TPL) return ASSET_INDEX_TPL.replace('{id}', entry.id)
  return entry.url
}

/** 单个资源对象（sha1） */
function assetObjectUrl(sha1) {
  if (isMirror() && ASSET_OBJECT_TPL) return ASSET_OBJECT_TPL.replace('{sha1}', sha1)
  return `${OFFICIAL_ASSET}${sha1.slice(0, 2)}/${sha1}`
}

/** 该资源对象是否有镜像 */
function hasAssetMirror() {
  return isMirror() && !!ASSET_OBJECT_TPL
}

module.exports = {
  BMCL,
  source,
  isMirror,
  manifestUrl,
  fallbackManifestUrl,
  versionJsonUrl,
  clientJarUrl,
  serverJarUrl,
  libraryUrl,
  classifierUrl,
  assetIndexUrl,
  assetObjectUrl,
  hasAssetMirror,
}
