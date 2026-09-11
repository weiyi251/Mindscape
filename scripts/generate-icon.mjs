#!/usr/bin/env node
/**
 * Mindscape 应用图标生成器。
 *
 * 一条命令完成：绘制 1024×1024 源图 → 派生各平台图标 → 清理与桌面端无关的移动端产物。
 *
 *   pnpm icon
 *
 * 设计说明
 *   苔绿圆角方块为底，两个米白节点在上、一个陶土橙节点在下汇聚，以人字形连线相连，
 *   表达「把散落的文件连成一张思考空间」。连线刻意**不闭合**：
 *   三个点闭合成三角形会与系统「分享」图标混淆。
 *
 * 配色取自 src/styles/globals.css（开发计划书第十二章）
 *   米白 #F5F3EF / 苔绿 #5A7D6A（深 #46614F）/ 陶土橙 #C4703E（强调色）
 *
 * 实现
 *   纯几何 SDF 光栅化 + 手写 PNG 编码（node 内置 zlib），不引入任何第三方依赖。
 *   每个图形先求有符号距离场，再由 `0.5 - d` 得到像素覆盖率，天然抗锯齿。
 */

import fs from 'node:fs'
import path from 'node:path'
import zlib from 'node:zlib'
import { execSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')

// ---------------------------------------------------------------------------
// 配色与构图（设计空间固定 1024×1024）
// ---------------------------------------------------------------------------
const HEX = {
  canvas: '#F5F3EF',
  moss: '#5A7D6A',
  mossDeep: '#46614F',
  clay: '#C4703E',
}
const rgb = (hex) => {
  const n = parseInt(hex.slice(1), 16)
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255].map((v) => v / 255)
}
const C = { canvas: rgb(HEX.canvas), moss: rgb(HEX.moss), mossDeep: rgb(HEX.mossDeep), clay: rgb(HEX.clay) }

const S = 1024
const HALF = S / 2
const TILE = { pad: 34, radius: 208 }
const TILE_HW = HALF - TILE.pad

const NODES = [
  { x: 320, y: 318, r: 78, color: C.canvas },
  { x: 704, y: 318, r: 78, color: C.canvas },
  { x: 512, y: 668, r: 96, color: C.clay },
]
const EDGES = [
  [0, 2],
  [2, 1],
]
const EDGE_WIDTH = 54

// ---------------------------------------------------------------------------
// SDF
// ---------------------------------------------------------------------------
function sdRoundRect(px, py, hw, hh, r) {
  const qx = Math.abs(px) - (hw - r)
  const qy = Math.abs(py) - (hh - r)
  return Math.hypot(Math.max(qx, 0), Math.max(qy, 0)) + Math.min(Math.max(qx, qy), 0) - r
}
function sdSegment(px, py, ax, ay, bx, by) {
  const vx = bx - ax
  const vy = by - ay
  const wx = px - ax
  const wy = py - ay
  const t = Math.max(0, Math.min(1, (wx * vx + wy * vy) / (vx * vx + vy * vy)))
  return Math.hypot(wx - t * vx, wy - t * vy)
}
const cov = (d) => Math.max(0, Math.min(1, 0.5 - d))

// ---------------------------------------------------------------------------
// 光栅化
// ---------------------------------------------------------------------------
function render() {
  const buf = new Float32Array(S * S * 4)
  const put = (i, c, a) => {
    if (a <= 0) return
    const ia = 1 - a
    buf[i] = c[0] * a + buf[i] * ia
    buf[i + 1] = c[1] * a + buf[i + 1] * ia
    buf[i + 2] = c[2] * a + buf[i + 2] * ia
    buf[i + 3] = a + buf[i + 3] * ia
  }

  for (let y = 0; y < S; y++) {
    for (let x = 0; x < S; x++) {
      const i = (y * S + x) * 4

      // 底：苔绿对角渐变 + 左上柔光
      const tileD = sdRoundRect(x - HALF, y - HALF, TILE_HW, TILE_HW, TILE.radius)
      if (tileD < 0.5) {
        const t = Math.min(1, Math.max(0, (x + y) / (2 * S)))
        const base = [
          C.moss[0] + (C.mossDeep[0] - C.moss[0]) * t,
          C.moss[1] + (C.mossDeep[1] - C.moss[1]) * t,
          C.moss[2] + (C.mossDeep[2] - C.moss[2]) * t,
        ]
        const hl = Math.max(0, 1 - Math.hypot(x - S * 0.34, y - S * 0.26) / (S * 0.86)) * 0.14
        put(i, [
          base[0] + (1 - base[0]) * hl,
          base[1] + (1 - base[1]) * hl,
          base[2] + (1 - base[2]) * hl,
        ], cov(tileD))
      }

      // 连线
      let edgeD = Infinity
      for (const [a, b] of EDGES) {
        const d = sdSegment(x, y, NODES[a].x, NODES[a].y, NODES[b].x, NODES[b].y)
        if (d < edgeD) edgeD = d
      }
      put(i, C.canvas, cov(edgeD - EDGE_WIDTH / 2))

      // 节点
      for (const n of NODES) {
        put(i, n.color, cov(Math.hypot(x - n.x, y - n.y) - n.r))
      }
    }
  }

  const out = Buffer.alloc(S * S * 4)
  for (let i = 0; i < S * S; i++) {
    const a = buf[i * 4 + 3]
    if (a <= 0) continue
    out[i * 4] = Math.round(Math.min(1, buf[i * 4]) * 255)
    out[i * 4 + 1] = Math.round(Math.min(1, buf[i * 4 + 1]) * 255)
    out[i * 4 + 2] = Math.round(Math.min(1, buf[i * 4 + 2]) * 255)
    out[i * 4 + 3] = Math.round(a * 255)
  }
  return out
}

// ---------------------------------------------------------------------------
// PNG 编码
// ---------------------------------------------------------------------------
const CRC = (() => {
  const t = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    t[n] = c >>> 0
  }
  return t
})()
const crc32 = (b) => {
  let c = 0xffffffff
  for (let i = 0; i < b.length; i++) c = CRC[(c ^ b[i]) & 0xff] ^ (c >>> 8)
  return (c ^ 0xffffffff) >>> 0
}
function chunk(type, data) {
  const len = Buffer.alloc(4)
  len.writeUInt32BE(data.length)
  const body = Buffer.concat([Buffer.from(type, 'ascii'), data])
  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(body))
  return Buffer.concat([len, body, crc])
}
function encodePNG(size, rgba) {
  const stride = size * 4 + 1
  const raw = Buffer.alloc(stride * size)
  for (let y = 0; y < size; y++) {
    raw[y * stride] = 0
    rgba.copy(raw, y * stride + 1, y * size * 4, (y + 1) * size * 4)
  }
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(size, 0)
  ihdr.writeUInt32BE(size, 4)
  ihdr[8] = 8
  ihdr[9] = 6
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    chunk('IHDR', ihdr),
    chunk('IDAT', zlib.deflateSync(raw, { level: 9 })),
    chunk('IEND', Buffer.alloc(0)),
  ])
}

// ---------------------------------------------------------------------------
// SVG（浏览器标签页图标，矢量保真）
// ---------------------------------------------------------------------------
function buildSVG() {
  const lines = EDGES.map(([a, b]) => {
    const A = NODES[a]
    const B = NODES[b]
    return `    <line x1="${A.x}" y1="${A.y}" x2="${B.x}" y2="${B.y}" />`
  }).join('\n')
  const dots = NODES.map(
    (n) => `  <circle cx="${n.x}" cy="${n.y}" r="${n.r}" fill="${n.color === C.clay ? HEX.clay : HEX.canvas}" />`
  ).join('\n')
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${S} ${S}" width="${S}" height="${S}" role="img" aria-label="Mindscape 脑海空间">
  <defs>
    <linearGradient id="moss" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${HEX.moss}" />
      <stop offset="1" stop-color="${HEX.mossDeep}" />
    </linearGradient>
    <radialGradient id="glow" cx="0.34" cy="0.26" r="0.86">
      <stop offset="0" stop-color="#FFFFFF" stop-opacity="0.14" />
      <stop offset="1" stop-color="#FFFFFF" stop-opacity="0" />
    </radialGradient>
    <clipPath id="tile">
      <rect x="${TILE.pad}" y="${TILE.pad}" width="${TILE_HW * 2}" height="${TILE_HW * 2}" rx="${TILE.radius}" ry="${TILE.radius}" />
    </clipPath>
  </defs>
  <g clip-path="url(#tile)">
    <rect width="${S}" height="${S}" fill="url(#moss)" />
    <rect width="${S}" height="${S}" fill="url(#glow)" />
  </g>
  <g stroke="${HEX.canvas}" stroke-width="${EDGE_WIDTH}" stroke-linecap="round">
${lines}
  </g>
${dots}
</svg>
`
}

// ---------------------------------------------------------------------------
// 执行
// ---------------------------------------------------------------------------
const sourcePath = path.join(ROOT, 'src-tauri/icons/app-icon.png')
const svgPath = path.join(ROOT, 'public/favicon.svg')

fs.writeFileSync(sourcePath, encodePNG(S, render()))
fs.writeFileSync(svgPath, buildSVG(), 'utf8')
console.log(`源图   ${path.relative(ROOT, sourcePath)}  (${(fs.statSync(sourcePath).size / 1024).toFixed(1)} KB)`)
console.log(`图标   ${path.relative(ROOT, svgPath)}  (${(fs.statSync(svgPath).size / 1024).toFixed(1)} KB)`)

const bin = path.join(ROOT, 'node_modules/.bin', process.platform === 'win32' ? 'tauri.CMD' : 'tauri')
if (!fs.existsSync(bin)) {
  console.warn('\n未找到 Tauri CLI，跳过平台图标派生（先执行 pnpm install）。')
  process.exit(0)
}
execSync(`"${bin}" icon "${sourcePath}"`, { cwd: ROOT, stdio: ['ignore', 'inherit', 'inherit'] })

// 本项目只发布 Windows 桌面端，清掉 CLI 顺带生成的移动端产物
for (const dir of ['android', 'ios']) {
  const target = path.join(ROOT, 'src-tauri/icons', dir)
  if (fs.existsSync(target)) fs.rmSync(target, { recursive: true, force: true })
}
console.log('\n完成：src-tauri/icons/ 已更新（已移除 android/、ios/）。')
