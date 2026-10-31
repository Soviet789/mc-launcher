<template>
  <div class="layout">
    <SideNav />
    <main class="main">
      <router-view />
    </main>
    <ToastHost />
    <JobBar />
  </div>
</template>

<script setup>
import { onMounted } from 'vue'
import SideNav from './components/SideNav.vue'
import ToastHost from './components/ToastHost.vue'
import JobBar from './components/JobBar.vue'
import { useUiStore } from './stores/ui'
import { useSettingsStore } from './stores/settings'
import { useJobsStore } from './stores/jobs'
import { useLaunchStore } from './stores/launch'
import { useAccountsStore } from './stores/accounts'
import { useInstancesStore } from './stores/instances'
import { useVersionsStore } from './stores/versions'

const ui = useUiStore()
const settings = useSettingsStore()
const jobs = useJobsStore()
const launch = useLaunchStore()
const accounts = useAccountsStore()
const instances = useInstancesStore()
const versions = useVersionsStore()

onMounted(async () => {
  console.log('[MCL] renderer ready')
  jobs.init()
  launch.init()
  const results = await Promise.allSettled([
    settings.load(),
    accounts.load(),
    instances.load(),
    versions.ensureLoaded(),
  ])
  for (const r of results) {
    if (r.status === 'rejected') {
      ui.error(String((r.reason && r.reason.message) || r.reason))
    }
  }
  // 启动时自动创建默认实例（安装了版本但还没有实例时）
  if (!instances.list.length && versions.installed.length) {
    try {
      await window.api.instances.ensureDefault()
      await instances.load()
    } catch {}
  }
})
</script>
