<template>
  <div class="toast-wrap">
    <div v-for="t in ui.toasts" :key="t.id" class="toast" :class="t.type">
      <span>{{ icon(t.type) }}</span>
      <span style="flex: 1">{{ t.message }}</span>
      <span class="close" @click="ui.dismiss(t.id)">×</span>
    </div>
  </div>
</template>

<script setup>
import { useUiStore } from '../stores/ui'

const ui = useUiStore()

function icon(type) {
  return { success: '✓', error: '✕', info: 'ℹ' }[type] || 'ℹ'
}
</script>
