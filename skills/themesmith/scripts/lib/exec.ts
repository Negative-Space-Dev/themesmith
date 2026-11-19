// Runs commands without blocking, so independent work (checks, installs, builds) can run at the same time.
import { closeSync, mkdirSync, openSync } from 'node:fs'
import { dirname } from 'node:path'

export type ExecResult = { ok: boolean; code: number | null; stdout: string; stderr: string; out: string }
export type ExecOptions = { cwd?: string; env?: Record<string, string | undefined>; timeout?: number }

const windows = process.platform === 'win32'

// A command line run by the system shell, as profile commands are written. On Windows the whole line goes to
// cmd.exe in one pair of quotes, passed as is (see `verbatim`): Bun would otherwise escape the quotes inside it as
// \", which cmd.exe doesn't understand, breaking any command with a quoted argument. Node's `shell: true` does
// the same.
export function shellArgs(command: string): string[] {
  return windows ? ['cmd.exe', '/d', '/s', '/c', `"${command}"`] : ['sh', '-c', command]
}

const verbatim = (cmd: string[]) => windows && cmd[0] === 'cmd.exe'

export async function exec(cmd: string[], options: ExecOptions = {}): Promise<ExecResult> {
  let proc
  try {
    proc = Bun.spawn(cmd, {
      cwd: options.cwd,
      env: options.env ? { ...process.env, ...options.env } : undefined,
      timeout: options.timeout,
      windowsVerbatimArguments: verbatim(cmd),
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
    })
  } catch (error) {
    // The program doesn't exist.
    const message = (error as Error).message
    return { ok: false, code: null, stdout: '', stderr: message, out: message }
  }
  const [stdout, stderr, code] = await Promise.all([new Response(proc.stdout).text(), new Response(proc.stderr).text(), proc.exited])
  return { ok: code === 0, code, stdout, stderr, out: `${stdout}${stderr}`.trim() }
}

export function sh(command: string, options: ExecOptions = {}): Promise<ExecResult> {
  return exec(shellArgs(command), options)
}

// Starts a command that keeps running after this script exits (a preview server, a sign-in waiting for the
// person). Its output goes to `log`. Returns its process ID, which is also its process group on Mac and Linux.
export function startDetached(cmd: string[], options: { cwd: string; log: string; env?: Record<string, string | undefined> }): number {
  mkdirSync(dirname(options.log), { recursive: true })
  // On Windows a detached process never wrote to a log file handed to it, so a shell command line redirects its own
  // output there instead: `(command) >> "log" 2>&1`, the parentheses covering every command in an `a && b` line.
  const redirect = verbatim(cmd)
  const fd = redirect ? null : openSync(options.log, 'a')
  const line = redirect ? [...cmd.slice(0, -1), `"(${cmd.at(-1)!.slice(1, -1)}) >> "${options.log}" 2>&1"`] : cmd
  const proc = Bun.spawn(line, {
    cwd: options.cwd,
    env: options.env ? { ...process.env, ...options.env } : undefined,
    windowsVerbatimArguments: redirect,
    stdin: 'ignore',
    stdout: fd ?? 'ignore',
    stderr: fd ?? 'ignore',
    detached: true,
  })
  proc.unref()
  if (fd !== null) closeSync(fd)
  return proc.pid
}

export function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0)
    return true
  } catch {
    return false
  }
}

// Stops a detached command and everything it started.
export function stopDetached(pid: number) {
  if (!isRunning(pid)) return
  if (windows) {
    Bun.spawnSync(['taskkill', '/pid', String(pid), '/t', '/f'])
    return
  }
  try {
    process.kill(-pid, 'SIGTERM')
  } catch {
    try {
      process.kill(pid, 'SIGTERM')
    } catch {}
  }
}
