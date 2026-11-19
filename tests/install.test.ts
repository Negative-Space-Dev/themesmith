import { afterEach, beforeEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readlinkSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'

const INSTALL = resolve(import.meta.dir, '../install.ts')
let dir: string
let checkout: string
let home: string

function install(...args: string[]) {
  const r = spawnSync('bun', [join(checkout, 'install.ts'), ...args], { encoding: 'utf8', env: { ...process.env, HOME: home, USERPROFILE: home } })
  return JSON.parse(r.stdout) as { ok: boolean; linked: string[]; unchanged: string[]; removed: string[]; skipped: { path: string }[] }
}

function skill(name: string) {
  mkdirSync(join(checkout, 'skills', name), { recursive: true })
  writeFileSync(join(checkout, 'skills', name, 'SKILL.md'), `---\nname: ${name}\n---\n`)
}

const claude = (name: string) => join(home, '.claude/skills', name)
const agents = (name: string) => join(home, '.agents/skills', name)

beforeEach(() => {
  // The real path: on a Mac the temporary folder is behind a link (/var is /private/var), and on Windows it can
  // be a short name (RUNNER~1).
  dir = realpathSync.native(mkdtempSync(join(tmpdir(), 'themesmith-install-')))
  checkout = join(dir, 'themesmith')
  home = join(dir, 'home')
  mkdirSync(checkout)
  mkdirSync(home)
  copyFileSync(INSTALL, join(checkout, 'install.ts'))
  skill('themesmith')
  skill('theme-code-review')
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

test('links every skill into the Claude Code and shared user skill folders, and a second run changes nothing', () => {
  expect(install().linked.sort()).toEqual([agents('theme-code-review'), agents('themesmith'), claude('theme-code-review'), claude('themesmith')])
  expect(readFileSync(join(claude('themesmith'), 'SKILL.md'), 'utf8')).toBe('---\nname: themesmith\n---\n')
  expect(readlinkSync(agents('themesmith'))).toBe(join(checkout, 'skills/themesmith'))
  const again = install()
  expect([again.linked, again.removed, again.unchanged.length]).toEqual([[], [], 4])
})

test('removes links to skills deleted from the checkout, and leaves other skills alone', () => {
  install()
  mkdirSync(claude('my-own-skill'))
  rmSync(join(checkout, 'skills/theme-code-review'), { recursive: true })
  expect(install().removed.sort()).toEqual([agents('theme-code-review'), claude('theme-code-review')])
  expect(existsSync(claude('my-own-skill'))).toBe(true)
})

test('never replaces a skill installed some other way under the same name', () => {
  mkdirSync(claude('themesmith'), { recursive: true })
  writeFileSync(join(claude('themesmith'), 'SKILL.md'), 'mine\n')
  const result = install()
  expect([result.ok, result.skipped.map((s) => s.path)]).toEqual([false, [claude('themesmith')]])
  expect(readFileSync(join(claude('themesmith'), 'SKILL.md'), 'utf8')).toBe('mine\n')
  expect(lstatSync(agents('themesmith')).isSymbolicLink()).toBe(true)
})

test('uninstall removes only the links this checkout made', () => {
  install('--dir', join(home, '.cursor/skills'))
  mkdirSync(claude('my-own-skill'))
  expect(install('--uninstall', '--dir', join(home, '.cursor/skills')).removed.length).toBe(6)
  expect(existsSync(claude('themesmith'))).toBe(false)
  expect(existsSync(claude('my-own-skill'))).toBe(true)
  expect(readFileSync(join(checkout, 'skills/themesmith/SKILL.md'), 'utf8')).toBe('---\nname: themesmith\n---\n')
})
