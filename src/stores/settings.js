import { defineStore } from 'pinia'

export const useSettingsStore = defineStore('settings', {
  state: () => ({
    data: null,
    loading: false,
  }),
  actions: {
    async load() {
      this.loading = true
      try {
        this.data = await window.api.settings.get()
      } finally {
        this.loading = false
      }
      return this.data
    },
    async update(patch) {
      this.data = await window.api.settings.update(patch)
      return this.data
    },
    async reset() {
      this.data = await window.api.settings.reset()
      return this.data
    },
  },
})
