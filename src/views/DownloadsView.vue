<template>
  <div class="page">
    <div class="page-head">
      <h2>下载管理</h2>
      <span v-if="running.length" class="badge badge-info">进行中 {{ running.length }}</span>
      <div class="actions">
        <button class="btn btn-sm" @click="reload">↻ 刷新</button>
        <button class="btn btn-ghost btn-sm" :disabled="!jobs.history.length" @click="clear">清空历史</button>
      </div>
    </div>

    <!-- ============ 进行中 ============ -->
    <div v-if="running.length" class="list" style="margin-bottom: 20px">
      <div v-for="job in running" :key="job.id" class="list-row" style="display: block">
        <div class="row">
          <span class="spinner"></span>
          <span class="title">
            {{ jobLabel(job) }}
            <span v-if="metaText(job)" class="muted"> · {{ metaText(job) }}</span>
          </span>
          <span class="spacer"></span>
          <span class="mono dim">{{ percent(job) }}%</span>
          <button class="btn btn-ghost btn-sm" @click="jobs.cancel(job.id)">取消</button>
        </div>
        <div class="progress" :class="{ indeterminate: !job.progress.total }" style="margin-top: 8px">
          <div class="bar" :style="{ width: percent(job) + '%' }"></div>
        </div>
        <div class="meta">
          {{ job.message || job.progress.label || phaseName(job.progress.phase) }}
          <template v-if="job.progress.total"> · {{ job.progress.current }}/{{ job.progress.total }}</template>
        </div>
      </div>
    </div>

    <!-- ============ 历史记录 ============ -->
    <div class="row" style="margin: 4px 0 10px">
      <h3 style="margin: 0; font-size: 15px">历史记录</h3>
      <span class="muted" style="font-size: 12.5px">最近 {{ jobs.history.length }} 条（跨重启保留）</span>
    </div>

    <div v-if="!jobs.history.length" class="empty-state">
      <div class="big">📦</div>
      暂无下载记录
      <div class="muted" style="margin-top: 8px; font-size: 12.5px">
        去「版本」页安装版本，或在「资源下载」页获取模组 / 整合包
      </div>
    </div>

    <div v-else class="list">
      <div v-for="job in jobs.history" :key="job.id" class="list-row">
        <div style="flex: 1; min-width: 0">
          <div class="row">
            <span class="badge" :class="statusBadge(job.status)">{{ statusText(job.status) }}</span>
            <span class="title">{{ jobLabel(job) }}</span>
            <span v-if="metaText(job)" class="muted" style="font-size: 12.5px">· {{ metaText(job) }}</span>
          </div>
          <div class="meta">
            {{ fmtTime(job.endedAt || job.createdAt) }}
            <template v-if="duration(job) >= 1000"> · 用时 {{ fmtDur(duration(job)) }}</template>
            <template v-if="job.status === 'done' && job.message"> · {{ job.message }}</template>
          </div>
          <div v-if="job.status === 'error' && job.error" class="meta" style="color: #ff9c9c">
            {{ job.error }}
          </div>
        </div>
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed, onMounted } from 'vue'
import { useJobsStore, jobLabel, jobPercent, jobPhaseName, jobMetaText } from '../stores/jobs'

const jobs = useJobsStore()
const running = computed(() => jobs.downloads)

function percent(job) {
  return jobPercent(job)
}

function phaseName(phase) {
  return jobPhaseName(phase)
}

function metaText(job) {
  return jobMetaText(job)
}

function statusText(status) {
  return status === 'done' ? '已完成' : status === 'error' ? '失败' : '已取消'
}

function statusBadge(status) {
  return status === 'done' ? 'badge-info' : status === 'error' ? 'badge-danger' : 'badge-old'
}

function duration(job) {
  return Math.max(0, (job.endedAt || 0) - (job.createdAt || 0))
}

function fmtTime(t) {
  if (!t) return ''
  const d = new Date(t)
  const p = (n) => String(n).padStart(2, '0')
  return `${d.getMonth() + 1}/${d.getDate()} ${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

function fmtDur(ms) {
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s} 秒`
  return `${Math.floor(s / 60)} 分 ${s % 60} 秒`
}

async function reload() {
  await jobs.loadHistory()
}

function clear() {
  jobs.clearHistory()
}

onMounted(reload)
</script>
