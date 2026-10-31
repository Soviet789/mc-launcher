<template>
  <div class="page">
    <div class="page-head">
      <h2>资源下载</h2>
      <span class="sub">来自 Modrinth</span>
      <div class="actions">
        <select class="select" v-if="projectType !== 'modpack'" v-model="targetInstanceId" title="安装目标实例">
          <option v-for="i in instances.list" :key="i.id" :value="i.id">→ {{ i.name }}</option>
          <option v-if="!instances.list.length" value="" disabled>（先创建实例）</option>
        </select>
      </div>
    </div>

    <div class="tabs">
      <button v-for="t in types" :key="t.value" :class="{ active: projectType === t.value }" @click="setType(t.value)">
        {{ t.label }}
      </button>
    </div>

    <!-- 搜索栏 -->
    <div class="row wrap" style="margin-bottom: 15px">
      <input class="input" style="width: 260px" v-model="query" placeholder="搜索名称或关键词…"
        @keyup.enter="doSearch(true)" />
      <select class="select" v-if="projectType === 'mod' || projectType === 'modpack'" v-model="loaderFilter">
        <option value="">全部加载器</option>
        <option value="fabric">Fabric</option>
        <option value="quilt">Quilt</option>
        <option value="forge">Forge</option>
        <option value="neoforge">NeoForge</option>
      </select>
      <input class="input" style="width: 120px" v-model="versionFilter" placeholder="如 1.21.4" />
      <select class="select" v-model="sortIndex" @change="doSearch(true)">
        <option value="relevance">相关度</option>
        <option value="downloads">下载量</option>
        <option value="follows">收藏数</option>
        <option value="newest">最新发布</option>
      </select>
      <button class="btn btn-primary" @click="doSearch(true)" :disabled="loading">搜索</button>
    </div>

    <div v-if="loading && !results.length" class="empty-state">搜索中…</div>
    <div v-else-if="!results.length" class="empty-state">
      <div class="big">🧭</div>
      没有找到资源，换个关键词试试？
    </div>

    <template v-else>
      <div class="row" style="margin-bottom: 12px">
        <span class="muted" style="font-size: 12.5px">共 {{ totalHits }} 个结果</span>
        <span class="spacer"></span>
        <span v-if="loading" class="muted" style="font-size: 12.5px">加载中…</span>
      </div>

      <div class="grid-cards">
        <div v-for="hit in results" :key="hit.id" class="res-card" @click="openDetail(hit)">
          <div class="head">
            <img v-if="hit.icon" class="icon" :src="hit.icon" alt="" />
            <div v-else class="icon empty">🧩</div>
            <div style="min-width: 0">
              <div class="name">{{ hit.title }}</div>
              <div class="author">by {{ hit.author }}</div>
            </div>
          </div>
          <div class="desc">{{ hit.description || '（无描述）' }}</div>
          <div class="foot">
            <span>⬇ {{ fmtNum(hit.downloads) }}</span>
            <span>★ {{ fmtNum(hit.follows) }}</span>
            <span class="spacer"></span>
            <span v-for="c in hit.categories.slice(0, 3)" :key="c" class="badge badge-old" style="font-size: 10px">{{ c }}</span>
          </div>
        </div>
      </div>

      <div v-if="results.length < totalHits" style="text-align: center; margin-top: 16px">
        <button class="btn" @click="loadMore" :disabled="loading">加载更多（{{ results.length }} / {{ totalHits }}）</button>
      </div>
    </template>

    <!-- ============ 详情弹窗 ============ -->
    <div v-if="detail" class="modal-mask" @click.self="detail = null">
      <div class="modal wide">
        <div class="row" style="align-items: flex-start; gap: 14px">
          <img v-if="detail.icon" :src="detail.icon" style="width: 58px; height: 58px; border-radius: 10px; object-fit: cover" />
          <div style="flex: 1; min-width: 0">
            <h3 style="margin-bottom: 4px">{{ detail.title }}</h3>
            <div class="muted" style="font-size: 12.5px">
              {{ detail.description }}
            </div>
          </div>
          <button class="btn btn-ghost btn-sm" @click="detail = null">✕ 关闭</button>
        </div>

        <div class="row wrap" style="margin: 14px 0; gap: 8px">
          <span class="badge badge-info">⬇ {{ fmtNum(detail.downloads) }}</span>
          <span v-if="detail.license" class="badge badge-old">{{ detail.license }}</span>
          <span v-for="c in detail.loaders" :key="c" class="badge badge-old">{{ c }}</span>
        </div>

        <!-- 整合包：安装表单 -->
        <template v-if="projectType === 'modpack'">
          <div class="field">
            <label>新实例名称</label>
            <input class="input" v-model="modpackName" placeholder="整合包实例" />
          </div>
          <label class="checkbox-line">
            <input type="checkbox" v-model="modpackIsolated" />
            版本隔离（推荐）
          </label>
          <div class="hint" style="margin-top: 8px; color: var(--muted); font-size: 12.5px">
            整合包将自动创建实例、安装对应版本与加载器（目前支持 Fabric / Quilt 整合包）。
          </div>
        </template>

        <div class="divider"></div>
        <div class="row" style="margin-bottom: 10px">
          <b>版本列表</b>
          <span class="muted" style="font-size: 12.5px">{{ versionFiltersText }}</span>
          <span class="spacer"></span>
          <button class="btn btn-ghost btn-sm" @click="loadVersions" :disabled="versionsLoading">↻ 刷新</button>
        </div>

        <div v-if="versionsLoading" class="empty-state" style="padding: 24px">加载中…</div>
        <div v-else-if="!detailVersions.length" class="empty-state" style="padding: 24px">
          没有匹配当前实例的版本（试试调整上方筛选或先安装对应加载器）
        </div>
        <div v-else class="list" style="max-height: 320px; overflow-y: auto">
          <div v-for="v in detailVersions" :key="v.id" class="list-row">
            <div style="flex: 1; min-width: 0">
              <div class="row">
                <span class="title">{{ v.name }}</span>
                <span class="badge" :class="v.type === 'release' ? 'badge-release' : v.type === 'beta' ? 'badge-snapshot' : 'badge-old'">
                  {{ v.type }}
                </span>
              </div>
              <div class="meta">
                {{ fmtDate(v.datePublished) }} · {{ (v.gameVersions || []).slice(0, 5).join('、') }}
                <template v-if="(v.loaders || []).length"> · {{ v.loaders.join('/') }}</template>
                · ⬇ {{ fmtNum(v.downloads) }}
              </div>
            </div>
            <button class="btn btn-primary btn-sm" @click="installVersion(v)" :disabled="installing">
              {{ projectType === 'modpack' ? '安装整合包' : '下载' }}
            </button>
          </div>
        </div>

        <div v-if="detail.body" class="divider"></div>
        <div v-if="detail.body" class="mono" style="max-height: 180px; overflow-y: auto; white-space: pre-wrap; color: var(--text-dim); font-size: 12px">{{ plainBody }}</div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, onMounted } from 'vue'
import { useInstancesStore } from '../stores/instances'
import { useVersionsStore } from '../stores/versions'
import { useJobsStore } from '../stores/jobs'
import { useUiStore } from '../stores/ui'

const instances = useInstancesStore()
const versions = useVersionsStore()
const jobs = useJobsStore()
const ui = useUiStore()

const types = [
  { value: 'mod', label: '模组' },
  { value: 'modpack', label: '整合包' },
  { value: 'resourcepack', label: '资源包' },
  { value: 'shader', label: '光影' },
]

const projectType = ref('mod')
const query = ref('')
const loaderFilter = ref('')
const versionFilter = ref('')
const sortIndex = ref('relevance')
const results = ref([])
const totalHits = ref(0)
const loading = ref(false)
const limit = 20

const targetInstanceId = ref('')
const detail = ref(null)
const detailVersions = ref([])
const versionsLoading = ref(false)
const installing = ref(false)
const modpackName = ref('')
const modpackIsolated = ref(true)

const currentInstance = computed(() => instances.list.find((i) => i.id === targetInstanceId.value) || instances.selected || null)

const plainBody = computed(() =>
  (detail.value && detail.value.body ? detail.value.body : '')
    .replace(/!\[[^\]]*\]\([^)]*\)/g, '')
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/^#{1,6} /gm, '')
    .trim()
)

const versionFiltersText = computed(() => {
  const parts = []
  const inst = currentInstance.value
  const mc = inst ? mcOfInstance(inst) : ''
  const loader = inst ? loaderOfInstance(inst) : ''
  if (projectType.value !== 'modpack') {
    if (mc) parts.push(`Minecraft ${mc}`)
    if (loader && loader !== 'vanilla') parts.push(loader)
  }
  return parts.length ? `（筛选：${parts.join(' · ')}）` : '（全部）'
})

function mcOfInstance(inst) {
  const m = /(\d+\.\d+(?:\.\d+)?)$/.exec(inst.versionId || '')
  return m ? m[1] : ''
}

function loaderOfInstance(inst) {
  return inst.loader || 'vanilla'
}

function fmtNum(n) {
  if (n >= 1000000) return (n / 1000000).toFixed(1) + 'M'
  if (n >= 1000) return (n / 1000).toFixed(1) + 'k'
  return String(n || 0)
}

function fmtDate(iso) {
  return iso ? String(iso).slice(0, 10) : ''
}

function setType(t) {
  projectType.value = t
  results.value = []
  totalHits.value = 0
  doSearch(true)
}

async function doSearch(reset = false) {
  loading.value = true
  try {
    const payload = {
      query: query.value.trim(),
      projectType: projectType.value,
      index: sortIndex.value,
      limit,
      offset: reset ? 0 : results.value.length,
    }
    if (loaderFilter.value) payload.loaders = [loaderFilter.value]
    if (versionFilter.value.trim()) payload.gameVersions = [versionFilter.value.trim()]
    const r = await window.api.resources.search(payload)
    results.value = reset ? r.hits : [...results.value, ...r.hits]
    totalHits.value = r.totalHits
  } catch (err) {
    ui.error(`搜索失败：${err.message}`)
  } finally {
    loading.value = false
  }
}

function loadMore() {
  doSearch(false)
}

async function openDetail(hit) {
  try {
    detail.value = await window.api.resources.project(hit.id)
    modpackName.value = hit.title
    await loadVersions()
  } catch (err) {
    ui.error(err.message)
  }
}

async function loadVersions() {
  if (!detail.value) return
  versionsLoading.value = true
  try {
    const filters = {}
    const inst = currentInstance.value
    if (projectType.value !== 'modpack' && inst) {
      const mc = mcOfInstance(inst)
      const loader = loaderOfInstance(inst)
      if (mc) filters.gameVersions = [mc]
      if (loader && loader !== 'vanilla') filters.loaders = [loader]
      else if (projectType.value === 'mod') filters.loaders = ['fabric', 'quilt', 'forge', 'neoforge', 'liteloader', 'rift']
    }
    detailVersions.value = await window.api.resources.versions(detail.value.id, filters)
  } catch (err) {
    ui.error(err.message)
    detailVersions.value = []
  } finally {
    versionsLoading.value = false
  }
}

async function installVersion(v) {
  if (!v.files || !v.files.length) return ui.error('该版本没有文件')
  installing.value = true
  try {
    if (projectType.value === 'modpack') {
      await window.api.resources.installModpack({
        versionId: v.id,
        instanceName: modpackName.value.trim() || detail.value.title,
        isolated: modpackIsolated.value,
      })
      ui.info('整合包开始安装（右下角查看进度），完成后将出现在「启动」页实例列表')
      detail.value = null
    } else {
      const inst = currentInstance.value
      if (!inst) {
        ui.error('请先在「启动」页创建实例')
        return
      }
      await window.api.resources.installFile({
        versionId: v.id,
        projectType: projectType.value,
        instanceId: inst.id,
      })
      ui.success(`已开始下载到实例「${inst.name}」`)
      detail.value = null
    }
  } catch (err) {
    ui.error(err.message)
  } finally {
    installing.value = false
  }
}

// 目标实例默认选中
watch(
  () => instances.selectedId,
  (id) => {
    if (id) targetInstanceId.value = id
  },
  { immediate: true }
)

// 切换目标实例 / 加载器筛选时重新搜索
watch([targetInstanceId], () => {
  if (detail.value) loadVersions()
})

onMounted(async () => {
  await instances.load()
  if (!targetInstanceId.value && instances.selectedId) targetInstanceId.value = instances.selectedId
  await versions.ensureLoaded()
  doSearch(true)
})
</script>
