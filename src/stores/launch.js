import { defineStore } from 'pinia'

const MAX_LINES = 2000

export const useLaunchStore = defineStore('launch', {
  state: () => ({
    logs: [],
    state: 'idle', // idle | starting | running | exited | error
    instanceId: null,
    exitCode: null,
    initialized: false,
  }),
  getters: {
    running: (state) => state.state === 'starting' || state.state === 'running',
  },
  actions: {
    init() {
      if (this.initialized) return
      this.initialized = true
      window.api.on.launchLog((entry) => {
        this.logs.push(entry)
        if (this.logs.length > MAX_LINES) this.logs.splice(0, this.logs.length - MAX_LINES)
      })
      window.api.on.launchState((st) => {
        this.state = st.state === 'starting' ? 'starting' : st.state
        this.instanceId = st.instanceId
        if (st.state === 'exited') this.exitCode = st.code
      })
      window.api.launch
        .status()
        .then((s) => {
          if (s.running) {
            this.state = 'running'
            this.instanceId = s.info && s.info.instanceId
          }
        })
        .catch(() => {})
    },
    clearLogs() {
      this.logs = []
    },
    async start(instanceId) {
      const res = await window.api.launch.start(instanceId)
      this.state = 'starting'
      this.exitCode = null
      return res
    },
    async stop() {
      await window.api.launch.stop()
    },
  },
})
