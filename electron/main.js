const path = require('path')
const fs = require('fs')
const { app, BrowserWindow, Menu, shell, nativeTheme } = require('electron')

const ipc = require('./ipc')
const jobs = require('./core/jobs')
const launchCore = require('./core/launch')

let mainWindow = null

function sendToRenderer(channel, payload) {
  for (const w of BrowserWindow.getAllWindows()) {
    if (!w.isDestroyed() && !w.webContents.isDestroyed()) {
      try {
        w.webContents.send(channel, payload)
      } catch {}
    }
  }
}

function createWindow() {
  const windowOptions = {
    width: 1220,
    height: 780,
    minWidth: 1000,
    minHeight: 640,
    show: false,
    backgroundColor: '#101218',
    autoHideMenuBar: true,
    title: 'MC Launcher',
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: false,
    },
  }
  const iconPath = path.join(__dirname, '..', 'build', 'icon.png')
  if (fs.existsSync(iconPath)) windowOptions.icon = iconPath
  mainWindow = new BrowserWindow(windowOptions)

  mainWindow.once('ready-to-show', () => mainWindow.show())

  // 外部链接一律交给系统浏览器
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
    return { action: 'deny' }
  })
  const devUrl = process.env.VITE_DEV_SERVER_URL
  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (devUrl && url.startsWith(devUrl)) return
    event.preventDefault()
    if (/^https?:\/\//i.test(url)) shell.openExternal(url)
  })

  if (devUrl) mainWindow.loadURL(devUrl).catch(() => {})
  else mainWindow.loadFile(path.join(__dirname, '..', 'dist', 'index.html'))

  mainWindow.on('closed', () => {
    mainWindow = null
  })
}

// 单实例锁
if (!app.requestSingleInstanceLock()) {
  app.quit()
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(() => {
    nativeTheme.themeSource = 'dark' // 深色标题栏
    Menu.setApplicationMenu(null)
    jobs.setSender(sendToRenderer)
    launchCore.setEventSink(sendToRenderer)
    ipc.register()
    createWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })

  app.on('window-all-closed', () => {
    // 游戏进程独立运行，退出启动器不影响游戏
    if (process.platform !== 'darwin') app.quit()
  })
}
