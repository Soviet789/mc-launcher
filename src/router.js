import { createRouter, createWebHashHistory } from 'vue-router'

const router = createRouter({
  history: createWebHashHistory(),
  routes: [
    { path: '/', name: 'home', component: () => import('./views/HomeView.vue'), meta: { title: '启动' } },
    { path: '/versions', name: 'versions', component: () => import('./views/VersionsView.vue'), meta: { title: '版本' } },
    { path: '/resources', name: 'resources', component: () => import('./views/ResourcesView.vue'), meta: { title: '资源下载' } },
    { path: '/downloads', name: 'downloads', component: () => import('./views/DownloadsView.vue'), meta: { title: '下载' } },
    { path: '/accounts', name: 'accounts', component: () => import('./views/AccountsView.vue'), meta: { title: '账户' } },
    { path: '/settings', name: 'settings', component: () => import('./views/SettingsView.vue'), meta: { title: '设置' } },
  ],
})

router.afterEach((to) => {
  document.title = `${to.meta.title || ''} - MC Launcher`
})

export default router
