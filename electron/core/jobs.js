/**
 * 任务管理：安装 / 下载 / 启动等长任务的状态与进度，统一推送给渲染进程。
 * 完成/失败/取消的任务会写入下载历史文件（跨重启保留，启动类任务不入历史）。
 */
const fs = require('fs')
const path = require('path')

let sender = null // (channel, payload) => void
const jobs = new Map()
let seq = 0
const lastSent = new Map()

// ---------- 下载历史（userData/jobs-history.json） ----------
const HISTORY_LIMIT = 200
let historyCache = null

function historyFile() {
  const paths = require('./paths') // 惰性引入：避免自测等无 app 环境在加载期求值
  return path.join(paths.userData(), 'jobs-history.json')
}

function ensureHistory() {
  if (historyCache) return historyCache
  historyCache = []
  try {
    const raw = JSON.parse(fs.readFileSync(historyFile(), 'utf8'))
    if (Array.isArray(raw)) historyCache = raw
  } catch {}
  return historyCache
}

function saveHistory() {
  try {
    fs.writeFileSync(historyFile(), JSON.stringify(historyCache || []))
  } catch {}
}

function recordHistory(job) {
  if (job.kind === 'launch') return // 启动任务不进下载历史
  const h = ensureHistory()
  h.unshift({
    id: job.id,
    kind: job.kind,
    meta: job.meta || null,
    status: job.status,
    message: job.message || '',
    error: job.error || null,
    progress: job.progress ? { ...job.progress } : null,
    createdAt: job.createdAt,
    endedAt: Date.now(),
  })
  if (h.length > HISTORY_LIMIT) h.length = HISTORY_LIMIT
  saveHistory()
}

function historyList() {
  return ensureHistory()
}

function clearHistory() {
  historyCache = []
  saveHistory()
  return []
}

function setSender(fn) {
  sender = fn
}

function emit(job) {
  const payload = { ...job }
  delete payload.signal
  delete payload.controller // AbortController 不可被 IPC 结构化克隆，必须剔除
  sender && sender('job:update', payload)
}

function emitThrottled(job, force = false) {
  const now = Date.now()
  const last = lastSent.get(job.id) || 0
  if (force || now - last > 150) {
    lastSent.set(job.id, now)
    emit(job)
  }
}

/** 创建任务，返回 job 对象（job.progress 由调用方更新） */
function createJob(kind, { cancellable = true, meta = null } = {}) {
  const id = 'job-' + ++seq
  const controller = cancellable ? new AbortController() : null
  const job = {
    id,
    kind, // install | java | launch | modpack | ...
    meta,
    status: 'running', // running | done | error | cancelled
    message: '',
    error: null,
    progress: { phase: '', current: 0, total: 0, label: '' },
    createdAt: Date.now(),
    controller,
  }
  jobs.set(id, job)
  emit(job)
  return job
}

function setPhase(job, phase, label = '') {
  job.progress.phase = phase
  job.progress.label = label
  job.progress.current = 0
  job.progress.total = 0
  emitThrottled(job, true)
}

function setProgress(job, current, total, label) {
  job.progress.current = current
  job.progress.total = total
  if (label !== undefined) job.progress.label = label
  emitThrottled(job)
}

function setMessage(job, message) {
  job.message = message
  emitThrottled(job, true)
}

function done(job, message = '') {
  job.status = 'done'
  job.message = message
  jobs.delete(job.id)
  recordHistory(job)
  emit(job)
  lastSent.delete(job.id)
}

function failed(job, err) {
  job.status = 'error'
  job.error = (err && err.message) || String(err)
  jobs.delete(job.id)
  recordHistory(job)
  emit(job)
  lastSent.delete(job.id)
}

function cancelled(job, message = '已取消') {
  job.status = 'cancelled'
  job.message = message
  jobs.delete(job.id)
  recordHistory(job)
  emit(job)
  lastSent.delete(job.id)
}

/** 运行一个异步任务，自动处理错误/取消 */
async function run(kind, fn, { cancellable = true } = {}) {
  const job = createJob(kind, { cancellable })
  try {
    const msg = await fn(job, job.controller && job.controller.signal)
    if (job.status === 'running') done(job, msg || '')
    return job
  } catch (err) {
    if (job.controller && job.controller.signal.aborted) cancelled(job)
    else failed(job, err)
    throw err
  }
}

function cancel(jobId) {
  const job = jobs.get(jobId)
  if (!job) return false
  if (job.controller) job.controller.abort()
  else cancelled(job)
  return true
}

function list() {
  return [...jobs.values()].map((j) => {
    const { controller, ...rest } = j
    return rest
  })
}

module.exports = { setSender, run, createJob, cancel, list, setPhase, setProgress, setMessage, done, failed, cancelled, historyList, clearHistory }
