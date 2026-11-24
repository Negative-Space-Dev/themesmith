// Private code a theme includes as a Git submodule. Profile commands that run inside one that isn't downloaded get
// it first. When the server says this person can't have it, those commands are skipped: the files it builds are
// already in the theme. Any other failure (no network, not signed in) stops the work, because someone who does have
// access would otherwise push without building.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join, posix } from 'node:path'
import { exec } from './exec.ts'
import type { Command } from './profile.ts'

type Access = { state: 'downloaded' } | { state: 'denied' } | { state: 'failed'; message: string }
export type ReadyCommands = { ok: true; runnable: Command[]; skipped: Command[] } | { ok: false; message: string }

// What GitHub, GitLab and Bitbucket say about a repository this person can't see. A rejected SSH key or a missing
// sign-in isn't here: it doesn't tell whether they have access. Neither is an organization's single sign-on.
const DENIED = /repository not found|repository '.*' not found|could not be found or you don't have permission|access to this repository|returned error: 403/i
const SIGN_ON = /\bSAML\b|single sign-on/i

const isEmpty = (path: string) => !existsSync(path) || readdirSync(path).length === 0

// Only a path listed in .gitmodules counts: any other missing or empty folder is a mistake in the profile, and its
// command still runs and fails.
function missingSubmodules(root: string): string[] {
  const listed = spawnSync('git', ['config', '-z', '--file', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$'], { cwd: root, encoding: 'utf8' })
  if (listed.status !== 0) return []
  const paths = listed.stdout.split('\0').filter(Boolean).map((entry) => entry.slice(entry.indexOf('\n') + 1))
  return paths.filter((path) => isEmpty(join(root, path)))
}

async function download(root: string, path: string): Promise<Access> {
  // Never stop to ask for a password: nobody sees the question.
  const ssh = process.env.GIT_SSH_COMMAND ?? (spawnSync('git', ['config', 'core.sshCommand'], { cwd: root, encoding: 'utf8' }).stdout.trim() || 'ssh')
  const env = { LC_ALL: 'C', GIT_TERMINAL_PROMPT: '0', GCM_INTERACTIVE: 'never', GIT_SSH_COMMAND: `${ssh} -o BatchMode=yes` }
  const attempt = (...config: string[]) => exec(['git', ...config, 'submodule', 'update', '--init', '--', path], { cwd: root, env, timeout: 300_000 })

  const first = await attempt()
  if (first.ok) return { state: 'downloaded' }
  // Someone signed in to GitHub may have no SSH key, so the GitHub CLI's sign-in is tried too.
  const github = /github\.com[:/]/.test(first.out)
  const second = github
    ? await attempt('-c', 'url.https://github.com/.insteadOf=git@github.com:', '-c', 'url.https://github.com/.insteadOf=ssh://git@github.com/', '-c', 'credential.helper=', '-c', 'credential.https://github.com.helper=', '-c', 'credential.helper=!gh auth git-credential')
    : null
  if (second?.ok) return { state: 'downloaded' }

  await exec(['git', 'submodule', 'deinit', '-f', '--', path], { cwd: root })
  const out = [first.out, second?.out].filter(Boolean).join('\n')
  if (DENIED.test(out) && !SIGN_ON.test(out)) return { state: 'denied' }
  return { state: 'failed', message: `Could not download the ${path} submodule, or tell whether this person has access to it:\n${out.split('\n').slice(-15).join('\n')}` }
}

// One try per script run, shared by every command inside the submodule.
const attempts = new Map<string, Promise<Access>>()

export async function readyCommands(root: string, commands: Command[]): Promise<ReadyCommands> {
  const missing = missingSubmodules(root)
  const runnable: Command[] = []
  const skipped: Command[] = []
  for (const command of commands) {
    // Windows only: elsewhere a backslash can be part of a folder's name.
    const cwd = posix.normalize(process.platform === 'win32' ? command.cwd.replace(/\\/g, '/') : command.cwd).replace(/\/$/, '')
    const path = missing.find((p) => cwd === p || cwd.startsWith(`${p}/`))
    const key = join(root, path ?? '')
    if (path && !attempts.has(key)) attempts.set(key, download(root, path))
    const access: Access = path ? await attempts.get(key)! : { state: 'downloaded' }
    if (access.state === 'failed') return { ok: false, message: access.message }
    ;(access.state === 'denied' ? skipped : runnable).push(command)
  }
  return { ok: true, runnable, skipped }
}
