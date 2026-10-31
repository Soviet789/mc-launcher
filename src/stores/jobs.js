import { defineStore } from 'pinia'
import { useUiStore } from './ui'

export const useJobsStore = defineStore('jobs', {
  state: () => ({
    map: {}, // jobId -> job
    history: [], // 已结束的下载/安装任务（主进程持久化，最新在前）
    initialized: false,
  }),
  getters: {
    active: (state) => Object.values(state.map).filter((j) => j.status === 'running'),
    /** 下载管理页「进行中」：安装/加载器/Java/资源/整合包；启动任务仅补文件阶段算下载 */
    downloads: (state) =>
      Object.values(state.map)
        .filter((j) => j.status === 'running' && (j.kind !== 'launch' || (j.progress && j.progress.phase !== 'running')))
        .sort((a, b) => b.createdAt - a.createdAt),
    installingVersion: (state) => (id) =>
      Object.values(state.map).some((j) => j.status === 'running' && j.meta && j.meta.versionId === id),
    installingLoader: (state) => (type) =>
      Object.values(state.map).some((j) => j.status === 'running' && j.kind === 'loader' && (!type || (j.meta && j.meta.type === type))),
    byKind: (state) => (kind) =>
      Object.values(state.map)
        .filter((j) => j.kind === kind && j.status === 'running')
        .sort((a, b) => b.createdAt - a.createdAt)[0] || null,
    /** 当前与启动相关的任务（补文件/下载 Java 等） */
    launchJob: (state) =>
      Object.values(state.map)
        .filter((j) => j.status === 'running' && ['launch', 'install', 'java'].includes(j.kind))
        .sort((a, b) => b.createdAt - a.createdAt)[0] || null,
  },
  actions: {
    init() {
      if (this.initialized) return
      this.initialized = true
      const ui = useUiStore()
      window.api.on.job((job) => {
        const prev = this.map[job.id]
        this.map = { ...this.map, [job.id]: job }
        // 已结束的下载/安装任务同步进本地历史（与主进程持久化列表按 id 去重）
        if (job.status !== 'running' && job.kind !== 'launch') {
          const snap = {
            id: job.id,
            kind: job.kind,
            meta: job.meta || null,
            status: job.status,
            message: job.message || '',
            error: job.error || null,
            progress: job.progress ? { ...job.progress } : null,
            createdAt: job.createdAt,
            endedAt: Date.now(),
          }
          this.history = [snap, ...this.history.filter((h) => h.id !== job.id)]
        }
        if (job.status === 'error' && !(prev && prev._notified)) {
          this.map[job.id] = { ...job, _notified: true }
          ui.error(`${jobLabel(job)}失败：${job.error || '未知错误'}`)
        } else if (job.status === 'done' && prev && prev.status === 'running' && job.kind !== 'launch' && job.message) {
          ui.success(job.message)
        }
      })
      window.api.jobs.list().then((list) => {
        for (const job of list) this.map = { ...this.map, [job.id]: job }
      }).catch(() => {})
      this.loadHistory()
    },
    async loadHistory() {
      try {
        this.history = (await window.api.jobs.history()) || []
      } catch {}
    },
    async clearHistory() {
      this.history = []
      try {
        await window.api.jobs.clearHistory()
      } catch {}
    },
    async cancel(id) {
      await window.api.jobs.cancel(id)
    },
  },
})

export function jobLabel(job) {
  const map = {
    install: '安装',
    loader: '加载器安装',
    java: 'Java 下载',
    launch: '启动',
    resource: '资源下载',
    modpack: '整合包安装',
  }
  return map[job.kind] || '任务'
}

export function jobPercent(job) {
  const p = job && job.progress
  if (!p || !p.total) return 0
  return Math.min(100, Math.round((p.current / p.total) * 100))
}

export function jobPhaseName(phase) {
  const map = {
    version: '获取版本信息',
    client: '下载客户端',
    libraries: '下载依赖库',
    assets: '下载游戏资源',
    logging: '日志配置',
    files: '校验游戏文件',
    java: '准备 Java',
    natives: '解压原生库',
    running: '游戏运行中',
    download: '下载文件',
    'download-pack': '下载整合包',
    minecraft: '安装 Minecraft',
    loader: '安装加载器',
  }
  return map[phase] || '处理中'
}

/** 任务的对象描述：版本号 / Java 大版本 / 资源等（用于下载页副标题） */
export function jobMetaText(job) {
  const m = job && job.meta
  if (!m) return ''
  if (job.kind === 'java') return `Java ${m.major || ''}`
  return String(m.versionId || m.projectId || m.name || m.id || '')
}
