const path = require('path')
const { fetchJson } = require('../util/net')
const { readJson, writeJson, exists, ensureDir } = require('../util/fs')
const paths = require('./paths')
const mirror = require('./mirror')

const CACHE_TTL = 10 * 60 * 1000 // 版本列表缓存 10 分钟
let manifestCache = null
let manifestCacheTime = 0

function cacheFile() {
  return path.join(paths.userData(), 'version_manifest_cache.json')
}

/** 获取官方版本列表（镜像优先，失败回退官方，再失败用本地缓存） */
async function getVersionManifest({ refresh = false } = {}) {
  if (!refresh && manifestCache && Date.now() - manifestCacheTime < CACHE_TTL) return manifestCache

  const attempts = [mirror.manifestUrl()]
  const fallback = mirror.fallbackManifestUrl()
  if (!attempts.includes(fallback)) attempts.push(fallback)

  let lastErr = null
  for (const url of attempts) {
    try {
      const m = await fetchJson(url)
      if (m && Array.isArray(m.versions)) {
        manifestCache = m
        manifestCacheTime = Date.now()
        try {
          writeJson(cacheFile(), m)
        } catch {}
        return m
      }
      throw new Error('版本列表结构异常')
    } catch (err) {
      lastErr = err
    }
  }
  // 全部失败 → 尝试本地缓存（离线兜底）
  const stale = readJson(cacheFile())
  if (stale && Array.isArray(stale.versions)) {
    manifestCache = stale
    manifestCacheTime = 0
    return stale
  }
  throw lastErr || new Error('无法获取版本列表')
}

/** 拉取远端版本 JSON（镜像优先，官方 manifest 兜底） */
async function fetchRemoteVersionJson(id) {
  if (mirror.isMirror()) {
    try {
      const j = await fetchJson(mirror.versionJsonUrl(id))
      if (j && j.id) return j
    } catch {
      /* 回退官方 */
    }
  }
  const m = await getVersionManifest()
  const entry = m.versions.find((v) => v.id === id)
  if (!entry) throw new Error(`版本不存在：${id}`)
  return await fetchJson(entry.url)
}

/** 递归解析 inheritsFrom 并合并为自包含的版本 JSON */
async function resolveVersionJson(id, depth = 0) {
  if (depth > 5) throw new Error('版本继承层级过深')
  const json = await fetchRemoteVersionJson(id)
  if (json.inheritsFrom) {
    const parent = await resolveVersionJson(json.inheritsFrom, depth + 1)
    return mergeVersionJson(json, parent)
  }
  return json
}

/**
 * 合并子版本（Fabric/Forge/Quilt 等）与父版本（原版）
 * 规则：标量子覆盖父；libraries 按 group:artifact 去重（子优先）；arguments 拼接
 */
function mergeVersionJson(child, parent) {
  const out = { ...parent, ...child }

  const libKey = (lib) => {
    const parts = String(lib.name || '').split(':')
    return parts.length >= 2 ? `${parts[0]}:${parts[1]}` : lib.name
  }
  const childKeys = new Set((child.libraries || []).map(libKey))
  const libs = [...(child.libraries || [])]
  for (const lib of parent.libraries || []) {
    if (!childKeys.has(libKey(lib))) libs.push(lib)
  }
  out.libraries = libs

  if (child.arguments || parent.arguments) {
    out.arguments = {
      game: [...(child.arguments?.game || []), ...(parent.arguments?.game || [])],
      jvm: [...(child.arguments?.jvm || []), ...(parent.arguments?.jvm || [])],
    }
  }

  delete out.inheritsFrom
  return out
}

/** 保存已合并的版本 JSON 到 versions/<id>/<id>.json */
function saveInstalledVersion(id, json) {
  const dir = paths.versionDir(id)
  ensureDir(dir)
  writeJson(paths.versionJson(id), json)
  return paths.versionJson(id)
}

/** 读取本地已安装版本 JSON（合并后的） */
function readInstalledVersion(id) {
  return readJson(paths.versionJson(id))
}

/** 版本是否已安装（JSON + 客户端 jar 齐全） */
function isInstalled(id) {
  return exists(paths.versionJson(id)) && exists(paths.versionJar(id))
}

/** 版本 JSON 是否存在（mod 加载器可能无需独立 jar，用父版本 jar） */
function isJsonInstalled(id) {
  return exists(paths.versionJson(id))
}

/** 扫描本地已安装版本 */
function listInstalled() {
  const dir = paths.versionsDir()
  const out = []
  if (!exists(dir)) return out
  const fs = require('fs')
  for (const name of fs.readdirSync(dir)) {
    const json = readJson(paths.versionJson(name))
    if (!json) continue
    out.push({
      id: json.id || name,
      type: json.type || 'release',
      releaseTime: json.releaseTime || '',
      javaMajor: json.javaVersion ? json.javaVersion.majorVersion : null,
      hasJar: exists(paths.versionJar(name)),
      inheritsFrom: json.inheritsFrom || null,
      mainClass: json.mainClass || '',
    })
  }
  out.sort((a, b) => (b.releaseTime || '').localeCompare(a.releaseTime || ''))
  return out
}

/** 删除已安装版本 */
function deleteInstalled(id) {
  const dir = paths.versionDir(id)
  if (exists(dir)) require('../util/fs').removeDir(dir)
}

module.exports = {
  getVersionManifest,
  fetchRemoteVersionJson,
  resolveVersionJson,
  mergeVersionJson,
  saveInstalledVersion,
  readInstalledVersion,
  isInstalled,
  isJsonInstalled,
  listInstalled,
  deleteInstalled,
}
