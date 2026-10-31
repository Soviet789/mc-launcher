<template>
  <div v-if="visible.length" class="jobbar">
    <div v-for="job in visible" :key="job.id" style="display: contents">
      <div class="job-title">
        <span class="spinner"></span>
        <span>{{ jobLabel(job) }}</span>
        <span class="mono dim" style="margin-left: auto">{{ percent(job) }}%</span>
        <button class="btn btn-ghost btn-sm" title="打开下载管理" @click="openDownloads">详情</button>
        <button class="btn btn-ghost btn-sm" @click="cancel(job.id)">取消</button>
      </div>
      <div class="progress" :class="{ indeterminate: !job.progress.total }">
        <div class="bar" :style="{ width: percent(job) + '%' }"></div>
      </div>
      <div class="job-meta">
        {{ job.message || job.progress.label || phaseName(job.progress.phase) }}
      </div>
    </div>
  </div>
</template>

<script setup>
import { computed } from 'vue'
import { useRouter } from 'vue-router'
import { useJobsStore, jobLabel, jobPercent, jobPhaseName } from '../stores/jobs'

const jobs = useJobsStore()
const router = useRouter()
const visible = computed(() => jobs.active.slice(-3))

function percent(job) {
  return jobPercent(job)
}

function phaseName(phase) {
  return jobPhaseName(phase)
}

function openDownloads() {
  router.push('/downloads')
}

function cancel(id) {
  jobs.cancel(id)
}
</script>
