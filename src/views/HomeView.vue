<template>
  <div class="page">
    <div class="page-head">
      <h2>启动游戏</h2>
      <span class="sub">选择实例与账户，一键启动</span>
      <div class="actions">
        <button class="btn btn-sm" @click="openCreateModal" :disabled="!versions.installed.length">＋ 新建实例</button>
      </div>
    </div>

    <!-- 无版本时的引导 -->
    <div v-if="!versions.installed.length" class="card empty-state">
      <div class="big">📦</div>
      <div>还没有安装任何游戏版本</div>
      <button class="btn btn-primary" style="margin-top: 12px" @click="$router.push('/versions')">去下载版本</button>
    </div>

    <template v-else>
      <div class="hero">
        <!-- 左：实例 -->
        <div class="card panel">
          <div class="row" style="margin-bottom: 12px">
            <select class="select" style="flex: 1" :value="instances.selectedId" @change="instances.select($event.target.value)">
              <option v-for="inst in instances.list" :key="inst.id" :value="inst.id">{{ inst.name }}</option>
            </select>
            <button class="btn btn-sm" title="编辑实例" @click="openEditModal">编辑</button>
            <button class="btn btn-sm" title="打开游戏目录" @click="openGameDir">📂</button>
          </div>

          <template v-if="instances.selected">
            <div class="kv">
              <span class="k">游戏版本</span>
              <span class="v">
                <span class="badge" :class="loaderBadge(instances.selected)">{{ loaderText(instances.selected) }}</span>
                {{ instances.selected.versionId }}
              </span>
            </div>
            <div class="kv">
              <span class="k">游戏目录</span>
              <span class="v mono" :title="gameDir">{{ gameDir }}</span>
            </div>
            <div class="kv">
              <span class="k">存档隔离</span>
              <span class="v">{{ instances.selected.isolated === false ? '关闭（共享 .minecraft）' : '开启（独立目录）' }}</span>
            </div>
          </template>

          <div class="divider"></div>

          <!-- 账户 -->
          <div class="row">
            <template v-if="accounts.current">
              <span class="badge" :class="accounts.current.type === 'msa' ? 'badge-info' : 'badge-old'">
                {{ accounts.current.type === 'msa' ? '正版' : '离线' }}
              </span>
              <b>{{ accounts.current.name }}</b>
              <span class="spacer"></span>
              <button class="btn btn-ghost btn-sm" @click="$router.push('/accounts')">切换</button>
            </template>
            <template v-else>
              <span class="badge badge-danger">未登录</span>
              <span class="muted">启动前需要添加账户</span>
              <span class="spacer"></span>
              <button class="btn btn-sm" @click="$router.push('/accounts')">去添加</button>
            </template>
          </div>
        </div>

        <!-- 右：启动按钮 + 状态 -->
        <div class="card panel" style="max-width: 380px; display: flex; flex-direction: column; gap: 14px">
          <div style="flex: 1; display: flex; flex-direction: column; justify-content: center; gap: 8px">
            <div class="muted" style="text-align: center">{{ statusText }}</div>
            <button v-if="!launch.running" class="play-btn" :disabled="!canPlay" @click="play">
              ▶ 启动游戏
            </button>
            <button v-else class="play-btn stop" @click="stopGame">■ 停止游戏</button>
            <div v-if="launchJob" class="job-meta" style="text-align: center; color: var(--muted); font-size: 12.5px">
              {{ launchJob.message || launchJob.progress.label || '准备中...' }}
              <div class="progress" style="margin-top: 7px" :class="{ indeterminate: !launchJob.progress.total }">
                <div class="bar" :style="{ width: pct(launchJob) + '%' }"></div>
              </div>
            </div>
          </div>
          <div class="row muted" style="justify-content: center; gap: 18px; font-size: 12.5px">
            <span>内存 {{ memoryText }}</span>
            <span>Java {{ javaText }}</span>
          </div>
        </div>
      </div>

      <!-- 日志控制台 -->
      <div class="card" style="margin-top: 14px; padding-bottom: 12px">
        <div class="row" style="margin-bottom: 10px">
          <h3 style="margin: 0">游戏日志</h3>
          <span class="muted" style="font-size: 12px">{{ launch.logs.length }} 行</span>
          <span class="spacer"></span>
          <button class="btn btn-ghost btn-sm" @click="launch.clearLogs()">清空</button>
        </div>
        <div ref="consoleRef" class="console">
          <div v-if="!launch.logs.length" class="muted">暂无日志，启动游戏后将在这里显示输出……</div>
          <div v-for="(line, i) in launch.logs" :key="i" class="line" :class="line.stream">
            <span class="muted">{{ fmtTime(line.ts) }}</span> {{ line.line }}
          </div>
        </div>
      </div>
    </template>

    <!-- 新建实例 -->
    <div v-if="createModal" class="modal-mask" @click.self="createModal = false">
      <div class="modal">
        <h3>新建实例</h3>
        <div class="field">
          <label>实例名称</label>
          <input class="input" v-model="form.name" placeholder="例如：生存存档" maxlength="40" />
        </div>
        <div class="field">
          <label>游戏版本</label>
          <select class="select" v-model="form.versionId">
            <option v-for="v in versions.installed" :key="v.id" :value="v.id">
              {{ v.id }}（{{ typeText(v.type) }}）
            </option>
          </select>
        </div>
        <label class="checkbox-line" style="margin-bottom: 8px">
          <input type="checkbox" v-model="form.isolated" />
          版本隔离（独立的存档 / 配置 / 模组目录）
        </label>
        <div class="modal-actions">
          <button class="btn" @click="createModal = false">取消</button>
          <button class="btn btn-primary" :disabled="!form.name.trim() || !form.versionId" @click="createInstance">创建</button>
        </div>
      </div>
    </div>

    <!-- 编辑实例 -->
    <div v-if="editModal && instances.selected" class="modal-mask" @click.self="editModal = false">
      <div class="modal">
        <h3>编辑实例 · {{ instances.selected.name }}</h3>
        <div class="field">
          <label>名称</label>
          <input class="input" v-model="editForm.name" maxlength="40" />
        </div>
        <div class="field">
          <label>游戏版本</label>
          <select class="select" v-model="editForm.versionId">
            <option v-for="v in versions.installed" :key="v.id" :value="v.id">{{ v.id }}</option>
          </select>
        </div>
        <div class="field">
          <label>版本隔离</label>
          <label class="checkbox-line">
            <input type="checkbox" v-model="editForm.isolated" />
            为该实例使用独立游戏目录
          </label>
        </div>
        <div class="field">
          <label>Java 路径（留空 = 自动选择）</label>
          <div class="row">
            <input class="input" style="flex: 1" v-model="editForm.javaPath" placeholder="自动" />
            <button class="btn" @click="pickJava('javaPath')">浏览…</button>
          </div>
        </div>
        <div class="field">
          <label>内存 MB（留空 = 跟随全局）</label>
          <div class="row">
            <input class="input num" type="number" v-model="editForm.memMin" placeholder="最小" min="512" step="256" />
            <span class="muted">—</span>
            <input class="input num" type="number" v-model="editForm.memMax" placeholder="最大" min="1024" step="256" />
          </div>
        </div>
        <div class="field">
          <label>额外 JVM 参数（留空 = 跟随全局）</label>
          <input class="input" v-model="editForm.jvmArgs" placeholder="-XX:+UseG1GC ..." />
        </div>
        <div class="modal-actions">
          <button class="btn btn-danger" style="margin-right: auto" @click="removeInstance">删除实例</button>
          <button class="btn" @click="editModal = false">取消</button>
          <button class="btn btn-primary" @click="saveInstance">保存</button>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { ref, computed, watch, nextTick, onMounted, reactive } from 'vue'
import { useRouter } from 'vue-router'
import { useInstancesStore } from '../stores/instances'
import { useVersionsStore } from '../stores/versions'
import { useAccountsStore } from '../stores/accounts'
import { useLaunchStore } from '../stores/launch'
import { useJobsStore, jobPercent } from '../stores/jobs'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'

const router = useRouter()
const instances = useInstancesStore()
const versions = useVersionsStore()
const accounts = useAccountsStore()
const launch = useLaunchStore()
const jobs = useJobsStore()
const settings = useSettingsStore()
const ui = useUiStore()

const consoleRef = ref(null)
const createModal = ref(false)
const editModal = ref(false)
const gameDir = ref('')

const form = reactive({ name: '', versionId: '', isolated: true })
const editForm = reactive({ name: '', versionId: '', isolated: true, javaPath: '', memMin: '', memMax: '', jvmArgs: '' })

const canPlay = computed(() => !!(instances.selected && accounts.current) && !jobs.active.some((j) => j.kind === 'launch'))
const launchJob = computed(() => jobs.launchJob)

const statusText = computed(() => {
  if (launch.state === 'starting') return '正在启动...'
  if (launch.state === 'running') return '游戏运行中'
  if (launch.state === 'exited') return `游戏已退出（代码 ${launch.exitCode}）`
  if (launch.state === 'error') return '启动出错'
  if (!accounts.current) return '请先添加账户'
  if (!instances.selected) return '请选择实例'
  return '准备就绪'
})

const memoryText = computed(() => {
  const inst = instances.selected
  const mem = (inst && inst.memory) || (settings.data && settings.data.memory) || {}
  return `${mem.min || 1024}-${mem.max || 4096} MB`
})

const javaText = computed(() => {
  const inst = instances.selected
  if (inst && inst.javaPath) return '（实例自定义）'
  return '自动'
})

function pct(job) {
  return jobPercent(job)
}

function typeText(t) {
  return { release: '正式版', snapshot: '快照', old_beta: '旧 Beta', old_alpha: '旧 Alpha' }[t] || t
}

function loaderText(inst) {
  const l = inst.loader
  if (!l || l === 'vanilla') return '原版'
  return { fabric: 'Fabric', quilt: 'Quilt', forge: 'Forge', neoforge: 'NeoForge' }[l] || l
}

function loaderBadge(inst) {
  const l = inst.loader
  return { fabric: 'badge-fabric', quilt: 'badge-quilt', forge: 'badge-forge', neoforge: 'badge-forge' }[l] || 'badge-release'
}

function fmtTime(ts) {
  if (!ts) return ''
  const d = new Date(ts)
  const p = (n) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

async function refreshGameDir() {
  if (!instances.selected) return
  try {
    const r = await window.api.instances.gameDir(instances.selected.id)
    gameDir.value = r
  } catch {}
}

async function play() {
  if (launch.running) return stopGame()
  if (!instances.selected) return openCreateModal()
  if (!accounts.current) {
    ui.error('请先在「账户」页添加账户')
    return router.push('/accounts')
  }
  try {
    const r = await launch.start(instances.selected.id)
    ui.info(`正在启动「${r.instance}」（${r.account}）`)
  } catch (err) {
    ui.error(err.message)
  }
}

async function stopGame() {
  try {
    await launch.stop()
    ui.info('已发送停止信号')
  } catch (err) {
    ui.error(err.message)
  }
}

async function openGameDir() {
  if (!instances.selected) return
  const dir = await window.api.instances.gameDir(instances.selected.id)
  const err = await window.api.system.openPath(dir)
  if (err) ui.error(err)
}

function openCreateModal() {
  if (!versions.installed.length) return router.push('/versions')
  form.name = ''
  form.versionId = (versions.vanillaInstalled[0] || versions.installed[0]).id
  form.isolated = true
  createModal.value = true
}

async function createInstance() {
  try {
    await instances.create({ name: form.name.trim(), versionId: form.versionId, isolated: form.isolated })
    createModal.value = false
    ui.success('实例已创建')
    await refreshGameDir()
  } catch (err) {
    ui.error(err.message)
  }
}

function openEditModal() {
  const inst = instances.selected
  if (!inst) return
  editForm.name = inst.name
  editForm.versionId = inst.versionId
  editForm.isolated = inst.isolated !== false
  editForm.javaPath = inst.javaPath || ''
  editForm.memMin = (inst.memory && inst.memory.min) || ''
  editForm.memMax = (inst.memory && inst.memory.max) || ''
  editForm.jvmArgs = inst.jvmArgs === undefined || inst.jvmArgs === null ? '' : inst.jvmArgs
  editModal.value = true
}

async function saveInstance() {
  const inst = instances.selected
  if (!inst) return
  const patch = {
    name: editForm.name.trim() || inst.name,
    versionId: editForm.versionId,
    isolated: editForm.isolated,
    javaPath: editForm.javaPath.trim(),
    memory:
      editForm.memMin || editForm.memMax
        ? { min: Number(editForm.memMin) || 512, max: Number(editForm.memMax) || 4096 }
        : null,
    jvmArgs: editForm.jvmArgs.trim() || undefined,
  }
  try {
    await instances.update(inst.id, patch)
    editModal.value = false
    ui.success('实例配置已保存')
    await refreshGameDir()
  } catch (err) {
    ui.error(err.message)
  }
}

async function removeInstance() {
  const inst = instances.selected
  if (!inst) return
  if (!confirm(`删除实例「${inst.name}」？\n（游戏本体不受影响，但该实例的存档/模组会一并删除）`)) return
  try {
    await instances.remove(inst.id)
    editModal.value = false
    ui.success('实例已删除')
  } catch (err) {
    ui.error(err.message)
  }
}

async function pickJava(target) {
  try {
    const info = await window.api.java.pick()
    if (info) editForm[target] = info.path
  } catch (err) {
    ui.error(err.message)
  }
}

// 日志自动滚动到底部
watch(
  () => launch.logs.length,
  async () => {
    await nextTick()
    const el = consoleRef.value
    if (el) el.scrollTop = el.scrollHeight
  }
)

watch(
  () => instances.selectedId,
  () => refreshGameDir()
)

onMounted(async () => {
  if (!instances.list.length) await instances.load()
  await refreshGameDir()
})
</script>
