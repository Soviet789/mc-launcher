/**
 * 实例（版本隔离）：每个实例 = 一个独立游戏目录 + 一份实例配置。
 * isolated=true  → 游戏目录 = userData/instances/<id>（存档/模组/配置完全隔离）
 * isolated=false → 游戏目录 = 基础 .minecraft（共享存档）
 */
const path = require('path')
const fs = require('fs')
const { readJson, writeJson, exists, ensureDir, removeDir } = require('../util/fs')
const paths = require('./paths')

function instanceFile(id) {
  return path.join(paths.instanceDir(id), 'instance.json')
}

const DEFAULTS = {
  isolated: true,
  javaPath: '', // 空 = 跟随全局
  memory: null, // null = 跟随全局 {min,max}
  jvmArgs: undefined, // undefined = 跟随全局
  windowSize: null,
}

function sanitizeId(name) {
  return String(name)
    .toLowerCase()
    .replace(/[^a-z0-9_\-\u4e00-\u9fa5]/g, '_')
    .slice(0, 40)
}

/** 创建实例 */
function createInstance({ name, versionId, isolated = true, javaPath = '', memory = null }) {
  if (!name || !String(name).trim()) throw new Error('实例名称不能为空')
  if (!versionId) throw new Error('缺少版本 ID')
  const base = sanitizeId(name) || 'instance'
  let id = base
  let n = 2
  while (exists(paths.instanceDir(id))) id = `${base}-${n++}`

  const dir = ensureDir(paths.instanceDir(id))
  const inst = {
    ...DEFAULTS,
    id,
    name: String(name).trim(),
    versionId,
    isolated: !!isolated,
    javaPath,
    memory,
    createdAt: Date.now(),
  }
  writeJson(instanceFile(id), inst)
  return inst
}

function listInstances() {
  const dir = paths.instancesDir()
  if (!exists(dir)) return []
  const out = []
  for (const name of fs.readdirSync(dir)) {
    const inst = readJson(instanceFile(name))
    if (inst && inst.id) out.push({ ...DEFAULTS, ...inst })
  }
  out.sort((a, b) => (a.createdAt || 0) - (b.createdAt || 0))
  return out
}

function getInstance(id) {
  const inst = readJson(instanceFile(id))
  return inst ? { ...DEFAULTS, ...inst } : null
}

function updateInstance(id, patch) {
  const inst = getInstance(id)
  if (!inst) throw new Error('实例不存在')
  const allowed = ['name', 'javaPath', 'memory', 'jvmArgs', 'isolated', 'versionId']
  for (const key of allowed) {
    if (patch[key] !== undefined) inst[key] = patch[key]
  }
  if (inst.name && !String(inst.name).trim()) throw new Error('实例名称不能为空')
  writeJson(instanceFile(id), inst)
  return inst
}

function deleteInstance(id) {
  const dir = paths.instanceDir(id)
  if (exists(dir)) removeDir(dir)
  return true
}

/** 实例的游戏目录 */
function instanceGameDir(id) {
  const inst = getInstance(id)
  if (inst && inst.isolated === false) return paths.baseGameDir()
  return paths.instanceDir(id)
}

/**
 * 确保至少有一个实例：没有则用已安装的最新版本自动创建
 * @returns {object|null}
 */
function ensureDefaultInstance() {
  const list = listInstances()
  if (list.length) return list[0]
  const manifest = require('./manifest')
  const installed = manifest.listInstalled()
  if (!installed.length) return null
  const latestRelease = installed.find((v) => v.type === 'release') || installed[0]
  return createInstance({ name: latestRelease.id, versionId: latestRelease.id, isolated: true })
}

module.exports = { createInstance, listInstances, getInstance, updateInstance, deleteInstance, instanceGameDir, ensureDefaultInstance }
