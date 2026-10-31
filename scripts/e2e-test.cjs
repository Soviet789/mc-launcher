/**
 * 端到端集成测试：真实安装版本 + 真实启动 Minecraft 进程
 * 用法：npx electron scripts/e2e-test.cjs [--version 1.7.10]
 * 测试对象默认 1.7.10（覆盖 legacy virtual 资源、Java 8、LWJGL2 老规则分支）
 * 说明：游戏本体安装到 ~/.minecraft（与正式使用一致），启动器数据用临时目录
 */
const path = require('path')
const fs = require('fs')
const { app } = require('electron')

const root = path.dirname(__dirname)
const t0 = Date.now()
const log = (...a) => console.log(`[${((Date.now() - t0) / 1000).toFixed(1)}s]`, ...a)

app.setPath('userData', path.join(require('os').tmpdir(), 'mcl-e2e-userdata'))

const jobs = require(path.join(root, 'electron/core/jobs.js'))
const launchCore = require(path.join(root, 'electron/core/launch.js'))
const manifest = require(path.join(root, 'electron/core/manifest.js'))
const install = require(path.join(root, 'electron/core/install.js'))
const javaUtil = require(path.join(root, 'electron/core/java.js'))
const accounts = require(path.join(root, 'electron/core/accounts.js'))
const instances = require(path.join(root, 'electron/core/instances.js'))
const paths = require(path.join(root, 'electron/core/paths.js'))

// 任务进度：仅在阶段/消息变化时打印
let lastJobKey = ''
jobs.setSender((_ch, p) => {
  const key = `${p.status}|${p.progress && p.progress.phase}|${p.message}|${(p.progress && p.progress.current) === (p.progress && p.progress.total) && p.progress.total}`
  if (key !== lastJobKey) {
    lastJobKey = key
    log(`[job] ${p.status} ${p.progress ? p.progress.phase : ''} ${p.progress && p.progress.total ? `${p.progress.current}/${p.progress.total}` : ''} ${p.message || (p.progress && p.progress.label) || ''}`)
  }
})

// 游戏事件：收集 + 打印
const collected = []
let gameExited = false
let gameExitCode = null
launchCore.setEventSink((ch, payload) => {
  if (ch === 'launch:log') {
    collected.push(String(payload.line))
    log(`[game:${payload.stream}] ${String(payload.line).slice(0, 180)}`)
  } else if (ch === 'launch:state') {
    log(`[state]`, JSON.stringify(payload))
    if (payload.state === 'exited') {
      gameExited = true
      gameExitCode = payload.code
    }
  }
})

function jobStub(name) {
  return {
    id: 'e2e-' + name,
    kind: 'e2e',
    status: 'running',
    message: '',
    progress: { phase: '', current: 0, total: 0, label: '' },
    createdAt: Date.now(),
    controller: null,
  }
}

const TEST_VERSION = process.argv.includes('--version')
  ? process.argv[process.argv.indexOf('--version') + 1]
  : '1.7.10'

async function main() {
  log(`===== E2E 开始：目标版本 ${TEST_VERSION} =====`)

  // ---------- 1. 版本 JSON + Java ----------
  const versionJson = await manifest.resolveVersionJson(TEST_VERSION)
  const wantJava = (versionJson.javaVersion && versionJson.javaVersion.majorVersion) || 8
  log(`版本 ${versionJson.id} 要求 Java ${wantJava}，主类 ${versionJson.mainClass}`)
  const java = await javaUtil.ensureJava(wantJava, jobStub('java'), null)
  log(`Java 就绪：Java ${java.version}（来源 ${java.source}）${java.path}`)

  // ---------- 2. 安装 ----------
  const startInstall = Date.now()
  await install.installVersion(TEST_VERSION, jobStub('install'), null)
  log(`安装完成，用时 ${((Date.now() - startInstall) / 1000).toFixed(1)}s`)

  const tasks = install.collectTasks(versionJson)
  const count = (list) => list.filter((t) => t && fs.existsSync(t.dest)).length
  let assetBytes = 0
  let assetCount = 0
  const walk = (dir) => {
    if (!fs.existsSync(dir)) return
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else {
        assetCount++
        assetBytes += fs.statSync(p).size
      }
    }
  }
  walk(paths.assetsObjectsDir())
  log(`客户端 jar：${fs.existsSync(tasks.client.dest) ? '✓' : '✗'}  ` +
      `依赖库 ${count(tasks.libraries)}/${tasks.libraries.length}  ` +
      `原生库 ${count(tasks.natives)}/${tasks.natives.length}  ` +
      `日志配置 ${count(tasks.logging)}/${tasks.logging.length}`)
  log(`资源对象：${assetCount} 个 / ${(assetBytes / 1024 / 1024).toFixed(1)} MB；版本 JSON：${manifest.isJsonInstalled(TEST_VERSION) ? '✓' : '✗'}`)

  // ---------- 3. 账户 + 实例 ----------
  const account = accounts.addOffline('E2E_Test')
  log(`离线账户：${account.name}，uuid=${account.uuid}`)
  const instance = instances.createInstance({ name: 'E2E-测试实例', versionId: TEST_VERSION, isolated: true })
  log(`实例：${instance.id} → ${instances.instanceGameDir(instance.id)}`)

  // ---------- 4. 启动并等待关键日志 ----------
  const launchPromise = launchCore.launch(instance, account, jobStub('launch'), null)
  launchPromise.catch(() => {}) // 失败在下方统一处理

  const marker = /LWJGL Version|Setting user|OpenGL|Narrator library|Reloading Texture|Backend library/i
  let markerSeen = false
  const deadline = Date.now() + 60000
  while (Date.now() < deadline && !gameExited) {
    if (collected.some((l) => marker.test(l))) {
      markerSeen = true
      break
    }
    await new Promise((r) => setTimeout(r, 400))
  }

  let launchError = null
  if (markerSeen) log('✅ 检测到 LWJGL/OpenGL 初始化日志 → 游戏已真实运行')
  else if (gameExited) log(`⚠ 游戏进程提前退出，code=${gameExitCode}`)
  else log('⚠ 60s 内未匹配到关键日志')

  // ---------- 5. 停止 ----------
  log('发送停止信号...')
  launchCore.stopGame()
  try {
    await Promise.race([
      launchPromise.catch((err) => {
        launchError = err
      }),
      new Promise((r) => setTimeout(r, 15000)),
    ])
  } catch {}
  if (launchError) log('启动过程报错：', launchError.message)

  // 等待退出事件落地
  for (let i = 0; i < 30 && !gameExited; i++) await new Promise((r) => setTimeout(r, 200))
  log(`游戏退出：exitCode=${gameExitCode}`)

  const pass = !launchError && (markerSeen || gameExitCode === 0)
  log(`===== E2E ${pass ? '通过 ✅' : '失败 ❌'} =====`)
  app.exit(pass ? 0 : 1)
}

app.whenReady().then(() => {
  main().catch((err) => {
    console.error('E2E 失败：', err)
    app.exit(2)
  })
})
