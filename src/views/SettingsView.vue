<template>
  <div class="page">
    <div class="page-head">
      <h2>设置</h2>
      <span class="sub">下载、运行与账户配置</span>
      <div class="actions">
        <button class="btn btn-sm btn-danger" @click="resetAll">恢复默认</button>
      </div>
    </div>

    <div v-if="!settings.data" class="empty-state">加载中…</div>

    <template v-else>
      <!-- ===== 下载 ===== -->
      <div class="card">
        <h3>下载</h3>
        <div class="field">
          <label>下载源</label>
          <div class="row" style="gap: 18px">
            <label class="checkbox-line">
              <input type="radio" name="src" value="official" :checked="settings.data.downloadSource === 'official'"
                @change="saveSource('official')" />
              官方源（Mojang）
            </label>
            <label class="checkbox-line">
              <input type="radio" name="src" value="bmcl" :checked="settings.data.downloadSource === 'bmcl'"
                @change="saveSource('bmcl')" />
              BMCLAPI 镜像（国内加速）
            </label>
          </div>
          <div class="hint">镜像覆盖版本列表 / 客户端 / 依赖库下载；资源文件（assets）始终使用官方源。</div>
        </div>
        <div class="field">
          <label>下载并发数</label>
          <select class="select" style="width: 140px" :value="settings.data.concurrency"
            @change="save({ concurrency: Number($event.target.value) })">
            <option :value="8">8</option>
            <option :value="16">16</option>
            <option :value="24">24</option>
            <option :value="32">32</option>
          </select>
        </div>
      </div>

      <!-- ===== 运行 ===== -->
      <div class="card">
        <h3>运行内存（全局默认，实例可单独覆盖）</h3>
        <div class="row" style="gap: 12px; margin-bottom: 6px">
          <input class="input num" type="number" min="512" step="256" :value="settings.data.memory.min"
            @change="saveMemory('min', $event.target.value)" />
          <span class="muted">最小 (MB) —</span>
          <input class="input num" type="number" min="1024" step="256" :value="settings.data.memory.max"
            @change="saveMemory('max', $event.target.value)" />
          <span class="muted">最大 (MB)</span>
        </div>
        <div class="hint">建议最大值不超过物理内存的 50%。1.17+ 推荐 ≥ 4096，1.12- 推荐 2048-4096。</div>

        <div class="field" style="margin-top: 18px">
          <label>额外 JVM 参数（全局默认）</label>
          <textarea class="textarea" rows="2" :value="settings.data.jvmArgs" placeholder="-XX:+UseG1GC -XX:+UnlockExperimentalVMOptions"
            @change="save({ jvmArgs: $event.target.value })"></textarea>
        </div>

        <div class="field">
          <label>游戏窗口分辨率</label>
          <label class="checkbox-line" style="margin-bottom: 8px">
            <input type="checkbox" :checked="settings.data.resolution.custom"
              @change="saveResolution('custom', $event.target.checked)" />
            自定义窗口大小（不勾选则使用版本默认值）
          </label>
          <div class="row" style="gap: 10px; opacity: 0.9">
            <input class="input num" type="number" :disabled="!settings.data.resolution.custom"
              :value="settings.data.resolution.width" @change="saveResolution('width', $event.target.value)" />
            <span class="muted">×</span>
            <input class="input num" type="number" :disabled="!settings.data.resolution.custom"
              :value="settings.data.resolution.height" @change="saveResolution('height', $event.target.value)" />
          </div>
        </div>
      </div>

      <!-- ===== Java ===== -->
      <div class="card">
        <div class="row" style="margin-bottom: 14px">
          <h3 style="margin: 0">Java 环境</h3>
          <span class="spacer"></span>
          <button class="btn btn-sm" @click="detectJava" :disabled="javaLoading">
            {{ javaLoading ? '检测中…' : '↻ 重新检测' }}
          </button>
        </div>

        <div class="field">
          <label>全局 Java（启动时若版本要求的 Java 不在列表中，会自动下载）</label>
          <select class="select" :value="settings.data.javaPath" @change="save({ javaPath: $event.target.value })">
            <option value="">自动（按版本要求选择）</option>
            <option v-for="j in javaList" :key="j.path" :value="j.path">
              Java {{ j.major }} · {{ j.version }} · {{ shortPath(j.path) }}
            </option>
            <option v-if="settings.data.javaPath && !javaList.some(j => j.path === settings.data.javaPath)"
              :value="settings.data.javaPath">
              {{ settings.data.javaPath }}
            </option>
          </select>
          <div class="hint">
            <a @click="pickJava">手动选择 java 可执行文件…</a>
            <template v-if="javaList.length">　已检测到 {{ javaList.length }} 个 Java</template>
          </div>
        </div>
      </div>

      <!-- ===== 微软登录 ===== -->
      <div class="card">
        <h3>微软登录</h3>
        <div class="field">
          <label>Azure 应用 Client ID</label>
          <div class="row">
            <input class="input" style="flex: 1; font-family: var(--mono)" :value="settings.data.microsoft.clientId"
              placeholder="xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx" @change="saveClientId($event.target.value)" />
          </div>
          <div class="hint">
            微软登录需要一个自己注册的 Azure 应用（免费、约 2 分钟）。步骤见 README
            「配置微软登录」；重定向 URI 需包含 <span class="mono">http://localhost</span>。
            离线登录不需要此项。
          </div>
        </div>
      </div>

      <!-- ===== 目录 ===== -->
      <div class="card">
        <h3>目录</h3>
        <div class="kv">
          <span class="k">基础游戏目录（版本/依赖库/资源）</span>
          <span class="v">
            <span class="mono">{{ sys.gameDir || '…' }}</span>
            <button class="btn btn-ghost btn-sm" @click="openPath(sys.gameDir)">打开</button>
          </span>
        </div>
        <div class="kv">
          <span class="k">实例目录（版本隔离的存档等）</span>
          <span class="v">
            <span class="mono">{{ sys.userData ? sys.userData + '/instances' : '…' }}</span>
            <button class="btn btn-ghost btn-sm" @click="openPath(sys.userData ? sys.userData + '/instances' : '')">打开</button>
          </span>
        </div>
        <div class="kv">
          <span class="k">启动器日志目录</span>
          <span class="v">
            <span class="mono">{{ sys.userData ? sys.userData + '/logs' : '…' }}</span>
            <button class="btn btn-ghost btn-sm" @click="openPath(sys.userData ? sys.userData + '/logs' : '')">打开</button>
          </span>
        </div>
      </div>

      <!-- ===== 关于 ===== -->
      <div class="card">
        <h3>关于</h3>
        <div class="kv">
          <span class="k">版本</span>
          <span class="v">{{ sys.version || '—' }}</span>
        </div>
        <div class="kv">
          <span class="k">平台</span>
          <span class="v">{{ sys.platform }} / {{ sys.arch }}</span>
        </div>
        <div class="hint" style="margin-top: 10px">
          开源 Minecraft 启动器，支持 Windows 与 Ubuntu。游戏归 Mojang/Microsoft 所有，本工具与 Mojang 无关。
        </div>
      </div>
    </template>
  </div>
</template>

<script setup>
import { ref, onMounted } from 'vue'
import { useSettingsStore } from '../stores/settings'
import { useUiStore } from '../stores/ui'

const settings = useSettingsStore()
const ui = useUiStore()

const javaList = ref([])
const javaLoading = ref(false)
const sys = ref({})

async function save(patch, silent = false) {
  try {
    await settings.update(patch)
    if (!silent) ui.success('已保存')
  } catch (err) {
    ui.error(err.message)
  }
}

function saveSource(v) {
  save({ downloadSource: v }, true)
  ui.success(v === 'bmcl' ? '已切换到 BMCLAPI 镜像' : '已切换到官方源')
}

function saveMemory(field, raw) {
  const n = Math.max(field === 'min' ? 512 : 1024, Number(raw) || 0)
  const mem = { ...settings.data.memory, [field]: n }
  if (mem.min > mem.max) mem[field === 'min' ? 'max' : 'min'] = n
  save({ memory: mem })
}

function saveResolution(field, raw) {
  const res = { ...settings.data.resolution }
  if (field === 'custom') res.custom = !!raw
  else res[field] = Math.max(320, Number(raw) || 0)
  save({ resolution: res }, true)
  ui.success('已保存')
}

function saveClientId(v) {
  save({ microsoft: { clientId: v.trim() } }, true)
  ui.success('Client ID 已保存')
}

async function detectJava() {
  javaLoading.value = true
  try {
    javaList.value = await window.api.java.list()
    if (!javaList.value.length) ui.info('未检测到本机 Java，游戏启动时将自动下载')
  } catch (err) {
    ui.error(err.message)
  } finally {
    javaLoading.value = false
  }
}

async function pickJava() {
  try {
    const info = await window.api.java.pick()
    if (!info) return
    if (!javaList.value.some((j) => j.path === info.path)) javaList.value.unshift(info)
    await save({ javaPath: info.path }, true)
    ui.success(`已选择 Java ${info.version}`)
  } catch (err) {
    ui.error(err.message)
  }
}

function shortPath(p) {
  if (!p) return ''
  const parts = p.split(/[\\/]/)
  return parts.slice(-3).join('/')
}

async function openPath(p) {
  if (!p) return
  const err = await window.api.system.openPath(p)
  if (err) ui.error(err)
}

async function resetAll() {
  if (!confirm('恢复所有默认设置？（不会删除已安装版本与账户）')) return
  await settings.reset()
  ui.success('已恢复默认设置')
}

onMounted(async () => {
  await Promise.allSettled([settings.load(), detectJava(), (async () => { sys.value = await window.api.system.info() })()])
})
</script>
