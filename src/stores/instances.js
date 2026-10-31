import { defineStore } from 'pinia'

const SELECTED_KEY = 'mcl.selectedInstance'

export const useInstancesStore = defineStore('instances', {
  state: () => ({
    list: [],
    selectedId: localStorage.getItem(SELECTED_KEY) || '',
  }),
  getters: {
    selected: (state) => state.list.find((i) => i.id === state.selectedId) || state.list[0] || null,
  },
  actions: {
    async load() {
      this.list = await window.api.instances.list()
      if (this.list.length && !this.list.some((i) => i.id === this.selectedId)) {
        this.select(this.list[0].id)
      }
      return this.list
    },
    select(id) {
      this.selectedId = id
      localStorage.setItem(SELECTED_KEY, id || '')
    },
    async create(opts) {
      const inst = await window.api.instances.create(opts)
      await this.load()
      this.select(inst.id)
      return inst
    },
    async update(id, patch) {
      const inst = await window.api.instances.update(id, patch)
      await this.load()
      return inst
    },
    async remove(id) {
      await window.api.instances.remove(id)
      if (this.selectedId === id) this.selectedId = ''
      await this.load()
    },
  },
})
