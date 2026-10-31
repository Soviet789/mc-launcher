/**
 * 版本 JSON 中的规则（rules）与原生库（natives）解析。
 * Mojang 规则格式：
 *   "rules": [ { "action": "allow"|"disallow", "os": { "name": "windows"|"linux"|"osx", "arch": "x86"|"arm64", "version": "正则" }, "features": { "is_demo_user": true } } ]
 * 默认：无规则 = 允许；有规则 = 默认拒绝，按顺序应用（与官方启动器一致）。
 */

const osMap = { win32: 'windows', linux: 'linux', darwin: 'osx' }

function currentOs() {
  return osMap[process.platform] || process.platform
}

function currentArch() {
  // Mojang 规则中 arch 取值：x86 / arm64；x64 归一化为 x86? 官方 arch 是 'x86'(32位) 和 'arm64'
  return process.arch === 'arm64' ? 'arm64' : process.arch === 'ia32' ? 'x86' : 'x64'
}

/**
 * 判断是否允许
 * @param {Array|undefined} rules
 * @param {{os?:string, arch?:string, version?:string, features?:object}} ctx
 */
function allowedBy(rules, ctx = {}) {
  if (!rules || rules.length === 0) return true
  const osName = ctx.os || currentOs()
  const arch = ctx.arch || currentArch()
  const version = ctx.version || process.getSystemVersion?.() || ''
  const features = ctx.features || {}

  let allowed = false
  for (const rule of rules) {
    if (!matchRule(rule, osName, arch, version, features)) continue
    allowed = rule.action === 'allow'
  }
  return allowed
}

function matchRule(rule, osName, arch, version, features) {
  if (rule.os) {
    if (rule.os.name && rule.os.name !== osName) return false
    if (rule.os.arch && rule.os.arch !== arch) {
      // x86 规则也常用于兼容 32 位；x64 不匹配 x86
      return false
    }
    if (rule.os.version) {
      try {
        if (!new RegExp(rule.os.version).test(version)) return false
      } catch {
        return false
      }
    }
  }
  if (rule.features) {
    for (const [key, expected] of Object.entries(rule.features)) {
      if (Boolean(features[key]) !== Boolean(expected)) return false
    }
  }
  return true
}

/** 从库的 natives + downloads.classifiers 中挑出当前平台的原生包 URL */
function pickNativesClassifier(lib, ctx = {}) {
  const osName = ctx.os || currentOs()
  const arch = ctx.arch || currentArch()
  if (!lib.natives) return null
  // 形如 { "windows": "natives-windows", "linux": "natives-linux" }，可能带 ${arch}
  let key = lib.natives[osName]
  if (!key && osName === 'windows' && arch === 'arm64') key = lib.natives['windows-arm64']
  if (!key) return null
  key = key.replace('${arch}', arch === 'arm64' ? 'arm64' : '64')
  // classifier 可能进一步按 arch 限定（部分库有 natives-windows-64 / natives-windows-arm64）
  const classifiers = (lib.downloads && lib.downloads.classifiers) || {}
  const candidates = [
    arch === 'arm64' ? `natives-${osName}-arm64` : null,
    arch === 'x64' ? `natives-${osName}-64` : null,
    key,
  ].filter(Boolean)
  for (const c of candidates) {
    if (classifiers[c]) return { classifier: c, ...classifiers[c] }
  }
  // 没有精确匹配时，退回 natives 匹配的第一个含 arch 后缀的
  for (const [name, entry] of Object.entries(classifiers)) {
    if (name.startsWith(key)) return { classifier: name, ...entry }
  }
  return null
}

/** 原生 jar 解压时的过滤规则 */
function nativeExtractFilter(lib) {
  const allow = (lib.natives && lib.natives.rules && lib.natives.rules.length ? null : null)
  const exclude = (lib.extract && lib.extract.exclude) || []
  return (entryPath) => {
    if (entryPath.endsWith('/')) return false
    for (const ex of exclude) {
      if (entryPath.startsWith(ex)) return false
    }
    return true
  }
}

/** 生成 classpath 分隔符 */
function classpathSeparator() {
  return process.platform === 'win32' ? ';' : ':'
}

module.exports = {
  currentOs,
  currentArch,
  allowedBy,
  pickNativesClassifier,
  nativeExtractFilter,
  classpathSeparator,
}
