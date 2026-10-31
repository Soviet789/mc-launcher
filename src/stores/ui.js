import { defineStore } from 'pinia'

let seq = 0

export const useUiStore = defineStore('ui', {
  state: () => ({
    toasts: [],
  }),
  actions: {
    push(message, type = 'info', timeout = 4200) {
      const id = ++seq
      this.toasts.push({ id, message, type })
      if (timeout > 0) {
        setTimeout(() => this.dismiss(id), timeout)
      }
      return id
    },
    success(message) {
      return this.push(message, 'success')
    },
    error(message) {
      return this.push(message, 'error', 7000)
    },
    info(message) {
      return this.push(message, 'info')
    },
    dismiss(id) {
      const i = this.toasts.findIndex((t) => t.id === id)
      if (i >= 0) this.toasts.splice(i, 1)
    },
  },
})
