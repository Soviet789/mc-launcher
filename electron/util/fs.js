const fs = require('fs')
const path = require('path')
const crypto = require('crypto')

/** 递归创建目录 */
function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

/** 目录/文件是否存在 */
function exists(p) {
  try {
    fs.accessSync(p)
    return true
  } catch {
    return false
  }
}

/** 计算文件 SHA-1 */
function sha1File(file) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash('sha1')
    const stream = fs.createReadStream(file)
    stream.on('error', reject)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('end', () => resolve(hash.digest('hex')))
  })
}

function sha1Buffer(buf) {
  return crypto.createHash('sha1').update(buf).digest('hex')
}

/** 原子写文件：先写临时文件再重命名 */
function writeFileAtomic(file, data) {
  ensureDir(path.dirname(file))
  const tmp = file + '.tmp-' + process.pid
  fs.writeFileSync(tmp, data)
  fs.renameSync(tmp, file)
}

function readJson(file, fallback = undefined) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    return fallback
  }
}

function writeJson(file, obj) {
  writeFileAtomic(file, JSON.stringify(obj, null, 2))
}

/** 删除目录（递归） */
function removeDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true })
}

/** 递归拷贝目录 */
function copyDir(src, dest) {
  ensureDir(dest)
  for (const entry of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, entry.name)
    const d = path.join(dest, entry.name)
    if (entry.isDirectory()) copyDir(s, d)
    else if (entry.isFile()) fs.copyFileSync(s, d)
  }
}

/** 递归查找满足条件的文件，返回相对路径列表 */
function walkFiles(dir, filter = () => true, base = dir, out = []) {
  if (!exists(dir)) return out
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) walkFiles(full, filter, base, out)
    else if (entry.isFile() && filter(full)) out.push(path.relative(base, full))
  }
  return out
}

module.exports = {
  ensureDir,
  exists,
  sha1File,
  sha1Buffer,
  writeFileAtomic,
  readJson,
  writeJson,
  removeDir,
  copyDir,
  walkFiles,
}
