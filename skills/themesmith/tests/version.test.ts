// The doctor offers a newer themesmith and updates the computer-wide install. Builds a "GitHub" repository from
// the current themesmith files, clones it as this computer's install, then releases a new version upstream.
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const REPO = resolve(import.meta.dir, '../../..')
// The version in this checkout, and the next one a release would raise it to.
const CURRENT = (JSON.parse(readFileSync(join(REPO, 'skills/themesmith/package.json'), 'utf8')) as { version: string }).version
const NEXT = CURRENT.replace(/^(\d+)\.(\d+)\.\d+$/, (_, major, minor) => `${major}.${Number(minor) + 1}.0`)
let dir: string
let home: string
let upstream: string
let install: string
let theme: string

const env = () => ({
  ...process.env,
  HOME: home,
  // Windows finds the home folder through USERPROFILE.
  USERPROFILE: home,
  XDG_CACHE_HOME: join(home, '.cache'),
  XDG_CONFIG_HOME: join(home, '.config'),
  // Packages come from the real cache, so installing them needs no network.
  BUN_INSTALL_CACHE_DIR: process.env.BUN_INSTALL_CACHE_DIR ?? join(homedir(), '.bun', 'install', 'cache'),
  GIT_AUTHOR_NAME: 'Test',
  GIT_AUTHOR_EMAIL: 'test@example.com',
  GIT_COMMITTER_NAME: 'Test',
  GIT_COMMITTER_EMAIL: 'test@example.com',
})

function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', env: env() })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')}: ${r.stderr}`)
  return r.stdout.trim()
}

function doctor(...args: string[]) {
  const r = spawnSync('bun', [join(install, 'skills/themesmith/scripts/doctor.ts'), ...args], { cwd: theme, encoding: 'utf8', env: env() })
  return JSON.parse(r.stdout)
}

// Releases a version upstream: a commit to main that raises it.
function release(version: string, title: string) {
  const work = join(dir, `release-${version}`)
  git(dir, 'clone', '-q', upstream, work)
  const path = join(work, 'skills/themesmith/package.json')
  writeFileSync(path, `${JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), version }, null, 2)}\n`)
  git(work, 'commit', '-qam', title)
  git(work, 'push', '-q', 'origin', 'main')
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'themesmith-version-'))
  home = join(dir, 'home')
  upstream = join(dir, 'upstream.git')
  install = join(home, 'themesmith')
  theme = join(dir, 'theme')
  mkdirSync(theme, { recursive: true })
  // The current files, without installed packages or Git history, as the repository on GitHub.
  const source = join(dir, 'source')
  cpSync(REPO, source, { recursive: true, filter: (p) => !/[\\/](node_modules|\.git)$/.test(p) })
  git(source, 'init', '-q', '-b', 'main')
  git(source, 'add', '-A')
  git(source, 'commit', '-qm', `Release ${CURRENT}`)
  git(dir, 'clone', '-q', '--bare', source, upstream)
  git(dir, 'clone', '-q', upstream, install)
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

test('offers a newer version, can stop offering it, and updates the computer-wide install', () => {
  expect(doctor().version).toBe(CURRENT)
  expect(doctor().update).toBeUndefined()

  release(NEXT, 'Add the version check')
  // Checks GitHub at most every few hours: forget the last check, as if time had passed.
  rmSync(join(home, '.cache/themesmith'), { recursive: true, force: true })
  expect(doctor().update).toEqual({ current: CURRENT, latest: NEXT, changes: ['Add the version check'] })

  expect(doctor('--skip-update')).toEqual({ ok: true, skipped: NEXT })
  expect(doctor().update).toBeUndefined()

  expect(doctor('--update')).toEqual({ ok: true, from: CURRENT, to: NEXT, changes: ['Add the version check'] })
  expect(JSON.parse(readFileSync(join(install, 'skills/themesmith/package.json'), 'utf8')).version).toBe(NEXT)
  // install.ts ran: the skills are linked for the agents, with their packages installed.
  expect(existsSync(join(home, '.claude/skills/themesmith/SKILL.md'))).toBe(true)
  expect(existsSync(join(install, 'skills/themesmith/node_modules/@shopify/theme-check-node'))).toBe(true)
  expect(doctor().version).toBe(NEXT)
}, 120_000)

test('refuses to update over changes someone made to themesmith on this computer', () => {
  release(NEXT, 'Add the version check')
  writeFileSync(join(install, 'skills/themesmith/SKILL.md'), 'edited here\n')
  const r = doctor('--update')
  expect(r.ok).toBe(false)
  expect(r.message).toContain('Someone changed themesmith on this computer')
  expect(readFileSync(join(install, 'skills/themesmith/SKILL.md'), 'utf8')).toBe('edited here\n')
})
