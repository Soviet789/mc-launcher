/**
 * 微软账户登录：OAuth 2.0 授权码 + PKCE（本地回环重定向）→ Xbox Live → Minecraft Services。
 * 需要在启动器设置中配置自己的 Azure 应用 Client ID（见 README「配置微软登录」）。
 */
const crypto = require('crypto')
const http = require('http')
const { shell } = require('electron')
require('../util/net') // 副作用：关闭 autoSelectFamily（见 util/net.js 顶部说明）

const AUTH_BASE = 'https://login.microsoftonline.com/consumers/oauth2/v2.0'
const SCOPES = 'XboxLive.signin offline_access'
const XBL_URL = 'https://user.auth.xboxlive.com/user/authenticate'
const XSTS_URL = 'https://xsts.auth.xboxlive.com/xsts/authorize'
const MC_AUTH_URL = 'https://api.minecraftservices.com/authentication/login_with_xbox'
const MC_PROFILE_URL = 'https://api.minecraftservices.com/minecraft/profile'

function base64url(buf) {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

async function postJson(url, body, { timeout = 30000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    })
    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {}
    if (!res.ok) {
      const err = new Error(json && json.XErr ? xstsErrorMessage(json.XErr) : `HTTP ${res.status}：${(text || '').slice(0, 200)}`)
      err.status = res.status
      err.body = json
      throw err
    }
    return json
  } finally {
    clearTimeout(timer)
  }
}

function xstsErrorMessage(code) {
  const n = Number(code)
  const map = {
    2148916233: '该 Microsoft 账户没有 Xbox 账号，请先到 xbox.com 创建',
    2148916235: '该账户所在地区不支持 Xbox Live 服务',
    2148916236: '请先完善 Xbox 个人资料（头像/昵称）后再登录',
    2148916237: '需要完成成人身份验证，请在微软账户页面处理后重试',
    2148916238: '账户需要家长/监护人同意，请在微软账户页面处理后重试',
  }
  return map[n] || `Xbox Live 授权失败（错误码 ${code}）`
}

/** MS OAuth token 端点（form） */
async function tokenRequest(params, { timeout = 30000 } = {}) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeout)
  try {
    const res = await fetch(`${AUTH_BASE}/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(params).toString(),
      signal: controller.signal,
    })
    const text = await res.text()
    let json = null
    try {
      json = JSON.parse(text)
    } catch {}
    if (!res.ok) {
      const desc = (json && (json.error_description || json.error)) || text
      throw new Error(`获取微软 token 失败：${String(desc).slice(0, 300)}`)
    }
    return json
  } finally {
    clearTimeout(timer)
  }
}

/** MS token → Xbox Live 用户 token → XSTS → Minecraft access token */
async function xboxToMinecraft(msAccessToken) {
  const xbl = await postJson(XBL_URL, {
    Properties: { AuthMethod: 'RPS', SiteName: 'user.auth.xboxlive.com', RpsTicket: `d=${msAccessToken}` },
    RelyingParty: 'http://auth.xboxlive.com',
    TokenType: 'JWT',
  })
  const uhs = xbl.DisplayClaims.xui[0].uhs

  const xsts = await postJson(XSTS_URL, {
    Properties: { SandboxId: 'RETAIL', UserTokens: [xbl.Token] },
    RelyingParty: 'rp://api.minecraftservices.com/',
    TokenType: 'JWT',
  })

  const mc = await postJson(MC_AUTH_URL, { identityToken: `XBL3.0 x=${uhs};${xsts.Token}` })
  return { accessToken: mc.access_token, expiresIn: mc.expires_in, xuid: xbl.DisplayClaims.xui[0].uhs ? xbl.DisplayClaims.xui[0].uhs : '' }
}

/** 获取 Minecraft 档案（正版角色名 + UUID） */
async function fetchMinecraftProfile(mcAccessToken) {
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), 20000)
  try {
    const res = await fetch(MC_PROFILE_URL, {
      headers: { Authorization: `Bearer ${mcAccessToken}`, Accept: 'application/json' },
      signal: controller.signal,
    })
    const text = await res.text()
    if (res.status === 404) throw new Error('该 Microsoft 账户未拥有 Minecraft（或尚未领取）')
    let json = null
    try {
      json = JSON.parse(text)
    } catch {}
    if (!res.ok) throw new Error(`获取 Minecraft 档案失败：HTTP ${res.status} ${text.slice(0, 200)}`)
    return { uuid: json.id, name: json.name }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * 完成微软登录全流程（打开系统浏览器 → 回环回调收授权码）
 * @returns {Promise<{name,uuid,xuid,accessToken,refreshToken,expiresAt,clientId}>}
 */
async function login({ clientId }) {
  if (!clientId) throw new Error('未配置微软登录 Client ID，请在「设置 → 微软登录 Client ID」中填写（方法见 README）')
  const verifier = base64url(crypto.randomBytes(32))
  const challenge = base64url(crypto.createHash('sha256').update(verifier).digest())
  const state = base64url(crypto.randomBytes(16))

  let resolveCode, rejectCode
  const codePromise = new Promise((resolve, reject) => {
    resolveCode = resolve
    rejectCode = reject
  })

  const server = http.createServer((req, res) => {
    try {
      const u = new URL(req.url, 'http://127.0.0.1')
      if (u.pathname !== '/callback') {
        res.writeHead(404).end('Not Found')
        return
      }
      if (u.searchParams.get('state') !== state) {
        res.writeHead(400).end('<h3>状态校验失败，请关闭本页面并重试</h3>')
        rejectCode(new Error('OAuth state 校验失败'))
        return
      }
      const errDesc = u.searchParams.get('error_description') || u.searchParams.get('error')
      if (errDesc) {
        res.writeHead(400).end(`<h3>登录失败：${errDesc}</h3>`)
        rejectCode(new Error(`登录被拒绝：${errDesc}`))
        return
      }
      const code = u.searchParams.get('code')
      if (!code) {
        res.writeHead(400).end('<h3>缺少授权码，请重试</h3>')
        rejectCode(new Error('回调缺少 code'))
        return
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
      res.end('<h3>登录成功！可以关闭本页面，返回启动器继续。</h3>')
      resolveCode(code)
    } catch (err) {
      rejectCode(err)
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  const port = server.address().port
  const redirectUri = `http://localhost:${port}/callback`

  const authUrl =
    `${AUTH_BASE}/authorize?client_id=${encodeURIComponent(clientId)}` +
    `&response_type=code&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(SCOPES)}&state=${state}` +
    `&code_challenge=${challenge}&code_challenge_method=S256&prompt=select_account`

  const timeout = setTimeout(() => {
    rejectCode(new Error('登录超时（10 分钟），请重新发起'))
  }, 10 * 60 * 1000)

  try {
    await shell.openExternal(authUrl)
    const code = await codePromise
    const tok = await tokenRequest({
      grant_type: 'authorization_code',
      client_id: clientId,
      code,
      redirect_uri: redirectUri,
      code_verifier: verifier,
      scope: SCOPES,
    })
    return await completeLogin(tok, clientId)
  } finally {
    clearTimeout(timeout)
    server.close()
  }
}

/** 用 MS token 换取 Minecraft token 并组装账户 */
async function completeLogin(tok, clientId) {
  const mc = await xboxToMinecraft(tok.access_token)
  const profile = await fetchMinecraftProfile(mc.accessToken)
  return {
    name: profile.name,
    uuid: profile.uuid,
    xuid: mc.xuid,
    accessToken: mc.accessToken,
    refreshToken: tok.refresh_token,
    expiresAt: Date.now() + (mc.expiresIn || tok.expires_in || 86400) * 1000,
    acquiredAt: Date.now(),
    clientId,
  }
}

/** 刷新微软账户（refresh_token → 新 token → 重新走 Xbox 链） */
async function refreshAccount(account, { clientId }) {
  const tok = await tokenRequest({
    grant_type: 'refresh_token',
    client_id: clientId,
    refresh_token: account.refreshToken,
    scope: SCOPES,
  })
  let mc
  try {
    mc = await xboxToMinecraft(tok.access_token)
  } catch (err) {
    // Xbox 链失败但 MS token 有效：保留旧档案信息重试一次
    throw err
  }
  let profile = { uuid: account.uuid, name: account.name }
  try {
    profile = await fetchMinecraftProfile(mc.accessToken)
  } catch {}
  return {
    name: profile.name || account.name,
    uuid: profile.uuid || account.uuid,
    xuid: mc.xuid || account.xuid,
    accessToken: mc.accessToken,
    refreshToken: tok.refresh_token || account.refreshToken,
    expiresAt: Date.now() + (mc.expiresIn || tok.expires_in || 86400) * 1000,
    acquiredAt: Date.now(),
    clientId,
  }
}

module.exports = { login, refreshAccount, fetchMinecraftProfile, xboxToMinecraft }
