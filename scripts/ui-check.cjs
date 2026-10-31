/**
 * 界面自检截图：以 Electron 运行完整应用（含 IPC），渲染后截取窗口图像
 * 用法：npx electron scripts/ui-check.cjs
 * 输出：/tmp/mcl-ui.png（启动页）、/tmp/mcl-ui-versions.png（版本页）、/tmp/mcl-ui-downloads.png（下载页），
 * 并打印渲染层 console 消息
 */
const path = require('path')
const fs = require('fs')
const { app, BrowserWindow } = require('electron')

const root = path.dirname(__dirname)

// 脚本入口下 app 名会回退为 "Electron"（userData 落 ~/.config/Electron）——
// 固定为产品名，使自检与真实应用使用同一份配置目录
app.setName('MC Launcher')

// 注册真实 IPC 处理器 + 事件转发
const ipc = require(path.join(root, 'electron/ipc.js'))
const jobs = require(path.join(root, 'electron/core/jobs.js'))
const launchCore = require(path.join(root, 'electron/core/launch.js'))

ipc.register()
jobs.setSender((ch, payload) => console.log(`[ipc:${ch}]`, JSON.stringify(payload).slice(0, 160)))
launchCore.setEventSink((ch, payload) => console.log(`[ipc:${ch}]`, JSON.stringify(payload).slice(0, 160)))

app.whenReady().then(async () => {
  const win = new BrowserWindow({
    width: 1220,
    height: 780,
    show: false,
    backgroundColor: '#101218',
    webPreferences: {
      preload: path.join(root, 'electron/preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
    },
  })

  win.webContents.on('console-message', (...args) => {
    const evt = args[0]
    const message = (evt && evt.message) || args[2] || args[1]
    console.log('[renderer]', String(message).slice(0, 400))
  })
  win.webContents.on('did-fail-load', (_e, code, desc) => {
    console.error('[load-fail]', code, desc)
  })

  await win.loadFile(path.join(root, 'dist/index.html'))
  await new Promise((r) => setTimeout(r, 7000)) // 等待数据加载与渲染

  const img = await win.webContents.capturePage()
  fs.writeFileSync('/tmp/mcl-ui.png', img.toPNG())
  console.log('saved /tmp/mcl-ui.png')

  // 第二张：切换到「版本」页
  win.webContents.executeJavaScript(`location.hash = '#/versions'`).catch(() => {})
  await new Promise((r) => setTimeout(r, 3500))
  const img2 = await win.webContents.capturePage()
  fs.writeFileSync('/tmp/mcl-ui-versions.png', img2.toPNG())
  console.log('saved /tmp/mcl-ui-versions.png')

  // 第三张：切换到「下载」页
  win.webContents.executeJavaScript(`location.hash = '#/downloads'`).catch(() => {})
  await new Promise((r) => setTimeout(r, 2500))
  const img3 = await win.webContents.capturePage()
  fs.writeFileSync('/tmp/mcl-ui-downloads.png', img3.toPNG())
  console.log('saved /tmp/mcl-ui-downloads.png')

  app.exit(0)
})
