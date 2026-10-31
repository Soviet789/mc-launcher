/**
 * Modrinth 资源下载：搜索、版本列表、单文件安装、整合包（mrpack）安装。
 * 支持类型：mod（模组）、resourcepack（资源包）、shader（光影）、datapack（数据包）、modpack（整合包）
 */
const path = require('path')
const fs = require('fs')
const { fetchJson, downloadFile, mapPool } = require('../util/net')
const { ensureDir, exists, removeDir } = require('../util/fs')
const { extractZip } = require('../util/zip')
const paths = require('./paths')
const manifest = require('./manifest')
const install = require('./install')
const loaderInstaller = require('./loader')
const instances = require('./instances')
const jobs = require('./jobs')

const API = 'https://api.modrinth.com/v2'
const TMP_DIR = () => path.join(paths.userData(), 'tmp')

const FOLDER_BY_TYPE = {
  mod: 'mods',
  resourcepack: 'resourcepacks',
  shader: 'shaderpacks',
  datapack: 'datapacks',
}

function encodeFacets({ projectType, loaders, gameVersions } = {}) {
  const facets = []
  if (projectType) facets.push([`project_type:${projectType}`])
  if (loaders && loaders.length) facets.push(loaders.map((l) => `categories:${l}`))
  if (gameVersions && gameVersions.length) facets.push(gameVersions.map((v) => `versions:${v}`))
  return JSON.stringify(facets)
}

/** 搜索资源 */
async function search({ query = '', projectType = 'mod', loaders, gameVersions, index = 'relevance', limit = 20, offset = 0 } = {}) {
  const params = new URLSearchParams({
    facets: encodeFacets({ projectType, loaders, gameVersions }),
    index,
    limit: String(Math.min(100, Math.max(1, limit))),
    offset: String(Math.max(0, offset)),
  })
  if (query) params.set('query', query)
  const data = await fetchJson(`${API}/search?${params}`)
  return {
    totalHits: data.total_hits || 0,
    hits: (data.hits || []).map((h) => ({
      id: h.project_id,
      slug: h.slug,
      title: h.title,
      description: h.description,
      icon: h.icon_url || '',
      downloads: h.downloads || 0,
      follows: h.follows || 0,
      categories: h.categories || [],
      projectType: h.project_type,
      author: h.author || '',
      dateModified: h.date_modified || '',
      versions: h.versions || [],
      clientSide: h.client_side || '',
    })),
  }
}

/** 项目详情 */
async function project(idOrSlug) {
  const p = await fetchJson(`${API}/project/${encodeURIComponent(idOrSlug)}`)
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    description: p.description,
    body: p.body || '',
    icon: p.icon_url || '',
    projectType: p.project_type,
    downloads: p.downloads || 0,
    follows: p.follows || 0,
    license: (p.license && p.license.id) || '',
    categories: p.categories || [],
    gameVersions: p.game_versions || [],
    loaders: p.loaders || [],
    author: p.team || '',
    dateModified: p.date_modified || '',
  }
}

/** 项目可用版本（可按加载器/游戏版本过滤） */
async function versions(projectId, { loaders, gameVersions } = {}) {
  const params = new URLSearchParams()
  if (loaders && loaders.length) params.set('loaders', JSON.stringify(loaders))
  if (gameVersions && gameVersions.length) params.set('game_versions', JSON.stringify(gameVersions))
  const qs = params.toString()
  const list = await fetchJson(`${API}/project/${encodeURIComponent(projectId)}/version${qs ? '?' + qs : ''}`)
  return list.map((v) => ({
    id: v.id,
    projectId: v.project_id,
    name: v.name || v.version_number,
    versionNumber: v.version_number,
    type: v.version_type, // release | beta | alpha
    gameVersions: v.game_versions || [],
    loaders: v.loaders || [],
    datePublished: v.date_published,
    downloads: v.downloads || 0,
    changelog: (v.changelog || '').slice(0, 4000),
    files: (v.files || []).map((f) => ({
      url: f.url,
      filename: f.filename,
      primary: !!f.primary,
      size: f.size || 0,
      sha1: (f.hashes && f.hashes.sha1) || null,
    })),
  }))
}

/** 下载并放入实例对应目录 */
async function installVersionFile({ versionId, projectType = 'mod', instanceId, targetFolder }, job, signal) {
  const inst = require('./instances').getInstance(instanceId)
  if (!inst) throw new Error('实例不存在')
  const gameDir = instances.instanceGameDir(instanceId)
  const folder = targetFolder || FOLDER_BY_TYPE[projectType] || 'mods'
  const destDir = path.join(gameDir, folder)
  ensureDir(destDir)

  const vs = await fetchJson(`${API}/version/${encodeURIComponent(versionId)}`)
  const primary = (vs.files || []).find((f) => f.primary) || (vs.files || [])[0]
  if (!primary) throw new Error('该版本没有可下载的文件')
  if (exists(path.join(destDir, primary.filename)) && !primary.sha1) {
    return `${primary.filename} 已存在`
  }
  if (job) jobs.setPhase(job, 'download', primary.filename)
  await downloadFile(primary.url, path.join(destDir, primary.filename), {
    sha1: primary.sha1,
    signal,
  })
  return `${primary.filename} 已下载到 ${folder}/`
}

/**
 * 安装整合包（.mrpack）：
 * 1. 创建实例（按 dependencies.minecraft 找原版） 2. 安装原版 + Fabric/Quilt 加载器
 * 3. 按 modrinth.index.json 下载全部文件 4. 解压 overrides 覆盖配置
 */
async function installModpack({ versionId, instanceName, isolated = true }, job, signal) {
  const vs = await fetchJson(`${API}/version/${encodeURIComponent(versionId)}`)
  const file = (vs.files || []).find((f) => f.primary) || (vs.files || [])[0]
  if (!file) throw new Error('整合包没有可下载的文件')

  ensureDir(TMP_DIR())
  const packFile = path.join(TMP_DIR(), `pack-${Date.now()}.mrpack`)
  if (job) jobs.setPhase(job, 'download-pack', file.filename)
  await downloadFile(file.url, packFile, { sha1: file.sha1, signal })

  // 解压 mrpack（zip）
  const packDir = path.join(TMP_DIR(), `pack-${Date.now()}`)
  ensureDir(packDir)
  try {
    extractZip(packFile, packDir)
    const index = JSON.parse(fs.readFileSync(path.join(packDir, 'modrinth.index.json'), 'utf8'))
    const deps = index.dependencies || {}
    const mcVersion = deps.minecraft
    if (!mcVersion) throw new Error('整合包缺少 Minecraft 版本信息')

    // 检测加载器
    let loaderType = null
    let loaderVersion = null
    if (deps['fabric-loader']) {
      loaderType = 'fabric'
      loaderVersion = deps['fabric-loader']
    } else if (deps['quilt-loader']) {
      loaderType = 'quilt'
      loaderVersion = deps['quilt-loader']
    } else if (deps.forge || deps['neoforge']) {
      throw new Error('该整合包基于 Forge/NeoForge，当前版本暂不支持（计划中），请改用 Fabric/Quilt 整合包')
    }

    // 创建实例（versionId 先用原版，装好加载器后更新）
    const inst = instances.createInstance({
      name: instanceName || (index.name || file.filename).replace(/\.mrpack$/i, ''),
      versionId: mcVersion,
      isolated,
    })
    const gameDir = instances.instanceGameDir(inst.id)

    // 1. 原版
    if (!manifest.isInstalled(mcVersion)) {
      if (job) jobs.setPhase(job, 'minecraft', `安装 Minecraft ${mcVersion}`)
      await install.installVersion(mcVersion, job, signal)
    }
    // 2. 加载器
    if (loaderType) {
      if (job) jobs.setPhase(job, 'loader', `安装 ${loaderType} ${loaderVersion}`)
      await loaderInstaller.installLoader({ type: loaderType, gameVersion: mcVersion, loaderVersion }, job, signal)
      instances.updateInstance(inst.id, { versionId: `${loaderType}-loader-${loaderVersion}-${mcVersion}` })
    }

    // 3. 下载索引中的文件
    const files = (index.files || []).filter((f) => !f.env || f.env.client !== 'unsupported')
    let done = 0
    if (job) jobs.setProgress(job, 0, files.length, '模组文件')
    await mapPool(files, 12, async (f) => {
      if (signal && signal.aborted) throw new Error('已取消')
      const dest = path.join(gameDir, f.path)
      if (exists(dest)) {
        done++
        if (job) jobs.setProgress(job, done, files.length, f.path)
        return
      }
      ensureDir(path.dirname(dest))
      const sha1 = f.hashes && f.hashes.sha1
      let ok = false
      for (const url of f.downloads || []) {
        try {
          await downloadFile(url, dest, { sha1, signal })
          ok = true
          break
        } catch (err) {
          if (signal && signal.aborted) throw err
        }
      }
      if (!ok) throw new Error(`下载失败：${f.path}`)
      done++
      if (job) jobs.setProgress(job, done, files.length, path.basename(f.path))
    })

    // 4. overrides（配置/默认存档等）
    const overrideDirs = ['overrides', 'client-overrides']
    let ovCount = 0
    for (const od of overrideDirs) {
      const src = path.join(packDir, od)
      if (!exists(src)) continue
      copyRecursive(src, gameDir)
      ovCount += 1
    }

    return `整合包 ${index.name || file.filename} 安装完成 → 实例「${inst.name}」`
  } finally {
    setTimeout(() => {
      try {
        fs.rmSync(packFile, { force: true })
        fs.rmSync(packDir, { recursive: true, force: true })
      } catch {}
    }, 500)
  }
}

function copyRecursive(src, dest) {
  ensureDir(dest)
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) copyRecursive(s, d)
    else if (entry.isFile()) {
      ensureDir(path.dirname(d))
      fs.copyFileSync(s, d)
    }
  }
}

module.exports = { search, project, versions, installVersionFile, installModpack, FOLDER_BY_TYPE }
