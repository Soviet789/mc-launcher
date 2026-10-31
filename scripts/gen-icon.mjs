/**
 * 生成应用图标 build/icon.png（512×512，像素风草方块，零依赖 PNG 编码）
 * 用法：node scripts/gen-icon.mjs
 */
import zlib from 'node:zlib'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
const OUT = path.join(root, 'build', 'icon.png')

const CELL = 16 // 每个像素格 16×16
const GRID = 32 // 32×32 画布 → 512×512
const W = GRID * CELL

// ---------- 颜色 ----------
const GREEN = ['#79b93f', '#6fae39', '#84c447', '#68a634'] // 草顶面
const DIRT_L = ['#8a5a30', '#7f5229', '#936138', '#754a25'] // 左侧面（暗）
const DIRT_R = ['#a06a38', '#976231', '#aa733f', '#8d5b2c'] // 右侧面（亮）
const EDGE = '#3e2a13' // 描边

// 等距立方体几何（32×32 网格内）
const cx = 16
const topCY = 10
const rx = 14
const ry = 8
const depth = 12 // 侧面高度

function inTop(x, y) {
  return Math.abs(x - cx) / rx + Math.abs(y - topCY) / ry <= 1
}
function inQuad(x, y, quad) {
  // 射线法点在多边形内
  let inside = false
  for (let i = 0, j = quad.length - 1; i < quad.length; j = i++) {
    const [xi, yi] = quad[i]
    const [xj, yj] = quad[j]
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}
const leftQuad = [
  [cx - rx, topCY],
  [cx, topCY + ry],
  [cx, topCY + ry + depth],
  [cx - rx, topCY + depth],
]
const rightQuad = [
  [cx + rx, topCY],
  [cx, topCY + ry],
  [cx, topCY + ry + depth],
  [cx + rx, topCY + depth],
]

function hash(x, y) {
  let h = (x * 374761393 + y * 668265263) ^ 0x5bf03635
  h = (h ^ (h >>> 13)) * 1274126177
  return Math.abs(h ^ (h >>> 16))
}
function pick(shades, x, y) {
  return shades[hash(x, y) % shades.length]
}

function hexToRgb(hex) {
  return [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16), 255]
}

// ---------- 绘制 ----------
const rgba = Buffer.alloc(W * W * 4)

function fillCell(gx, gy, rgb) {
  for (let y = gy * CELL; y < (gy + 1) * CELL; y++) {
    for (let x = gx * CELL; x < (gx + 1) * CELL; x++) {
      const i = (y * W + x) * 4
      rgba[i] = rgb[0]
      rgba[i + 1] = rgb[1]
      rgba[i + 2] = rgb[2]
      rgba[i + 3] = rgb[3]
    }
  }
}

for (let gy = 0; gy < GRID; gy++) {
  for (let gx = 0; gx < GRID; gx++) {
    const x = gx + 0.5
    const y = gy + 0.5
    if (inTop(x, y)) {
      fillCell(gx, gy, hexToRgb(pick(GREEN, gx, gy)))
    } else if (inQuad(x, y, leftQuad)) {
      fillCell(gx, gy, hexToRgb(pick(DIRT_L, gx, gy)))
    } else if (inQuad(x, y, rightQuad)) {
      fillCell(gx, gy, hexToRgb(pick(DIRT_R, gx, gy)))
    } else {
      // 立方体轮廓描边（紧贴面的透明像素改为深色边）
      const neighbors = [
        [1, 0],
        [-1, 0],
        [0, 1],
        [0, -1],
      ]
      let touched = false
      for (const [dx, dy] of neighbors) {
        const nx = x + dx
        const ny = y + dy
        if (inTop(nx, ny) || inQuad(nx, ny, leftQuad) || inQuad(nx, ny, rightQuad)) {
          touched = true
          break
        }
      }
      if (touched) fillCell(gx, gy, hexToRgb(EDGE))
    }
  }
}

// ---------- PNG 编码 ----------
const CRC_TABLE = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()

function crc32(buf) {
  let c = 0xffffffff
  for (let i = 0; i < buf.length; i++) c = CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}

function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const typeBuf = Buffer.from(type, 'ascii')
  const crcBuf = Buffer.alloc(4)
  crcBuf.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])))
  return Buffer.concat([len, typeBuf, data, crcBuf])
}

function encodePNG(width, height, pixels) {
  const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8 // bit depth
  ihdr[9] = 6 // color type RGBA
  const raw = Buffer.alloc((width * 4 + 1) * height)
  for (let y = 0; y < height; y++) {
    raw[y * (width * 4 + 1)] = 0 // filter: none
    pixels.copy(raw, y * (width * 4 + 1) + 1, y * width * 4, (y + 1) * width * 4)
  }
  return Buffer.concat([
    sig,
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

fs.mkdirSync(path.dirname(OUT), { recursive: true })
fs.writeFileSync(OUT, encodePNG(W, W, rgba))
console.log(`已生成 ${OUT}（${W}×${W}）`)
