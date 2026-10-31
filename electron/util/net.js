const fs = require('fs')
const path = require('path')
const crypto = require('crypto')
const netMod = require('net')
const { Readable } = require('stream')
const { pipeline } = require('stream/promises')
const { ensureDir, exists, sha1File } = require('./fs')

/**
 * 关闭 happy-eyeballs（autoSelectFamily）：
 * 部分机器 IPv6 路由不可达（ENETUNREACH），Node 默认并联 IPv4/IPv6 会因
 * IPv6 快速失败把整个连接拖成 ETIMEDOUT；串行模式会按地址逐个回退，稳定得多。
 */
try {
  if (typeof netMod.setDefaultAutoSelectFamily === 'function') netMod.setDefaultAutoSelectFamily(false)
} catch {}

const UA = 'MC-Launcher/0.1.0 (open-source minecraft launcher; github.com/mc-launcher)'

function headers(extra = {}) {
  return { 'User-Agent': UA, ...extra }
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms))
}

/** 带重试的 fetch（网络抖动时指数回退重试） */
async function fetchRetry(url, opts = {}, retries = 4) {
  let lastErr
  for (let i = 0; i <= retries; i++) {
    try {
      const res = await fetch(url, { ...opts, headers: headers(opts.headers) })
      if (res.status >= 500 && i < retries) {
        await sleep(800 * (i + 1))
        continue
      }
      return res
    } catch (err) {
      lastErr = err
      if (i < retries) await sleep(800 * (i + 1))
    }
  }
  throw lastErr
}

/** 下载 JSON */
async function fetchJson(url, { retries = 3, timeout = 30000, signal } = {}) {
  const res = await fetchRetry(url, { signal }, retries)
  if (!res.ok) throw new Error(`HTTP ${res.status} 获取 ${url}`)
  // 简单超时保护
  const text = await withTimeout(res.text(), timeout, url)
  try {
    return JSON.parse(text)
  } catch {
    throw new Error(`响应不是合法 JSON：${url}`)
  }
}

async function withTimeout(promise, ms, url) {
  let timer
  try {
    return await Promise.race([
      promise,
      new Promise((_, rej) => {
        timer = setTimeout(() => rej(new Error(`请求超时：${url}`)), ms)
      }),
    ])
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 下载单个文件（带 SHA-1 校验、断点式重下、原子落盘）
 * @returns {{skipped:boolean, bytes:number}}
 */
async function downloadFile(url, dest, { sha1, retries = 3, onProgress, signal } = {}) {
  if (exists(dest)) {
    if (!sha1) return { skipped: true, bytes: 0 }
    const cur = await sha1File(dest)
    if (cur === sha1) return { skipped: true, bytes: 0 }
  }
  ensureDir(path.dirname(dest))
  const tmp = dest + '.part'
  let lastErr
  for (let attempt = 0; attempt <= retries; attempt++) {
    const controller = new AbortController()
    const onAbort = () => controller.abort()
    if (signal) {
      if (signal.aborted) throw new Error('已取消')
      signal.addEventListener('abort', onAbort, { once: true })
    }
    // 停滞超时（而非总时长限制）：30s 内连不上 / 收不到首字节则中止；
    // 传输过程中只要持续有数据到达就不会触发，保证大文件慢速下载也能完成。
    let stallTimer = setTimeout(() => controller.abort(), 30000)
    const poke = () => {
      clearTimeout(stallTimer)
      stallTimer = setTimeout(() => controller.abort(), 90000)
    }
    try {
      // 断点续传：.part 存在且（有 SHA1 兜底校验 或 边车记录的 URL 一致）则从断点继续
      let startBytes = 0
      const urlFile = tmp + '.url'
      try {
        if (fs.existsSync(tmp)) {
          const st = fs.statSync(tmp)
          const sidecar = fs.existsSync(urlFile) ? fs.readFileSync(urlFile, 'utf8') : ''
          const ownable = !!sha1 || (sidecar && sidecar === url)
          if (st.size > 0 && ownable) {
            startBytes = st.size
          } else if (st.size > 0) {
            fs.unlinkSync(tmp) // 无法确认归属的旧断点，作废
          }
        }
      } catch {}
      if (startBytes === 0 && !sha1) {
        try {
          fs.writeFileSync(urlFile, url)
        } catch {}
      }
      const reqHeaders = startBytes > 0 ? { Range: `bytes=${startBytes}-` } : {}
      const res = await fetchRetry(url, { signal: controller.signal, headers: reqHeaders }, 1)
      let resumed = false
      if (res.status === 206) {
        resumed = true
      } else if (res.status === 200) {
        startBytes = 0 // 服务器忽略 Range，从头下载
      } else if (res.status === 416) {
        // 断点数据无效（超出文件大小等），删除后从头再来
        try {
          fs.unlinkSync(tmp)
          fs.unlinkSync(urlFile)
        } catch {}
        throw new Error(`HTTP 416 Range 无效，已重置断点`)
      } else {
        throw new Error(`HTTP ${res.status}`)
      }

      const total = (Number(res.headers.get('content-length')) || 0) + startBytes
      let received = startBytes
      let hash = null
      if (sha1) {
        hash = crypto.createHash('sha1')
        if (resumed) {
          // 重算已有部分的哈希（分块读入，避免大文件占用内存）
          const rs = fs.createReadStream(tmp, { highWaterMark: 1024 * 1024 })
          for await (const chunk of rs) hash.update(chunk)
          poke()
        }
      }
      const ws = fs.createWriteStream(tmp, { flags: resumed ? 'a' : 'w' })
      const src = Readable.fromWeb(res.body)
      src.on('data', (chunk) => {
        poke()
        received += chunk.length
        if (hash) hash.update(chunk)
        if (onProgress) onProgress(received, total)
      })
      await pipeline(src, ws)
      if (hash) {
        const dig = hash.digest('hex')
        if (dig !== sha1) {
          // 校验失败可能是断点数据损坏，删除断点让下次重试从零开始
          try {
            fs.unlinkSync(tmp)
            fs.unlinkSync(tmp + '.url')
          } catch {}
          throw new Error(`SHA-1 校验失败：${path.basename(dest)}`)
        }
      }
      fs.renameSync(tmp, dest)
      try {
        fs.unlinkSync(tmp + '.url')
      } catch {}
      if (signal) signal.removeEventListener('abort', onAbort)
      clearTimeout(stallTimer)
      return { skipped: false, bytes: received }
    } catch (err) {
      clearTimeout(stallTimer)
      if (signal) signal.removeEventListener('abort', onAbort)
      // 保留 .part 供下次断点续传（归属由边车 URL / SHA1 校验兜底；
      // 损坏数据已在 SHA1 失败 / 416 分支内联删除）
      lastErr = err
      if (signal && signal.aborted) throw new Error('已取消')
      if (attempt < retries) await sleep(500 * (attempt + 1))
    }
  }
  throw lastErr || new Error(`下载失败：${url}`)
}

/** 并发池：并发执行任务 */
async function mapPool(items, limit, worker) {
  const results = new Array(items.length)
  let index = 0
  const n = Math.max(1, Math.min(limit, items.length))
  const runners = Array.from({ length: n }, async () => {
    while (true) {
      const i = index++
      if (i >= items.length) break
      results[i] = await worker(items[i], i)
    }
  })
  await Promise.all(runners)
  return results
}

module.exports = { UA, fetchRetry, fetchJson, downloadFile, mapPool, sleep }
