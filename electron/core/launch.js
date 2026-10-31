const path = require('path')
const fs = require('fs')
const { spawn, exec } = require('child_process')
const paths = require('./paths')
const manifest = require('./manifest')
const install = require('./install')
const javaUtil = require('./java')
const rulesUtil = require('./rules')
const settings = require('./settings')
const jobs = require('./jobs')
const { extractZip } = require('../util/zip')
const { ensureDir, exists, removeDir, readJson } = require('../util/fs')

const LAUNCHER_NAME = 'MC-Launcher'
const LAUNCHER_VERSION = (() => {
  try {
    return require('../../package.json').version
  } catch {
    return '0.1.0'
  }
})()

let eventSink = null // (channel, payload) => void
let current = null // { child, instanceId, logStream }

function setEventSink(fn) {
  eventSink = fn
}
function emit(channel, payload) {
  eventSink && eventSink(channel, payload)
}

/** 引号感知的参数切分 */
function tokenize(str) {
  const out = []
  let cur = ''
  let inQuote = false
  for (let i = 0; i < str.length; i++) {
    const c = str[i]
    if (c === '"') inQuote = !inQuote
    else if ((c === ' ' || c === '\t') && !inQuote) {
      if (cur) out.push(cur)
      cur = ''
    } else cur += c
  }
  if (cur) out.push(cur)
  return out
}

function expand(str, map) {
  return String(str).replace(/\$\{(\w+)\}/g, (_, key) => (map[key] !== undefined ? String(map[key]) : ''))
}

function expandArgs(args, map) {
  const out = []
  for (const item of args || []) {
    if (typeof item === 'string') {
      out.push(expand(item, map))
    } else if (item && item.value !== undefined) {
      if (!rulesUtil.allowedBy(item.rules, { features: map.__features })) continue
      const vals = Array.isArray(item.value) ? item.value : [item.value]
      for (const v of vals) out.push(expand(v, map))
    }
  }
  return out
}

function hyphenateUuid(u) {
  if (!u) return '00000000-0000-0000-0000-000000000000'
  const s = String(u).replace(/-/g, '')
  if (s.length !== 32) return String(u)
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}

function splitUserArgs(str) {
  if (!str || !String(str).trim()) return []
  return tokenize(String(str).trim())
}

/** 收集 classpath（已允许的依赖库 + 客户端 jar） */
function buildClasspath(json) {
  const sep = rulesUtil.classpathSeparator()
  const parts = []
  for (const lib of json.libraries || []) {
    if (!rulesUtil.allowedBy(lib.rules)) continue
    // 纯原生库（只有 classifiers 无 artifact）：主 jar 不存在，不进 classpath
    if (lib.downloads && lib.downloads.classifiers && !lib.downloads.artifact) continue
    const artifact = lib.downloads && lib.downloads.artifact
    let rel = null
    if (artifact) rel = artifact.path
    else if (lib.name) rel = install.mavenPath(lib.name)
    if (rel) parts.push(path.join(paths.librariesDir(), rel))
  }
  parts.push(paths.versionJar(json.id))
  return parts.join(sep)
}

/** 老版本 map_to_resources / virtual 资源落地到游戏目录 */
function syncAssetsToGameDir(json, gameDir) {
  const idxId = json.assets || (json.assetIndex && json.assetIndex.id)
  if (!idxId) return
  const idx = readJson(path.join(paths.assetsIndexesDir(), `${idxId}.json`))
  if (!idx || !idx.objects) return

  if (idx.virtual) {
    const virtDir = path.join(paths.assetsDir(), 'virtual', idxId)
    ensureDir(virtDir)
    for (const [name, o] of Object.entries(idx.objects)) {
      const src = path.join(paths.assetsObjectsDir(), o.hash.slice(0, 2), o.hash)
      const dest = path.join(virtDir, name)
      if (exists(src) && (!exists(dest) || fs.statSync(dest).size !== o.size)) {
        ensureDir(path.dirname(dest))
        fs.copyFileSync(src, dest)
      }
    }
  }
  if (idx.map_to_resources) {
    const resDir = path.join(gameDir, 'resources')
    ensureDir(resDir)
    for (const [name, o] of Object.entries(idx.objects)) {
      const src = path.join(paths.assetsObjectsDir(), o.hash.slice(0, 2), o.hash)
      const dest = path.join(resDir, name)
      if (exists(src) && (!exists(dest) || fs.statSync(dest).size !== o.size)) {
        ensureDir(path.dirname(dest))
        fs.copyFileSync(src, dest)
      }
    }
  }
}

/** 解压全部原生库到 versions/<id>/natives */
function extractNatives(json, nativesTasks) {
  const dest = path.join(paths.versionDir(json.id), 'natives')
  removeDir(dest)
  ensureDir(dest)
  let count = 0
  for (const t of nativesTasks) {
    if (!exists(t.dest)) continue
    const exclude = (t.exclude || []).concat(['META-INF/'])
    try {
      count += extractZip(t.dest, dest, (name) => !exclude.some((ex) => name.startsWith(ex)))
    } catch (err) {
      emit('launch:log', { stream: 'system', line: `[警告] 解压原生库失败 ${t.label}: ${err.message}`, ts: Date.now() })
    }
  }
  return dest
}

/** 构建完整启动命令 */
function buildCommand(json, ctx) {
  const { javaPath, nativesDir, gameDir, account, instanceCfg } = ctx
  const mem = instanceCfg.memory || settings.get().memory || {}
  const res = settings.get().resolution || {}
  const sep = rulesUtil.classpathSeparator()

  const features = {
    is_demo_user: false,
    has_custom_resolution: !!res.custom,
    has_quick_plays_support: false,
    is_quick_play_singleplayer: false,
    is_quick_play_multiplayer: false,
    is_quick_play_realms: false,
  }

  const map = {
    __features: features,
    auth_player_name: account.name,
    version_name: json.id,
    game_directory: gameDir,
    assets_root: paths.assetsDir(),
    assets_index_name: json.assets || (json.assetIndex && json.assetIndex.id) || 'legacy',
    assets_dir: paths.assetsDir(),
    auth_uuid: hyphenateUuid(account.uuid),
    auth_access_token: account.accessToken || '0',
    auth_session: account.accessToken || '0',
    user_type: account.userType || 'legacy',
    user_properties: '{}',
    version_type: json.type || 'release',
    natives_directory: nativesDir,
    launcher_name: LAUNCHER_NAME,
    launcher_version: LAUNCHER_VERSION,
    classpath: buildClasspath(json),
    classpath_separator: sep,
    library_directory: paths.librariesDir(),
    game_assets: path.join(paths.assetsDir(), 'virtual', json.assets || (json.assetIndex && json.assetIndex.id) || 'legacy'),
    resolution_width: String(res.width || 1280),
    resolution_height: String(res.height || 720),
    clientid: account.clientId || '',
    xuid: account.xuid || '',
  }

  // JVM 参数：java [-XstartOnFirstThread(macOS)] -Xms -Xmx [用户参数] [版本 JVM 规则参数]
  const jvm = [javaPath]
  if (process.platform === 'darwin') jvm.push('-XstartOnFirstThread') // macOS 上 LWJGL 必须在主线程运行
  jvm.push(`-Xms${mem.min || 1024}M`, `-Xmx${mem.max || 4096}M`)
  jvm.push(...splitUserArgs(instanceCfg.jvmArgs !== undefined ? instanceCfg.jvmArgs : settings.get().jvmArgs))

  const versionJvm = json.arguments && json.arguments.jvm
  if (versionJvm) {
    jvm.push(...expandArgs(versionJvm, map))
  } else {
    jvm.push('-Djava.library.path=${natives_directory}'.replace('${natives_directory}', nativesDir))
    jvm.push('-cp', map.classpath)
  }

  // 游戏参数
  let gameArgs
  if (json.arguments && json.arguments.game) {
    gameArgs = expandArgs(json.arguments.game, map)
  } else if (json.minecraftArguments) {
    gameArgs = tokenize(json.minecraftArguments).map((v) => expand(v, map))
  } else {
    gameArgs = []
  }

  const command = [...jvm, json.mainClass || 'net.minecraft.client.main.Main', ...gameArgs]
  return { command, features, map }
}

/** 当前是否有游戏在运行 */
function isRunning() {
  return !!(current && current.child && !current.child.killed)
}

function runningInfo() {
  if (!isRunning()) return null
  return { pid: current.child.pid, instanceId: current.instanceId }
}

/** 停止游戏 */
function stopGame() {
  if (!isRunning()) return false
  const { child } = current
  if (process.platform === 'win32') {
    try {
      exec(`taskkill /PID ${child.pid} /T /F`)
    } catch {}
  } else {
    try {
      child.kill('SIGTERM')
    } catch {}
    setTimeout(() => {
      try {
        if (!child.killed) child.kill('SIGKILL')
      } catch {}
    }, 4000)
  }
  return true
}

/**
 * 启动游戏（阻塞直到进程退出）
 * @param {{id, versionId, javaPath?, memory?, jvmArgs?, isolated, name}} instance
 * @param {{name, uuid, accessToken, userType, type, xuid?}} account
 */
async function launch(instance, account, job, signal) {
  const vid = instance.versionId
  let json = manifest.readInstalledVersion(vid)
  if (!json) throw new Error(`版本 ${vid} 未安装，请先在「版本」页下载`)

  // 0. 前置检查：文件缺失则自动补装
  jobs.setPhase(job, 'files', '校验游戏文件')
  const tasks = install.collectTasks(json)
  const missing = [tasks.client, ...tasks.libraries, ...tasks.natives, ...tasks.logging].filter((t) => t && !exists(t.dest))
  if (missing.length > 0) {
    job.message = `检测到 ${missing.length} 个缺失文件，补全中...`
    await install.installVersion(vid, job, signal)
    json = manifest.readInstalledVersion(vid) || json
  }

  // 1. 游戏目录（版本隔离）
  const gameDir = instance.isolated === false ? paths.baseGameDir() : paths.instanceDir(instance.id)
  ensureDir(gameDir)

  // 2. Java
  jobs.setPhase(job, 'java', '准备 Java 环境')
  const required = (json.javaVersion && json.javaVersion.majorVersion) || (json.assets ? 8 : 17) || 17
  let javaPath = null
  if (instance.javaPath) {
    const info = await javaUtil.probeJava(instance.javaPath)
    if (info) javaPath = instance.javaPath
    else emit('launch:log', { stream: 'system', line: '[警告] 实例配置的 Java 无效，改用自动选择', ts: Date.now() })
  }
  if (!javaPath) {
    const chosen = await javaUtil.ensureJava(required, job, signal)
    javaPath = chosen.path
    emit('launch:log', { stream: 'system', line: `[Java] ${chosen.path} (Java ${chosen.version}，来源：${chosen.source})`, ts: Date.now() })
  }

  // 3. 资源落地 + 原生库
  jobs.setPhase(job, 'natives', '解压原生库')
  syncAssetsToGameDir(json, gameDir)
  const nativesDir = extractNatives(json, tasks.natives)

  // 4. 组装命令
  const accountInfo = {
    name: account.name,
    uuid: account.uuid,
    accessToken: account.accessToken || '0',
    userType: account.type === 'msa' ? 'msa' : 'legacy',
    xuid: account.xuid || '',
    clientId: account.clientId || '',
  }
  const { command } = buildCommand(json, { javaPath, nativesDir, gameDir, account: accountInfo, instanceCfg: instance })

  jobs.setPhase(job, 'running', '游戏运行中')
  emit('launch:state', { state: 'starting', instanceId: instance.id, pid: null })
  emit('launch:log', { stream: 'system', line: `[启动] ${instance.name || vid} → ${gameDir}`, ts: Date.now() })

  // 5. 日志文件
  const ts = new Date().toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const logFile = path.join(paths.logsDir(), `launch-${ts}.log`)
  ensureDir(paths.logsDir())
  const logStream = fs.createWriteStream(logFile, { flags: 'a' })
  logStream.write(`$ ${command.join(' ')}\n`)

  // 6. 进程
  await new Promise((resolve, reject) => {
    const child = spawn(command[0], command.slice(1), {
      cwd: gameDir,
      env: { ...process.env },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: false,
    })
    current = { child, instanceId: instance.id, logStream }

    const buffers = { stdout: '', stderr: '' }
    let flushTimer = null
    const flushLines = (stream) => {
      const buf = buffers[stream]
      if (!buf) return
      buffers[stream] = ''
      for (const line of buf.split(/\r?\n/)) {
        if (!line) continue
        logStream.write(`[${stream}] ${line}\n`)
        emit('launch:log', { stream, line, ts: Date.now() })
      }
    }
    const onData = (stream) => (chunk) => {
      buffers[stream] += chunk.toString('utf8')
      if (!flushTimer) flushTimer = setTimeout(() => { flushTimer = null; flushLines('stdout'); flushLines('stderr') }, 120)
      if (buffers[stream].length > 64 * 1024) { clearTimeout(flushTimer); flushTimer = null; flushLines('stdout'); flushLines('stderr') }
    }
    child.stdout.on('data', onData('stdout'))
    child.stderr.on('data', onData('stderr'))

    const onAbort = () => stopGame()
    if (signal) {
      if (signal.aborted) return onAbort()
      signal.addEventListener('abort', onAbort, { once: true })
    }

    child.on('error', (err) => {
      cleanup()
      emit('launch:state', { state: 'error', instanceId: instance.id, code: -1 })
      reject(new Error(`启动进程失败：${err.message}`))
    })
    child.on('exit', (code, sig) => {
      cleanup()
      flushLines('stdout')
      flushLines('stderr')
      emit('launch:state', { state: 'exited', instanceId: instance.id, code, signal: sig })
      resolve({ code })
    })

    function cleanup() {
      if (signal) signal.removeEventListener('abort', onAbort)
      if (flushTimer) clearTimeout(flushTimer)
      try {
        logStream.end()
      } catch {}
      if (current && current.child === child) current = null
    }
  }).then((r) => r)

  return `游戏已退出`
}

module.exports = { launch, stopGame, isRunning, runningInfo, setEventSink, tokenize, expandArgs, buildClasspath, buildCommand }
