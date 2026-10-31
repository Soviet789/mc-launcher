<template>
  <div class="page">
    <div class="page-head">
      <h2>账户</h2>
      <span class="sub">管理启动游戏使用的玩家身份</span>
    </div>

    <div class="hero">
      <!-- 微软正版 -->
      <div class="card panel">
        <div class="row" style="margin-bottom: 10px">
          <h3 style="margin: 0">Microsoft 正版登录</h3>
          <span class="badge badge-info">正版</span>
        </div>
        <p class="muted" style="font-size: 13px; line-height: 1.8; margin: 6px 0 14px">
          使用你的 Microsoft / Xbox 账户登录，支持拥有正版 Minecraft 的账号。
          登录时会打开系统浏览器，完成后自动返回启动器。
        </p>

        <div v-if="!hasClientId" class="hint" style="background: var(--warn-soft); border: 1px solid rgba(224,165,61,.4); padding: 10px 12px; border-radius: 8px; font-size: 12.5px; color: #f0c069; margin-bottom: 12px">
          ⚠ 尚未配置微软登录 Client ID。请先
          <a @click="$router.push('/settings')">前往设置填写</a>
          （需在 Azure 门户免费注册一个应用，步骤见 README「配置微软登录」）。
        </div>

        <button class="btn btn-primary" :disabled="accounts.loggingIn" @click="msLogin" style="width: 100%">
          <span v-if="accounts.loggingIn" class="spinner"></span>
          {{ accounts.loggingIn ? '等待浏览器完成登录…（10 分钟内有效）' : '使用 Microsoft 账户登录' }}
        </button>
        <div v-if="msError" class="hint" style="color: #ff9c9c; margin-top: 10px">{{ msError }}</div>
        <div v-else-if="accounts.loggingIn" class="hint" style="margin-top: 10px">
          请在打开的浏览器页面中完成登录；成功后会自动返回启动器。
        </div>
      </div>

      <!-- 离线登录 -->
      <div class="card panel">
        <div class="row" style="margin-bottom: 10px">
          <h3 style="margin: 0">离线登录</h3>
          <span class="badge badge-old">未验证</span>
        </div>
        <p class="muted" style="font-size: 13px; line-height: 1.8; margin: 6px 0 14px">
          无需联网验证，适合单机 / 局域网联机。玩家名长度与格式均不限制。
        </p>
        <div class="row">
          <input class="input" style="flex: 1" v-model="offlineName"
            placeholder="输入玩家名（任意字符）" @keyup.enter="addOffline" />
          <button class="btn btn-primary" @click="addOffline" :disabled="!offlineName.trim()">添加</button>
        </div>
      </div>
    </div>

    <!-- 账户列表 -->
    <div class="card" style="margin-top: 14px">
      <div class="row" style="margin-bottom: 12px">
        <h3 style="margin: 0">已保存账户（{{ accounts.list.length }}）</h3>
      </div>

      <div v-if="!accounts.list.length" class="empty-state" style="padding: 28px">
        还没有账户，先添加一个吧
      </div>

      <div v-else class="list">
        <div v-for="a in accounts.list" :key="a.id" class="list-row"
          :style="a.id === accounts.currentId ? 'background: var(--accent-soft)' : ''">
          <span class="badge" :class="a.type === 'msa' ? 'badge-info' : 'badge-old'">
            {{ a.type === 'msa' ? '正版' : '离线' }}
          </span>
          <div style="flex: 1; min-width: 0">
            <div class="row">
              <span class="title">{{ a.name }}</span>
              <span v-if="a.id === accounts.currentId" class="badge badge-release">当前</span>
            </div>
            <div class="meta mono">{{ formatUuid(a.uuid) }}</div>
          </div>
          <button v-if="a.id !== accounts.currentId" class="btn btn-sm" @click="setCurrent(a)">设为当前</button>
          <button v-if="a.type === 'msa'" class="btn btn-sm" @click="refreshAccount(a)">刷新登录</button>
          <button class="btn btn-danger btn-sm" @click="removeAccount(a)">删除</button>
        </div>
      </div>

      <div class="hint" style="margin-top: 12px; color: var(--muted); font-size: 12.5px">
        账户令牌保存在本机（可用系统密钥环加密）。离线账户与正版账户可共存，启动时使用「当前」账户。
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, onMounted } from 'vue'
import { useAccountsStore } from '../stores/accounts'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'

const accounts = useAccountsStore()
const settings = useSettingsStore()
const ui = useUiStore()

const offlineName = ref('')
const msError = ref('')

const hasClientId = computed(() => !!(settings.data && settings.data.microsoft && settings.data.microsoft.clientId))

function formatUuid(u) {
  if (!u) return ''
  const s = String(u).replace(/-/g, '')
  if (s.length !== 32) return u
  return `${s.slice(0, 8)}-${s.slice(8, 12)}-${s.slice(12, 16)}-${s.slice(16, 20)}-${s.slice(20)}`
}

async function msLogin() {
  msError.value = ''
  try {
    const acc = await accounts.loginMicrosoft()
    ui.success(`已登录：${acc.name}（Microsoft 正版）`)
  } catch (err) {
    msError.value = err.message
    ui.error(err.message)
  }
}

async function addOffline() {
  const name = offlineName.value.trim()
  if (!name) return
  try {
    await accounts.addOffline(name)
    offlineName.value = ''
    ui.success(`已添加离线账户 ${name}`)
  } catch (err) {
    ui.error(err.message)
  }
}

async function setCurrent(a) {
  try {
    await accounts.setCurrent(a.id)
    ui.info(`当前账户已切换为 ${a.name}`)
  } catch (err) {
    ui.error(err.message)
  }
}

async function refreshAccount(a) {
  try {
    await window.api.accounts.msRefresh(a.id)
    await accounts.load()
    ui.success(`${a.name} 登录已刷新`)
  } catch (err) {
    ui.error(err.message)
  }
}

async function removeAccount(a) {
  if (!confirm(`删除账户「${a.name}」？（不会影响你的 Microsoft 账户本身）`)) return
  try {
    await accounts.remove(a.id)
    ui.success('账户已删除')
  } catch (err) {
    ui.error(err.message)
  }
}

onMounted(async () => {
  await Promise.allSettled([accounts.load(), settings.load()])
})
</script>
