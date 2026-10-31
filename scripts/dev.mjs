/**
 * 开发模式：启动 Vite dev server → 启动 Electron（加载 dev server URL）
 * 用法：npm run dev
 */
import { createServer } from 'vite'
import { spawn } from 'node:child_process'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import electronPath from 'electron'

const root = path.dirname(path.dirname(fileURLToPath(import.meta.url)))
process.chdir(root)

const server = await createServer({ root })
await server.listen()

const url = server.resolvedUrls.local[0]
console.log(`[dev] Vite: ${url}`)

// Ubuntu 24.04 默认 kernel.apparmor_restrict_unprivileged_userns=1，
// 而 node_modules 里的 chrome-sandbox 非 setuid root → 直接启动会 FATAL。
// 开发期以 --no-sandbox 运行（正式安装由 scripts/linux-install.sh 修好 setuid）。
const args = process.platform === 'linux' ? ['--no-sandbox', '.'] : ['.']
const child = spawn(electronPath, args, {
  cwd: root,
  env: { ...process.env, VITE_DEV_SERVER_URL: url },
  stdio: 'inherit',
})

const shutdown = async () => {
  try {
    child.kill()
  } catch {}
  try {
    await server.close()
  } catch {}
}
process.on('SIGINT', async () => {
  await shutdown()
  process.exit(0)
})
child.on('exit', async (code) => {
  await shutdown()
  process.exit(code || 0)
})
