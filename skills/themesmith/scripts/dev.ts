// The local preview, started in the background so it keeps running between commands.
//   bun dev.ts            start (or restart) every profile dev command; prints the preview links when ready
//   bun dev.ts stop       stop them
//   bun dev.ts status     whether the preview is running, with its links
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { devRunning, startDev, stopDev } from './lib/dev.ts'
import { findRoot, loadProfile } from './lib/profile.ts'

const root = findRoot()
const command = process.argv[2] ?? 'start'

if (command === 'stop') {
  console.log(JSON.stringify({ ok: true, stopped: stopDev(root) }))
} else if (command === 'status') {
  const path = join(root, '.themesmith', 'dev.json')
  const running = devRunning(root)
  console.log(JSON.stringify({ ok: true, running, ...(running && existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {}) }, null, 2))
} else if (command === 'start') {
  const result = await startDev(root, loadProfile(root))
  console.log(JSON.stringify(result.ok ? { ok: true, ...result.preview } : result, null, 2))
  process.exit(result.ok ? 0 : 1)
} else {
  console.error('Usage: bun dev.ts [start|stop|status]')
  process.exit(2)
}
