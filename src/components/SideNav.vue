<template>
  <aside class="sidebar">
    <div class="brand">
      <div class="logo">⛏️</div>
      <span>MC Launcher</span>
    </div>

    <router-link v-for="item in items" :key="item.path" :to="item.path" custom v-slot="{ navigate, isActive }">
      <div class="nav-item" :class="{ active: isActive }" @click="navigate">
        <svg v-html="item.icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9"
          stroke-linecap="round" stroke-linejoin="round"></svg>
        <span>{{ item.title }}</span>
        <span v-if="item.path === '/downloads' && activeCount" class="badge badge-info" style="margin-left: auto">
          {{ activeCount }}
        </span>
      </div>
    </router-link>

    <div class="sidebar-footer">
      <div v-if="account" class="row" style="gap: 7px">
        <span class="badge" :class="account.type === 'msa' ? 'badge-info' : 'badge-old'">
          {{ account.type === 'msa' ? '正版' : '离线' }}
        </span>
        <span style="color: var(--text-dim)">{{ account.name }}</span>
      </div>
      <div v-else>未登录账户</div>
      <div>v{{ appVersion }}</div>
    </div>
  </aside>
</template>

<script setup>
import { computed, ref, onMounted } from 'vue'
import { useAccountsStore } from '../stores/accounts'
import { useJobsStore } from '../stores/jobs'

const accounts = useAccountsStore()
const jobsStore = useJobsStore()
const account = computed(() => accounts.current)
const activeCount = computed(() => jobsStore.downloads.length)
const appVersion = ref('')

const items = [
  {
    path: '/',
    title: '启动',
    icon: '<polygon points="6 4 20 12 6 20 6 4"/>',
  },
  {
    path: '/versions',
    title: '版本',
    icon: '<rect x="3" y="4" width="18" height="14" rx="2"/><path d="M8 21h8"/><path d="M12 18v3"/>',
  },
  {
    path: '/resources',
    title: '资源下载',
    icon: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M4 21h16"/>',
  },
  {
    path: '/downloads',
    title: '下载',
    icon: '<path d="M4 14v4a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-4"/><path d="M12 3v9"/><path d="m8.5 8.5 3.5 3.5 3.5-3.5"/>',
  },
  {
    path: '/accounts',
    title: '账户',
    icon: '<circle cx="12" cy="8" r="4"/><path d="M4 21c0-4 3.6-7 8-7s8 3 8 7"/>',
  },
  {
    path: '/settings',
    title: '设置',
    icon: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 1 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 1 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33h.09a1.65 1.65 0 0 0 1-1.51V3a2 2 0 1 1 4 0v.09a1.65 1.65 0 0 0 1 1.51h.09a1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82v.09a1.65 1.65 0 0 0 1.51 1H21a2 2 0 1 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  },
]

onMounted(async () => {
  try {
    const info = await window.api.system.info()
    appVersion.value = info.version
  } catch {}
})
</script>
