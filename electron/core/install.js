const path = require('path')
const fs = require('fs')
const { fetchJson, downloadFile, mapPool } = require('../util/net')
const { ensureDir, exists, readJson, writeJson } = require('../util/fs')
const paths = require('./paths')
const mirror = require('./mirror')
const rulesUtil = require('./rules')
const manifest = require('./manifest')
const settings = require('./settings')
const jobs = require('./jobs')

const DEFAULT_MAVEN = 'https://repo1.maven.org/maven2/'

/** `group:artifact:version[:classifier][@ext]` → maven 相对路径 */
function mavenPath(name) {
  let ext = 'jar'
  let n = name
  const at = n.indexOf('@')
  if (at >= 0) {
    ext = n.slice(at + 1)
    n = n.slice(0, at)
  }
  const [group, artifact, version, classifier] = n.split(':')
  const g = group.replace(/\./g, '/')
  const file = `${artifact}-${version}${classifier ? '-' + classifier : ''}.${ext}`
  return `${g}/${artifact}/${version}/${file}`
}

/** 由 URL 推导 libraries 目录下的相对路径 */
function pathFromUrl(url) {
  try {
    const u = new URL(url)
    let p = decodeURIComponent(u.pathname)
    if (p.startsWith('/')) p = p.slice(1)
    if (p) return p
  } catch {}
  return null
}

/** 主依赖库 → {url, urls[], dest 相对路径, sha1}（urls 为按优先级的多源回退列表） */
function libraryArtifact(lib) {
  if (lib.downloads) {
    const a = lib.downloads.artifact
    // 纯原生库（如 lwjgl-platform：只有 classifiers，主 jar 在所有源都不存在）→ 不下载主 jar
    if (!a) return null
    const p = a.path || pathFromUrl(a.url)
    const urls = []
    const primary = mirror.libraryUrl(lib) || a.url
    if (primary) urls.push(primary)
    if (a.url && !urls.includes(a.url)) urls.push(a.url)
    if (p && !urls.includes(`https://libraries.minecraft.net/${p}`)) urls.push(`https://libraries.minecraft.net/${p}`)
    return { path: p, sha1: a.sha1 || null, url: urls[0], urls }
  }
  if (lib.name) {
    const p = mavenPath(lib.name)
    const base = String(lib.url || DEFAULT_MAVEN).replace(/\/?$/, '/')
    const urls = [base + p]
    // 默认 maven central 的库，镜像源可作为回退（BMCL /maven 代理了 maven central）
    if (mirror.isMirror() && !lib.url) urls.push(`${mirror.BMCL}/maven/${p}`)
    return { path: p, sha1: null, url: urls[0], urls }
  }
  return null
}

/** 原生库（natives）→ {url, urls[], path, sha1} */
function nativeArtifact(lib) {
  const c = rulesUtil.pickNativesClassifier(lib)
  if (!c) return null
  const p = c.path || pathFromUrl(c.url)
  const url = mirror.classifierUrl(lib, c) || c.url
  if (!url || !p) return null
  const urls = [url]
  if (c.url && !urls.includes(c.url)) urls.push(c.url)
  const official = `https://libraries.minecraft.net/${p}`
  if (!urls.includes(official)) urls.push(official)
  return { path: p, sha1: c.sha1 || null, url: urls[0], urls }
}

/** 收集版本需要安装的所有下载任务 */
function collectTasks(json) {
  const tasks = { client: null, libraries: [], natives: [], logging: [] }

  // 客户端 jar
  const id = json.id
  const officialClient = json.downloads && json.downloads.client && json.downloads.client.url
  const clientUrl = mirror.clientJarUrl(id) || officialClient
  if (!clientUrl) throw new Error(`版本 ${id} 缺少客户端下载信息`)
  const clientSha1 = json.downloads && json.downloads.client ? json.downloads.client.sha1 : null
  const clientUrls = [clientUrl]
  if (officialClient && !clientUrls.includes(officialClient)) clientUrls.push(officialClient)
  tasks.client = { url: clientUrl, urls: clientUrls, dest: paths.versionJar(id), sha1: clientSha1, label: `${id}.jar` }

  // 依赖库 + 原生库
  const seen = new Set()
  for (const lib of json.libraries || []) {
    if (!rulesUtil.allowedBy(lib.rules)) continue
    const art = libraryArtifact(lib)
    if (art && art.path && art.url) {
      const key = art.path
      if (!seen.has(key)) {
        seen.add(key)
        tasks.libraries.push({
          url: art.url,
          urls: art.urls,
          dest: path.join(paths.librariesDir(), art.path),
          sha1: art.sha1,
          label: art.path,
        })
      }
    }
    const nat = nativeArtifact(lib)
    if (nat && !seen.has(nat.path)) {
      seen.add(nat.path)
      tasks.natives.push({
        url: nat.url,
        urls: nat.urls,
        dest: path.join(paths.librariesDir(), nat.path),
        sha1: nat.sha1,
        label: nat.path,
        exclude: (lib.extract && lib.extract.exclude) || [],
      })
    }
  }

  // 日志配置
  const logFile = json.logging && json.logging.client && json.logging.client.file
  if (logFile && logFile.url) {
    tasks.logging.push({
      url: logFile.url,
      dest: path.join(paths.assetsDir(), 'log_configs', logFile.id),
      sha1: logFile.sha1 || null,
      label: logFile.id,
    })
  }
  return tasks
}

/** 下载资源索引 + 全部资源对象（含虚拟资源落地） */
async function installAssets(json, job, signal) {
  const idx = json.assetIndex
  if (!idx) return { total: 0 }
  const idxDest = path.join(paths.assetsIndexesDir(), `${idx.id}.json`)
  await downloadAny([mirror.assetIndexUrl(idx), idx.url].filter(Boolean), idxDest, {
    sha1: idx.sha1,
    signal,
  })
  const index = readJson(idxDest)
  if (!index || !index.objects) return { total: 0 }

  const objs = Object.entries(index.objects).map(([name, o]) => ({ name, hash: o.hash, size: o.size || 0 }))
  let done = 0
  let bytes = 0
  const concurrency = Math.max(4, Number(settings.get().concurrency) || 16)
  jobs.setProgress(job, 0, objs.length, '资源文件')

  const urls = (hash) => {
    const list = [mirror.assetObjectUrl(hash)]
    const official = `https://resources.download.minecraft.net/${hash.slice(0, 2)}/${hash}`
    if (!list.includes(official)) list.push(official)
    return list
  }

  await mapPool(objs, concurrency, async (o) => {
    if (signal && signal.aborted) throw new Error('已取消')
    const dest = path.join(paths.assetsObjectsDir(), o.hash.slice(0, 2), o.hash)
    const res = await downloadAny(urls(o.hash), dest, { sha1: o.hash, signal })
    bytes += res.bytes
    done++
    if (done % 20 === 0 || done === objs.length) jobs.setProgress(job, done, objs.length, o.name)
  })

  // 虚拟资源（1.7.3 之前 virtual 资源需展开到 assets/virtual/<id>）
  if (index.virtual) {
    const virtDir = path.join(paths.assetsDir(), 'virtual', idx.id)
    ensureDir(virtDir)
    let vDone = 0
    for (const o of objs) {
      if (signal && signal.aborted) throw new Error('已取消')
      const src = path.join(paths.assetsObjectsDir(), o.hash.slice(0, 2), o.hash)
      const dest = path.join(virtDir, o.name)
      try {
        if (!exists(dest) || fs.statSync(dest).size !== o.size) {
          ensureDir(path.dirname(dest))
          fs.copyFileSync(src, dest)
        }
      } catch {}
      if (++vDone % 50 === 0) jobs.setProgress(job, vDone, objs.length, o.name)
    }
  }
  jobs.setProgress(job, objs.length, objs.length, '资源完成')
  return { total: objs.length, bytes, mapToResources: !!index.map_to_resources, virtual: !!index.virtual, indexId: idx.id }
}

/** 依次尝试多个 URL 下载同一文件（镜像失败回退官方） */
async function downloadAny(urls, dest, opts = {}) {
  const uniq = [...new Set(urls.filter(Boolean))]
  let lastErr
  for (const url of uniq) {
    try {
      return await downloadFile(url, dest, opts)
    } catch (err) {
      lastErr = err
      if (opts.signal && opts.signal.aborted) throw err
    }
  }
  throw lastErr || new Error(`下载失败：${dest}`)
}

/** 安装依赖库 + 原生库（供版本安装、加载器安装复用） */
async function installLibraries(tasks, job, signal, { nativesOnly = false } = {}) {
  const list = nativesOnly ? tasks.natives : [...tasks.libraries, ...tasks.natives]
  if (!list.length) return 0
  let done = 0
  const concurrency = Math.max(4, Number(settings.get().concurrency) || 16)
  jobs.setProgress(job, 0, list.length, '依赖库')
  await mapPool(list, concurrency, async (t) => {
    if (signal && signal.aborted) throw new Error('已取消')
    await downloadAny(t.urls && t.urls.length ? t.urls : [t.url], t.dest, { sha1: t.sha1, signal })
    done++
    jobs.setProgress(job, done, list.length, t.label.split('/').pop())
  })
  return list.length
}

/**
 * 完整安装一个版本：
 * 1. 拉取并合并版本 JSON（含 inheritsFrom） 2. 客户端 jar 3. 依赖库/原生库 4. 资源 5. 日志配置
 */
async function installVersion(id, job, signal) {
  // 1. 版本 JSON
  jobs.setPhase(job, 'version', '获取版本信息')
  const json = await manifest.resolveVersionJson(id)
  manifest.saveInstalledVersion(json.id || id, json)
  jobs.setProgress(job, 1, 1, `${json.id || id}.json`)

  const tasks = collectTasks(json)

  // 2. 客户端 jar
  jobs.setPhase(job, 'client', '客户端')
  await downloadAny(tasks.client.urls, tasks.client.dest, { sha1: tasks.client.sha1, signal })
  jobs.setProgress(job, 1, 1, tasks.client.label)

  // 3. 依赖库
  jobs.setPhase(job, 'libraries', '依赖库')
  await installLibraries(tasks, job, signal)

  // 4. 资源
  jobs.setPhase(job, 'assets', '游戏资源')
  await installAssets(json, job, signal)

  // 5. 日志配置
  if (tasks.logging.length) {
    jobs.setPhase(job, 'logging', '日志配置')
    let d = 0
    for (const t of tasks.logging) {
      await downloadAny([t.url], t.dest, { sha1: t.sha1, signal })
      jobs.setProgress(job, ++d, tasks.logging.length, t.label)
    }
  }
  return `${json.id || id} 安装完成`
}

/** 校验已安装版本完整性（缺失则返回任务数） */
async function verifyVersion(id, job, signal) {
  const json = manifest.readInstalledVersion(id)
  if (!json) return { needsRepair: true, reason: '缺少版本 JSON' }
  const tasks = collectTasks(json)
  const missing = []
  const check = async (t) => {
    if (!exists(t.dest)) return missing.push(t)
    if (t.sha1) {
      try {
        const { sha1File } = require('../util/fs')
        const h = await sha1File(t.dest)
        if (h !== t.sha1) missing.push(t)
      } catch {
        missing.push(t)
      }
    }
  }
  await check(tasks.client)
  for (const t of [...tasks.libraries, ...tasks.natives, ...tasks.logging]) await check(t)
  return { needsRepair: missing.length > 0, missing, json }
}

module.exports = { installVersion, verifyVersion, collectTasks, installLibraries, mavenPath, libraryArtifact, nativeArtifact, downloadAny }
