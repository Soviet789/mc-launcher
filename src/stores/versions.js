import { defineStore } from 'pinia'

export const useVersionsStore = defineStore('versions', {
  state: () => ({
    remote: [],
    installed: [],
    remoteLoading: false,
    loadedRemoteAt: 0,
  }),
  getters: {
    installedIds: (state) => new Set(state.installed.map((v) => v.id)),
    installedById: (state) => Object.fromEntries(state.installed.map((v) => [v.id, v])),
    vanillaInstalled: (state) => state.installed.filter((v) => !/fabric-loader|quilt-loader|forge|neoforge/i.test(v.id)),
  },
  actions: {
    async loadInstalled() {
      this.installed = await window.api.versions.installed()
      return this.installed
    },
    async loadRemote({ refresh = false } = {}) {
      this.remoteLoading = true
      try {
        this.remote = await window.api.versions.remote({ refresh })
        this.loadedRemoteAt = Date.now()
      } finally {
        this.remoteLoading = false
      }
      return this.remote
    },
    async ensureLoaded() {
      if (!this.remote.length) await this.loadRemote()
      if (!this.installed.length) await this.loadInstalled()
    },
    async install(id) {
      return window.api.versions.install(id)
    },
    async remove(id) {
      const res = await window.api.versions.delete(id)
      await this.loadInstalled()
      return res
    },
  },
})
