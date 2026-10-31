import { defineStore } from 'pinia'

export const useAccountsStore = defineStore('accounts', {
  state: () => ({
    list: [],
    currentId: null,
    loading: false,
    loggingIn: false,
  }),
  getters: {
    current: (state) => state.list.find((a) => a.id === state.currentId) || null,
  },
  actions: {
    async load() {
      const [list, cur] = await Promise.all([window.api.accounts.list(), window.api.accounts.current()])
      this.list = list
      this.currentId = cur ? cur.id : null
      return list
    },
    async addOffline(name) {
      const acc = await window.api.accounts.addOffline(name)
      await this.load()
      return acc
    },
    async loginMicrosoft() {
      this.loggingIn = true
      try {
        const acc = await window.api.accounts.msLogin()
        await this.load()
        return acc
      } finally {
        this.loggingIn = false
      }
    },
    async setCurrent(id) {
      await window.api.accounts.setCurrent(id)
      this.currentId = id
    },
    async remove(id) {
      await window.api.accounts.remove(id)
      await this.load()
    },
  },
})
