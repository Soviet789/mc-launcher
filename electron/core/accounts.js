const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const { readJson } = require('../util/fs')
const paths = require('./paths')
const microsoft = require('./microsoft')

let state = null // { accounts: [], currentId }
let safeStorage = null

function getSafeStorage() {
  if (safeStorage !== null) return safeStorage
  try {
    safeStorage = require('electron').safeStorage
  } catch {
    safeStorage = false
  }
  return safeStorage
}

/** 离线 UUID：Java 版官方算法 MD5("OfflinePlayer:" + name) + version3 变体 */
function offlineUuid(name) {
  const hash = crypto.createHash('md5').update(`OfflinePlayer:${name}`, 'utf8').digest()
  hash[6] = (hash[6] & 0x0f) | 0x30
  hash[8] = (hash[8] & 0x3f) | 0x80
  return hash.toString('hex')
}

function load() {
  if (state) return state
  state = { accounts: [], currentId: null }
  try {
    const raw = fs.readFileSync(paths.accountsFile(), 'utf8')
    let text = raw
    if (raw.startsWith('enc:')) {
      const ss = getSafeStorage()
      if (ss && ss.isEncryptionAvailable()) {
        text = ss.decryptString(Buffer.from(raw.slice(4), 'base64'))
      } else {
        return state // 无法解密（换了机器/无密钥环）
      }
    }
    const parsed = JSON.parse(text)
    if (parsed && Array.isArray(parsed.accounts)) state = parsed
  } catch {}
  return state
}

function save() {
  if (!state) return
  const data = JSON.stringify(state)
  const file = paths.accountsFile()
  fs.mkdirSync(path.dirname(file), { recursive: true })
  let text = data
  try {
    const ss = getSafeStorage()
    if (ss && ss.isEncryptionAvailable()) text = 'enc:' + ss.encryptString(data).toString('base64')
  } catch {}
  const tmp = file + '.tmp'
  fs.writeFileSync(tmp, text)
  fs.renameSync(tmp, file)
}

function sanitize(account) {
  // 序列化时去除敏感冗余字段（保留 token）
  const { ...rest } = account
  return rest
}

function list() {
  return load().accounts.map(sanitize)
}

function get(id) {
  return load().accounts.find((a) => a.id === id) || null
}

function getCurrent() {
  const s = load()
  return s.accounts.find((a) => a.id === s.currentId) || null
}

function setCurrent(id) {
  const s = load()
  if (id && !s.accounts.some((a) => a.id === id)) throw new Error('账户不存在')
  s.currentId = id
  save()
  return getCurrent()
}

function addOffline(name) {
  // 离线玩家名不做格式与长度限制（兼容中文、空格外的任意字符）
  if (!String(name || '').trim()) throw new Error('请输入玩家名')
  const s = load()
  const uuid = offlineUuid(name)
  let acc = s.accounts.find((a) => a.uuid === uuid)
  if (!acc) {
    acc = {
      id: 'offline-' + uuid.slice(0, 12),
      type: 'offline',
      name,
      uuid,
      accessToken: '0',
      userType: 'legacy',
      createdAt: Date.now(),
    }
    s.accounts.push(acc)
  }
  if (!s.currentId) s.currentId = acc.id
  save()
  return sanitize(acc)
}

function addMicrosoft(profile) {
  const s = load()
  const uuid = String(profile.uuid).replace(/-/g, '').toLowerCase()
  let acc = s.accounts.find((a) => a.uuid === uuid)
  const merged = {
    id: 'msa-' + uuid.slice(0, 12),
    type: 'msa',
    name: profile.name,
    uuid,
    xuid: profile.xuid || '',
    accessToken: profile.accessToken,
    refreshToken: profile.refreshToken,
    expiresAt: profile.expiresAt || 0,
    acquiredAt: profile.acquiredAt || Date.now(),
    clientId: profile.clientId || '',
    userType: 'msa',
    createdAt: (acc && acc.createdAt) || Date.now(),
  }
  if (acc) Object.assign(acc, merged)
  else s.accounts.push(merged)
  if (!s.currentId) s.currentId = merged.id
  save()
  return sanitize(merged)
}

function remove(id) {
  const s = load()
  const idx = s.accounts.findIndex((a) => a.id === id)
  if (idx < 0) return false
  s.accounts.splice(idx, 1)
  if (s.currentId === id) s.currentId = s.accounts[0] ? s.accounts[0].id : null
  save()
  return true
}

/** 启动前确保微软账户 token 有效（过期自动刷新并落盘） */
async function ensureFresh(account) {
  if (!account || account.type !== 'msa') return account
  const margin = 5 * 60 * 1000
  if (account.expiresAt && account.expiresAt - Date.now() > margin) return account
  if (!account.refreshToken) throw new Error('微软登录已失效，请重新登录')
  const clientId = account.clientId || require('./settings').get().microsoft.clientId
  if (!clientId) throw new Error('微软登录已过期，且未配置 Client ID，无法刷新，请重新登录')
  try {
    const fresh = await microsoft.refreshAccount(account, { clientId })
    const s = load()
    const target = s.accounts.find((a) => a.id === account.id)
    if (target) Object.assign(target, fresh)
    save()
    return target || { ...account, ...fresh }
  } catch (err) {
    throw new Error(`微软账户刷新失败：${err.message}`)
  }
}

module.exports = {
  offlineUuid,
  list,
  get,
  getCurrent,
  setCurrent,
  addOffline,
  addMicrosoft,
  remove,
  ensureFresh,
}
