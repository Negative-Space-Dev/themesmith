// Themesmith's version, and updating it. A release is a commit to `main` that raises the version in this skill's
// package.json. The computer-wide install is a Git checkout (see install.ts), so an update fast-forwards it and
// runs install.ts again; one update covers every theme on the computer.
import { mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, join, resolve } from 'node:path'
import { exec } from './exec.ts'
import { SKILL_DIR } from './run.ts'
import { atLeast } from './tools.ts'

// A path inside Git (`origin/main:<path>`), which takes forward slashes on every system.
const PACKAGE = `skills/${basename(SKILL_DIR)}/package.json`
// Looking for a new version at most this often; the doctor runs at the start of every conversation.
const CHECK_EVERY_MS = 6 * 60 * 60 * 1000

export function currentVersion(): string {
  return (JSON.parse(readFileSync(join(SKILL_DIR, 'package.json'), 'utf8')) as { version: string }).version
}

// The themesmith checkout this skill runs from, when it is one (a copy inside a theme isn't).
async function checkout(): Promise<string | null> {
  if (basename(dirname(SKILL_DIR)) !== 'skills') return null
  const dir = dirname(dirname(SKILL_DIR))
  const top = await exec(['git', 'rev-parse', '--show-toplevel'], { cwd: dir, timeout: 5_000 })
  return top.ok && samePath(top.stdout.trim(), dir) ? dir : null
}

// Git prints C:/Users/... on Windows where Node has C:\Users\..., and either may go through a link.
function samePath(a: string, b: string): boolean {
  const real = (p: string) => {
    try {
      return realpathSync(resolve(p))
    } catch {
      return resolve(p)
    }
  }
  const [x, y] = [real(a), real(b)]
  return process.platform === 'win32' ? x.toLowerCase() === y.toLowerCase() : x === y
}

type Cache = { checkedAt: number; latest: string | null; changes: string[]; skipped?: string }
const cacheFile = () => join(process.env.XDG_CACHE_HOME ?? join(homedir(), '.cache'), 'themesmith', 'update.json')

function readCache(): Cache | null {
  try {
    return JSON.parse(readFileSync(cacheFile(), 'utf8')) as Cache
  } catch {
    return null
  }
}

function writeCache(cache: Cache) {
  mkdirSync(dirname(cacheFile()), { recursive: true })
  writeFileSync(cacheFile(), `${JSON.stringify(cache, null, 2)}\n`)
}

// The version on GitHub's `main`, and the titles of the changes since this checkout.
async function fetchLatest(dir: string): Promise<{ latest: string; changes: string[] } | null> {
  const fetched = await exec(['git', 'fetch', '--quiet', 'origin', 'main'], { cwd: dir, timeout: 8_000, env: { GIT_TERMINAL_PROMPT: '0' } })
  if (!fetched.ok) return null
  const [pkg, log] = await Promise.all([
    exec(['git', 'show', `origin/main:${PACKAGE}`], { cwd: dir }),
    exec(['git', 'log', '--format=%s', '--max-count=10', 'HEAD..origin/main'], { cwd: dir }),
  ])
  if (!pkg.ok) return null
  return { latest: (JSON.parse(pkg.stdout) as { version: string }).version, changes: log.stdout.split('\n').filter(Boolean) }
}

export type Update = { current: string; latest: string; changes: string[] }

// A newer version the person hasn't turned down, or null. Never fails: offline, or not a checkout, is null.
export async function checkForUpdate(): Promise<Update | null> {
  const dir = await checkout()
  if (!dir) return null
  const current = currentVersion()
  let cache = readCache()
  if (!cache || Date.now() - cache.checkedAt > CHECK_EVERY_MS) {
    const found = await fetchLatest(dir).catch(() => null)
    if (!found) return null
    cache = { ...cache, checkedAt: Date.now(), ...found }
    writeCache(cache)
  }
  if (!cache.latest || atLeast(current, cache.latest) || cache.skipped === cache.latest) return null
  return { current, latest: cache.latest, changes: cache.changes }
}

// Stops asking about the newest version; a later one is offered again.
export function skipUpdate(): { ok: true; skipped: string | null } {
  const cache = readCache()
  if (cache?.latest) writeCache({ ...cache, skipped: cache.latest })
  return { ok: true, skipped: cache?.latest ?? null }
}

// Updates the checkout to GitHub's `main` and runs install.ts, which links any new skills and installs their
// packages. Refuses when someone changed themesmith on this computer: those edits belong in a pull request.
export async function update(): Promise<{ ok: true; from: string; to: string; changes: string[] } | { ok: false; message: string }> {
  const dir = await checkout()
  if (!dir) return { ok: false, message: 'This themesmith is a copy inside a theme, not a computer-wide install. Update it with update.ts (see references/update.md).' }
  const from = currentVersion()
  const [branch, dirty] = await Promise.all([
    exec(['git', 'branch', '--show-current'], { cwd: dir }),
    exec(['git', 'status', '--porcelain', '--untracked-files=no'], { cwd: dir }),
  ])
  if (branch.stdout.trim() !== 'main') return { ok: false, message: `The themesmith checkout (${dir}) is on "${branch.stdout.trim()}", not main, so it wasn't updated.` }
  if (dirty.stdout.trim() !== '') return { ok: false, message: `Someone changed themesmith on this computer (${dir}), so it wasn't updated. Those changes belong in a pull request to themesmith.` }
  const found = await fetchLatest(dir)
  if (!found) return { ok: false, message: "Couldn't reach GitHub to get the new version." }
  const merged = await exec(['git', 'merge', '--ff-only', '--quiet', 'origin/main'], { cwd: dir })
  if (!merged.ok) return { ok: false, message: `The update didn't apply cleanly:\n${merged.out}` }
  const installed = await exec(['bun', join(dir, 'install.ts')], { cwd: dir, timeout: 10 * 60_000 })
  if (!installed.ok) return { ok: false, message: `Updated, but install.ts failed:\n${installed.out.split('\n').slice(-8).join('\n')}` }
  const to = currentVersion()
  writeCache({ checkedAt: Date.now(), latest: to, changes: [] })
  return { ok: true, from, to, changes: found.changes }
}
