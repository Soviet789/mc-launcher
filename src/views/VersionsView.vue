<template>
  <div class="page">
    <div class="page-head">
      <h2>版本管理</h2>
      <span class="badge" :class="mirrorActive ? 'badge-info' : 'badge-release'">
        {{ mirrorActive ? 'BMCLAPI 镜像' : '官方源' }}
      </span>
      <div class="actions">
        <button class="btn btn-sm" @click="refresh" :disabled="versions.remoteLoading">
          {{ versions.remoteLoading ? '加载中…' : '↻ 刷新列表' }}
        </button>
      </div>
    </div>

    <div class="tabs">
      <button :class="{ active: tab === 'remote' }" @click="tab = 'remote'">可用版本</button>
      <button :class="{ active: tab === 'installed' }" @click="tab = 'installed'">
        已安装（{{ versions.installed.length }}）
      </button>
      <button :class="{ active: tab === 'loader' }" @click="switchLoader">模组加载器</button>
    </div>

    <!-- ============ 可用版本 ============ -->
    <template v-if="tab === 'remote'">
      <div class="row wrap" style="margin-bottom: 14px">
        <input class="input" style="width: 240px" v-model="query" placeholder="搜索版本，如 1.21.4" />
        <div class="segment">
          <button v-for="f in typeFilters" :key="f.value" :class="{ active: typeFilter === f.value }"
            @click="typeFilter = f.value">{{ f.label }}</button>
        </div>
        <span class="spacer"></span>
        <span class="muted" style="font-size: 12.5px">共 {{ filtered.length }} 个版本</span>
      </div>

      <div v-if="!filtered.length && !versions.remoteLoading" class="empty-state">
        <div class="big">🔍</div>
        没有匹配的版本
      </div>

      <div v-else class="list">
        <div v-for="v in visible" :key="v.id" class="list-row">
          <div style="flex: 1; min-width: 0">
            <div class="row">
              <span class="title mono">{{ v.id }}</span>
              <span class="badge" :class="typeBadge(v.type)">{{ typeText(v.type) }}</span>
              <span v-if="v.installed" class="badge badge-info">已安装</span>
            </div>
            <div class="meta">{{ fmtDate(v.releaseTime) }}</div>
          </div>
          <button v-if="!v.installed" class="btn btn-primary btn-sm"
            :disabled="jobs.installingVersion(v.id)" @click="install(v.id)">
            {{ jobs.installingVersion(v.id) ? '下载中…' : '安装' }}
          </button>
          <template v-else>
            <button class="btn btn-sm" @click="verify(v.id)">校验</button>
            <button class="btn btn-danger btn-sm" @click="remove(v.id)">删除</button>
          </template>
        </div>
      </div>

      <div v-if="visible.length < filtered.length" style="text-align: center; margin-top: 14px">
        <button class="btn" @click="visibleCount += 60">
          加载更多（已显示 {{ visible.length }} / {{ filtered.length }}）
        </button>
      </div>
    </template>

    <!-- ============ 已安装 ============ -->
    <template v-else-if="tab === 'installed'">
      <div v-if="!versions.installed.length" class="empty-state">
        <div class="big">📦</div>
        还没有安装任何版本<br />
        <button class="btn btn-primary" style="margin-top: 10px" @click="tab = 'remote'">去可用版本下载</button>
      </div>

      <div v-else class="list">
        <div v-for="v in versions.installed" :key="v.id" class="list-row">
          <div style="flex: 1; min-width: 0">
            <div class="row">
              <span class="title mono">{{ v.id }}</span>
              <span class="badge" :class="typeBadge(v.type)">{{ typeText(v.type) }}</span>
              <span v-if="loaderOf(v.id) !== 'vanilla'" class="badge" :class="'badge-' + loaderOf(v.id)">
                {{ loaderName(loaderOf(v.id)) }}
              </span>
              <span v-if="!v.hasJar" class="badge badge-danger">缺 jar</span>
            </div>
            <div class="meta">
              主类 {{ v.mainClass || '—' }}<template v-if="v.javaMajor"> · Java {{ v.javaMajor }}</template>
              · {{ fmtDate(v.releaseTime) }}
            </div>
          </div>
          <button class="btn btn-sm" :disabled="jobs.installingVersion(v.id)" @click="verify(v.id)">校验</button>
          <button class="btn btn-sm" :disabled="jobs.installingVersion(v.id)" @click="repair(v.id)">
            {{ jobs.installingVersion(v.id) ? '修复中…' : '修复' }}
          </button>
          <button class="btn btn-danger btn-sm" @click="remove(v.id)">删除</button>
        </div>
      </div>
    </template>

    <!-- ============ 模组加载器 ============ -->
    <template v-else>
      <div class="card" style="margin-bottom: 14px">
        <div class="row wrap" style="gap: 14px">
          <div class="field" style="margin: 0">
            <label>加载器</label>
            <div class="segment">
              <button :class="{ active: loaderType === 'fabric' }" @click="setLoaderType('fabric')">Fabric</button>
              <button :class="{ active: loaderType === 'quilt' }" @click="setLoaderType('quilt')">Quilt</button>
            </div>
          </div>
          <div class="field" style="margin: 0">
            <label>游戏版本（先安装原版）</label>
            <select class="select" v-model="gameVersion">
              <option v-for="v in releaseVersions" :key="v.id" :value="v.id">{{ v.id }}</option>
            </select>
          </div>
        </div>
        <div class="hint" style="margin-top: 12px; font-size: 12.5px; color: var(--muted)">
          安装后会生成 <b class="mono">{{ loaderPrefix }}-loader-…-{{ gameVersion || '版本' }}</b> 版本，
          可在「新建实例」时选择。Forge / NeoForge 暂未支持（计划中）。
        </div>
      </div>

      <div v-if="!vanillaInstalledList.length" class="empty-state">
        <div class="big">🧩</div>
        请先在「可用版本」中安装一个原版游戏
      </div>

      <div v-else-if="loaderLoading" class="empty-state">加载器版本列表加载中…</div>

      <div v-else class="list">
        <div v-for="l in loaderVersions" :key="l.id" class="list-row">
          <div style="flex: 1">
            <div class="row">
              <span class="title mono">{{ l.id }}</span>
              <span v-if="l.stable" class="badge badge-release">稳定</span>
              <span v-else class="badge badge-snapshot">开发版</span>
              <span v-if="hasLoaderInstalled(l.id)" class="badge badge-info">已安装</span>
            </div>
          </div>
          <button class="btn btn-primary btn-sm" :disabled="!gameVersion || loaderBusy(l.id)" @click="installLoader(l.id)">
            {{ loaderBusy(l.id) ? '安装中…' : '安装' }}
          </button>
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted, onUnmounted } from 'vue'
import { useVersionsStore } from '../stores/versions'
import { useInstancesStore } from '../stores/instances'
import { useSettingsStore } from '../stores/settings'
import { useJobsStore } from '../stores/jobs'
import { useUiStore } from '../stores/ui'

const versions = useVersionsStore()
const instances = useInstancesStore()
const settings = useSettingsStore()
const jobs = useJobsStore()
const ui = useUiStore()

const tab = ref('remote')
const query = ref('')
const typeFilter = ref('all')
const visibleCount = ref(60)

const loaderType = ref('fabric')
const gameVersion = ref('')
const loaderVersions = ref([])
const loaderLoading = ref(false)

let offJob = null

const typeFilters = [
  { value: 'all', label: '全部' },
  { value: 'release', label: '正式版' },
  { value: 'snapshot', label: '快照' },
  { value: 'old', label: '旧版' },
]

const mirrorActive = computed(() => settings.data && settings.data.downloadSource === 'bmcl')

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  return versions.remote.filter((v) => {
    if (typeFilter.value === 'release' && v.type !== 'release') return false
    if (typeFilter.value === 'snapshot' && v.type !== 'snapshot') return false
    if (typeFilter.value === 'old' && v.type !== 'old_beta' && v.type !== 'old_alpha') return false
    if (q && !v.id.toLowerCase().includes(q)) return false
    return true
  })
})

const visible = computed(() => filtered.value.slice(0, visibleCount.value))

const vanillaInstalledList = computed(() => versions.vanillaInstalled.filter((v) => loaderOf(v.id) === 'vanilla'))

const releaseVersions = computed(() => vanillaInstalledList.value)
const loaderPrefix = computed(() => (loaderType.value === 'fabric' ? 'fabric' : 'quilt'))

watch([query, typeFilter], () => {
  visibleCount.value = 60
})

function typeText(t) {
  return { release: '正式版', snapshot: '快照', old_beta: '旧 Beta', old_alpha: '旧 Alpha' }[t] || t
}

function typeBadge(t) {
  if (t === 'release') return 'badge-release'
  if (t === 'snapshot') return 'badge-snapshot'
  return 'badge-old'
}

function fmtDate(iso) {
  if (!iso) return ''
  return String(iso).slice(0, 10)
}

function loaderOf(id = '') {
  if (/^fabric-loader/i.test(id)) return 'fabric'
  if (/^quilt-loader/i.test(id)) return 'quilt'
  if (/forge/i.test(id)) return 'forge'
  if (/neoforge/i.test(id)) return 'neoforge'
  return 'vanilla'
}

function loaderName(l) {
  return { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' }[l] || l
}

async function refresh() {
  try {
    await versions.loadRemote({ refresh: true })
    await versions.loadInstalled()
    ui.success('版本列表已刷新')
  } catch (err) {
    ui.error(err.message)
  }
}

async function install(id) {
  try {
    await versions.install(id)
    ui.info(`开始下载 ${id}`)
  } catch (err) {
    ui.error(err.message)
  }
}

async function verify(id) {
  try {
    const r = await window.api.versions.verify(id)
    if (r.needsRepair) {
      if (confirm(`检测到 ${r.missing ? r.missing.length : '?'} 个文件缺失/损坏，是否立即修复？\n${(r.missingNames || []).slice(0, 5).join('\n')}`)) {
        await repair(id)
      }
    } else {
      ui.success(`${id} 完整性校验通过`)
    }
  } catch (err) {
    ui.error(err.message)
  }
}

async function repair(id) {
  try {
    await window.api.versions.repair(id)
    ui.info(`开始修复 ${id}`)
  } catch (err) {
    ui.error(err.message)
  }
}

async function remove(id) {
  if (!confirm(`删除版本 ${id}？\n引用它的实例也会被一并删除（存档将丢失，请谨慎）。`)) return
  try {
    const r = await versions.remove(id)
    if (r.removedInstances && r.removedInstances.length) {
      ui.info(`已删除关联实例：${r.removedInstances.join('、')}`)
    }
    await instances.load()
    ui.success(`已删除 ${id}`)
  } catch (err) {
    ui.error(err.message)
  }
}

// ---------- 加载器 ----------
function switchLoader() {
  tab.value = 'loader'
  loadLoaders()
}

function setLoaderType(t) {
  loaderType.value = t
  loadLoaders()
}

async function loadLoaders() {
  if (!gameVersion.value && releaseVersions.value.length) gameVersion.value = releaseVersions.value[0].id
  loaderLoading.value = true
  try {
    const data = await window.api.loaders.list(loaderType.value)
    loaderVersions.value = data.loaders || []
  } catch (err) {
    ui.error(`加载器列表获取失败：${err.message}`)
    loaderVersions.value = []
  } finally {
    loaderLoading.value = false
  }
}

function hasLoaderInstalled(loaderVersion) {
  return versions.installed.some((v) => v.id === `${loaderPrefix.value}-loader-${loaderVersion}-${gameVersion.value}`)
}

function loaderBusy(loaderVersion) {
  return jobs.installingLoader(loaderType.value)
}

async function installLoader(loaderVersion) {
  try {
    await window.api.loaders.install({
      type: loaderType.value,
      gameVersion: gameVersion.value,
      loaderVersion,
    })
    ui.info(`开始安装 ${loaderType.value} ${loaderVersion} → ${gameVersion.value}`)
  } catch (err) {
    ui.error(err.message)
  }
}

onMounted(async () => {
  await versions.ensureLoaded()
  if (releaseVersions.value.length) gameVersion.value = releaseVersions.value[0].id
  // 任务完成后刷新已安装列表
  offJob = window.api.on.job((job) => {
    if (job.status === 'done' && ['install', 'loader'].includes(job.kind)) versions.loadInstalled()
  })
})

onUnmounted(() => {
  if (offJob) offJob()
})
</script>
