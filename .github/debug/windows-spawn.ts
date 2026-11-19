// Temporary: which ways of starting a background process on Windows get its output into a log file.
import { closeSync, mkdtempSync, openSync, readFileSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const dir = mkdtempSync(join(tmpdir(), 'spawn-debug-'))
const script = join(dir, 'say.ts')
writeFileSync(script, "require('fs').writeSync(1, 'writeSync ok\\n'); console.log('console.log ok'); setTimeout(() => {}, 5000)\n")
const bun = process.execPath

async function trial(name: string, start: (log: string) => void) {
  const log = join(dir, `${name}.log`)
  try {
    start(log)
  } catch (e) {
    console.log(`${name}: threw ${(e as Error).message}`)
    return
  }
  await Bun.sleep(3000)
  let text = '(no file)'
  try {
    text = JSON.stringify(readFileSync(log, 'utf8'))
  } catch {}
  console.log(`${name}: ${text}`)
}

const viaFd = (detached: boolean, cmd: (log: string) => string[], verbatim = false) => (log: string) => {
  const fd = openSync(log, 'a')
  Bun.spawn(cmd(log), { stdin: 'ignore', stdout: fd, stderr: fd, detached, windowsVerbatimArguments: verbatim }).unref()
  closeSync(fd)
}
const viaRedirect = (detached: boolean) => (log: string) => {
  Bun.spawn(['cmd.exe', '/d', '/s', '/c', `"("${bun}" "${script}") >> "${log}" 2>&1"`], { stdin: 'ignore', stdout: 'ignore', stderr: 'ignore', detached, windowsVerbatimArguments: true }).unref()
}

await trial('bun-fd-detached', viaFd(true, () => [bun, script]))
await trial('bun-fd-attached', viaFd(false, () => [bun, script]))
await trial('cmd-fd-detached', viaFd(true, () => ['cmd.exe', '/d', '/s', '/c', `""${bun}" "${script}""`], true))
await trial('cmd-fd-attached', viaFd(false, () => ['cmd.exe', '/d', '/s', '/c', `""${bun}" "${script}""`], true))
await trial('cmd-redirect-detached', viaRedirect(true))
await trial('cmd-redirect-attached', viaRedirect(false))
process.exit(0)
