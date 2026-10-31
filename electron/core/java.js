const path = require('path')
const fs = require('fs')
const os = require('os')
const { execFile, execFileSync } = require('child_process')
const { promisify } = require('util')
const pExecFile = promisify(execFile)
const paths = require('./paths')
const { ensureDir, exists, removeDir } = require('../util/fs')
const { downloadFile, fetchJson } = require('../util/net')
const { extractZip } = require('../util/zip')
const settings = require('./settings')

const JAVA_BIN = process.platform === 'win32' ? 'java.exe' : 'java'

/** 解析 `java -version` 输出 → 主版本号 */
function parseMajor(text) {
  const m = /version "(.+?)"/.exec(text || '')
  if (!m) return null
  const v = m[1]
  if (v.startsWith('1.')) return parseInt(v.split('.')[1], 10)
  return parseInt(v.split('.')[0], 10)
}

function parseVersionString(text) {
  const m = /version "(.+?)"/.exec(text || '')
  return m ? m[1] : null
}

/** 探测指定 java 可执行文件 */
async function probeJava(binPath) {
  try {
    const { stderr, stdout } = await pExecFile(binPath, ['-version'], { timeout: 8000 })
    const text = (stderr || '') + (stdout || '')
    const major = parseMajor(text)
    if (!major) return null
    return { path: binPath, major, version: parseVersionString(text) }
  } catch {
    return null
  }
}

/** 收集候选 java 路径（不去重、不探测） */
function collectCandidates() {
  const out = new Set()
  const add = (p) => {
    if (p) out.add(p)
  }

  // 1. 用户配置
  const cfg = settings.get().javaPath
  if (cfg) add(exists(cfg) ? cfg : null)

  // 2. JAVA_HOME
  if (process.env.JAVA_HOME) add(path.join(process.env.JAVA_HOME, 'bin', JAVA_BIN))

  // 3. 启动器自己下载管理的 Java（优先于 PATH，复用已下载版本）
  const managed = paths.javaDir()
  if (exists(managed)) {
    for (const name of fs.readdirSync(managed)) {
      add(path.join(managed, name, 'bin', JAVA_BIN))
    }
  }

  // 4. PATH
  for (const dir of String(process.env.PATH || '').split(path.delimiter)) {
    if (dir) add(path.join(dir, JAVA_BIN))
  }

  // 5. 常见安装目录
  if (process.platform === 'linux') {
    for (const base of ['/usr/lib/jvm', '/usr/java', path.join(os.homedir(), '.jdks')]) {
      if (!exists(base)) continue
      for (const name of fs.readdirSync(base)) {
        add(path.join(base, name, 'bin', JAVA_BIN))
        // 有些发行版在 /usr/lib/jvm/<name>/jre/bin/java
        add(path.join(base, name, 'jre', 'bin', JAVA_BIN))
      }
    }
  } else if (process.platform === 'win32') {
    for (const root of [process.env['ProgramFiles'], process.env['ProgramFiles(x86)'], process.env.LOCALAPPDATA].filter(Boolean)) {
      if (!exists(root)) continue
      for (const name of fs.readdirSync(root)) {
        if (/^(Java|Eclipse Adoptium|Microsoft|Amazon Corretto|Zulu|BellSoft|Temurin|SapMachine|Azul)/i.test(name)) {
          add(path.join(root, name, 'bin', JAVA_BIN))
        }
      }
    }
  } else if (process.platform === 'darwin') {
    for (const base of ['/Library/Java/JavaVirtualMachines', path.join(os.homedir(), '.jdks')]) {
      if (!exists(base)) continue
      for (const name of fs.readdirSync(base)) add(path.join(base, name, 'Contents', 'Home', 'bin', JAVA_BIN))
    }
  }

  // 去重（解析符号链接）
  const seen = new Set()
  const result = []
  for (const p of out) {
    if (!exists(p)) continue
    let key = p
    try {
      key = fs.realpathSync(p)
    } catch {}
    if (seen.has(key)) continue
    seen.add(key)
    result.push(p)
  }
  return result
}

/** 检测本机全部可用 Java */
async function detectSystemJava() {
  const candidates = collectCandidates()
  const results = []
  const concurrency = 6
  let i = 0
  await Promise.all(
    Array.from({ length: Math.min(concurrency, candidates.length) }, async () => {
      while (i < candidates.length) {
        const idx = i++
        const info = await probeJava(candidates[idx])
        if (info) results.push(info)
      }
    })
  )
  results.sort((a, b) => b.major - a.major || a.path.localeCompare(b.path))
  return results
}

/** 平台参数（Adoptium 命名风格） */
function platformParams() {
  const osName = { win32: 'windows', linux: 'linux', darwin: 'mac' }[process.platform] || process.platform
  const arch = { x64: 'x64', arm64: 'aarch64', ia32: 'x32' }[process.arch] || process.arch
  return { osName, arch }
}

/* ================= 多厂商 Java 源 =================
 * 1. Adoptium Temurin（官方 API；二进制托管在 GitHub，国内网络可能不可达）
 * 2. Azul Zulu（api.azul.com 元数据 + cdn.azul.com 直连，国内可达性好）
 * 按设置的下载源偏好排序，逐个回退。
 */

/** Adoptium：latest 二进制地址（jre 优先，jdk 兜底，各自作为候选） */
function findAdoptiumCandidates(major, osName, arch) {
  return ['jre', 'jdk'].map((image) => ({
    vendor: `temurin-${image}`,
    version: `latest-${image}`,
    url: `https://api.adoptium.net/v3/binary/latest/${major}/ga/${osName}/${arch}/${image}/hotspot/normal/eclipse?project=jdk`,
  }))
}

/** Corretto：Amazon 官方直链（无需元数据 API，URL 规律、国内可达性尚可） */
function findCorrettoCandidates(major, osName, arch) {
  const os = osName === 'mac' ? 'macosx' : osName
  const a = { aarch64: 'aarch64', x64: 'x64' }[arch]
  if (!a || !['linux', 'windows', 'macosx'].includes(os)) return []
  const ext = os === 'windows' ? 'zip' : 'tar.gz'
  return [
    {
      vendor: 'corretto-jdk',
      version: 'latest',
      url: `https://corretto.aws/downloads/latest/amazon-corretto-${major}-${a}-${os}-jdk.${ext}`,
    },
  ]
}

/** Zulu：元数据 API 查询实际发行版（返回候选数组，jre 优先 jdk 兜底） */
async function findZuluCandidates(major, osName, arch) {
  const zuluOs = osName === 'mac' ? 'macos' : osName
  const zuluArch = { aarch64: 'arm64', x32: 'x86' }[arch] || arch
  const archiveType = zuluOs === 'windows' ? 'zip' : 'tar.gz'
  const out = []
  for (const pkgType of ['jre', 'jdk']) {
    const params = new URLSearchParams({
      java_version: String(major),
      os: zuluOs,
      arch: zuluArch,
      archive_type: archiveType,
      java_package_type: pkgType,
      release_status: 'ga',
      latest: 'true',
      availability_types: 'CA',
      page_size: '1',
    })
    const list = await fetchJson(`https://api.azul.com/metadata/v1/zulu/packages/?${params.toString()}`)
    if (Array.isArray(list) && list.length && list[0].download_url) {
      const b = list[0]
      out.push({
        vendor: `zulu-${pkgType}`,
        version: Array.isArray(b.java_version) ? b.java_version.join('.') : String(major),
        url: b.download_url,
        name: b.name,
      })
    }
    if (out.length) break // 有一个可用即可；jdk 兜底逻辑在 jre 查询为空时生效
  }
  return out
}

/** 汇总全部厂商候选（按下载源偏好排序；Adoptium 二进制走 GitHub，国内网络排后） */
async function listJavaCandidates(major, osName, arch) {
  const order =
    settings.get().downloadSource === 'bmcl'
      ? ['zulu', 'corretto', 'adoptium']
      : ['adoptium', 'zulu', 'corretto']
  const out = []
  let lastErr = null
  for (const vendor of order) {
    try {
      if (vendor === 'zulu') out.push(...(await findZuluCandidates(major, osName, arch)))
      else if (vendor === 'corretto') out.push(...findCorrettoCandidates(major, osName, arch))
      else out.push(...findAdoptiumCandidates(major, osName, arch))
    } catch (err) {
      lastErr = err
    }
  }
  if (!out.length) {
    throw new Error(`无法获取 Java ${major} 的下载信息（Adoptium / Zulu / Corretto 均不可达）${lastErr ? '：' + lastErr.message : ''}`)
  }
  return out
}

/** 下载指定主版本的 Java 并解压到启动器管理目录，返回 java 路径 */
async function downloadJava(major, job, signal) {
  const { osName, arch } = platformParams()
  const targetRoot = path.join(paths.javaDir(), `java-${major}-${osName}-${arch}`)
  const existing = findJavaIn(targetRoot)
  if (existing) return existing

  ensureDir(paths.javaDir())
  const candidates = await listJavaCandidates(major, osName, arch)

  let lastErr = null
  for (const c of candidates) {
    const isZip = /\.zip($|\?)/i.test(c.url)
    const ext = isZip ? '.zip' : '.tar.gz'
    const archive = path.join(paths.javaDir(), `dl-${major}-${c.vendor}${ext}`)
    try {
      if (job) job.message = `下载 Java ${major}（${c.vendor} ${c.version}）...`
      await downloadFile(c.url, archive, { signal })
      const extractRoot = path.join(paths.javaDir(), `extract-${major}-${c.vendor}`)
      removeDir(extractRoot)
      ensureDir(extractRoot)
      try {
        extractArchive(archive, extractRoot)
      } finally {
        try {
          fs.unlinkSync(archive)
        } catch {}
      }
      const bin = findJavaIn(extractRoot)
      if (!bin) throw new Error('解压后未找到 java 可执行文件')
      // 移动到最终目录
      removeDir(targetRoot)
      ensureDir(path.dirname(targetRoot))
      fs.renameSync(extractRoot, targetRoot)
      const finalBin = findJavaIn(targetRoot)
      if (finalBin) return finalBin
    } catch (err) {
      lastErr = err
      if (signal && signal.aborted) throw err
    }
  }
  throw lastErr || new Error(`下载 Java ${major} 失败`)
}

/** 按扩展名解压：.zip 用内置解析器，.tar.gz 用系统 tar（Win10+ 自带） */
function extractArchive(archive, dest) {
  if (/\.zip($|\?)/i.test(archive)) {
    // zip 内为单层顶级目录，映射时剥掉（与 tar -C dest 行为一致）
    extractZip(archive, dest, undefined, (n) => n.split('/').slice(1).join('/'))
    return
  }
  try {
    execFileSync('tar', ['-xf', archive, '-C', dest], { timeout: 300000, stdio: 'pipe' })
  } catch (err) {
    throw new Error(`解压失败（需要系统 tar 命令）：${(err.stderr && err.stderr.toString()) || err.message}`)
  }
}

/** 在目录中递归寻找 bin/java(.exe) */
function findJavaIn(root, depth = 0) {
  if (depth > 5 || !exists(root)) return null
  const binDir = path.join(root, 'bin')
  const bin = path.join(binDir, JAVA_BIN)
  if (exists(bin)) return bin
  for (const name of fs.readdirSync(root)) {
    const full = path.join(root, name)
    if (fs.statSync(full).isDirectory()) {
      const found = findJavaIn(full, depth + 1)
      if (found) return found
    }
  }
  return null
}

/**
 * 为版本挑选可用 Java：
 * 优先级：用户配置 → 精确主版本 → 更高版本（仅要求 >8 时）→ 下载
 * @returns {Promise<{path, major, version, source}>}
 */
async function ensureJava(requiredMajor, job, signal) {
  const wanted = Number(requiredMajor) || 17
  const detected = await detectSystemJava()
  const configuredPath = settings.get().javaPath

  const pick = (list) => list[0]
  const configuredInfo = configuredPath ? detected.find((j) => j.path === configuredPath) : null

  // 1. 精确匹配主版本（配置的优先）
  const exact =
    (configuredInfo && configuredInfo.major === wanted && configuredInfo) ||
    pick(detected.filter((j) => j.major === wanted))
  if (exact) return { ...exact, source: exact === configuredInfo ? 'configured' : 'system' }

  // 2. 新版本（要求 >8）可使用更高版本 Java；尊重用户显式配置
  if (wanted > 8) {
    if (configuredInfo && configuredInfo.major > wanted) return { ...configuredInfo, source: 'configured' }
    const newer = pick(detected.filter((j) => j.major > wanted))
    if (newer) return { ...newer, source: 'system' }
    // 3. 满足最低要求
    const enough = pick(detected.filter((j) => j.major >= wanted))
    if (enough) return { ...enough, source: enough === configuredInfo ? 'configured' : 'system' }
  }

  // 4. 旧版本（要求 ≤8）必须精确 Java 8，本机没有则下载
  // （提示文案由 downloadJava 内部按实际进度设置，避免复用托管 Java 时误报「下载中」）
  const bin = await downloadJava(wanted, job, signal)
  const info = await probeJava(bin)
  if (!info) throw new Error(`下载的 Java ${wanted} 无法运行：${bin}`)
  return { ...info, source: 'downloaded' }
}

module.exports = { parseMajor, probeJava, detectSystemJava, ensureJava, downloadJava, collectCandidates }
