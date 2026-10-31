const fs = require('fs')
const path = require('path')
const zlib = require('zlib')

/**
 * 极简 zip 解压（零依赖）：支持 store(0)/deflate(8)，防目录穿越。
 * @param {string} zipPath
 * @param {string} destDir
 * @param {(name:string)=>boolean} filter 返回 false 的条目跳过
 * @param {(name:string)=>string} mapName 输出路径映射（默认原样）
 */
function extractZip(zipPath, destDir, filter = () => true, mapName = (n) => n) {
  const buf = fs.readFileSync(zipPath)

  // 定位中央目录结束记录 EOCD（签名 0x06054b50，注释最长 65535）
  let eocd = -1
  const min = Math.max(0, buf.length - 22 - 65535)
  for (let i = buf.length - 22; i >= min; i--) {
    if (buf.readUInt32LE(i) === 0x06054b50) {
      eocd = i
      break
    }
  }
  if (eocd < 0) throw new Error(`不是有效的 zip/jar：${path.basename(zipPath)}`)

  const entryCount = buf.readUInt16LE(eocd + 10)
  let offset = buf.readUInt32LE(eocd + 16)
  const destRoot = path.resolve(destDir)
  let extracted = 0

  for (let i = 0; i < entryCount; i++) {
    if (offset + 46 > buf.length || buf.readUInt32LE(offset) !== 0x02014b50) break
    const method = buf.readUInt16LE(offset + 10)
    const compSize = buf.readUInt32LE(offset + 20)
    const nameLen = buf.readUInt16LE(offset + 28)
    const extraLen = buf.readUInt16LE(offset + 30)
    const commentLen = buf.readUInt16LE(offset + 32)
    const localOffset = buf.readUInt32LE(offset + 42)
    const name = buf.toString('utf8', offset + 46, offset + 46 + nameLen)
    offset += 46 + nameLen + extraLen + commentLen

    if (name.endsWith('/')) continue // 目录项
    if (!filter(name)) continue
    const mapped = mapName(name)
    if (!mapped) continue

    // 从本地文件头读取数据起始位置
    if (localOffset + 30 > buf.length || buf.readUInt32LE(localOffset) !== 0x04034b50) continue
    const lNameLen = buf.readUInt16LE(localOffset + 26)
    const lExtraLen = buf.readUInt16LE(localOffset + 28)
    const dataStart = localOffset + 30 + lNameLen + lExtraLen
    const data = buf.subarray(dataStart, dataStart + compSize)

    const out = path.resolve(destRoot, mapped)
    if (out !== destRoot && !out.startsWith(destRoot + path.sep)) continue // zip-slip 防护
    fs.mkdirSync(path.dirname(out), { recursive: true })
    if (method === 0) fs.writeFileSync(out, data)
    else if (method === 8) fs.writeFileSync(out, zlib.inflateRawSync(data))
    else throw new Error(`不支持的压缩方式 ${method}：${name}`)
    extracted++
  }
  return extracted
}

module.exports = { extractZip }
