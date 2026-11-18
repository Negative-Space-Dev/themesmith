import { afterEach, beforeEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const UPDATE = resolve(import.meta.dir, '../scripts/update.ts')
let dir: string
let upstream: string
let repo: string

function git(cwd: string, ...args: string[]) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' }).stdout.trim()
}

function write(base: string, file: string, content: string) {
  mkdirSync(dirname(join(base, file)), { recursive: true })
  writeFileSync(join(base, file), content)
}

function release(files: Record<string, string | null>) {
  for (const [file, content] of Object.entries(files)) {
    if (content === null) unlinkSync(join(upstream, file))
    else write(upstream, file, content)
  }
  git(upstream, 'add', '-A')
  git(upstream, 'commit', '-qm', 'release')
  return git(upstream, 'rev-parse', 'HEAD')
}

function update(...args: string[]) {
  const r = spawnSync('bun', [UPDATE, ...args], { cwd: repo, encoding: 'utf8' })
  return JSON.parse(r.stdout) as { ok: boolean; skills: Record<string, string[] | string>[] }
}

const local = (file: string) => readFileSync(join(repo, '.agents/skills/themesmith', file), 'utf8')
const lock = () => JSON.parse(readFileSync(join(repo, '.agents/themesmith.lock.json'), 'utf8'))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'themesmith-update-'))
  upstream = join(dir, 'upstream')
  repo = join(dir, 'repo')
  mkdirSync(upstream)
  mkdirSync(repo)
  git(upstream, 'init', '-q', '-b', 'main')
  git(upstream, 'config', 'user.email', 'test@example.com')
  git(upstream, 'config', 'user.name', 'Test')
  git(repo, 'init', '-q', '-b', 'main')
  release({ 'skills/themesmith/SKILL.md': 'one\ntwo\nthree\nfour\nfive\n', 'skills/themesmith/scripts/a.ts': 'a1\n', 'skills/themesmith/old.md': 'old\n', 'README.md': 'not a skill\n' })
  update('install', upstream)
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

test('install copies every skill and records the upstream commit', () => {
  expect(local('SKILL.md')).toBe('one\ntwo\nthree\nfour\nfive\n')
  expect(existsSync(join(repo, '.agents/skills/README.md'))).toBe(false)
  expect(lock()).toMatchObject({ skills: { themesmith: { source: upstream, path: 'skills/themesmith', commit: git(upstream, 'rev-parse', 'HEAD') } } })
  expect(Object.keys(lock().skills.themesmith.files).sort()).toEqual(['SKILL.md', 'old.md', 'scripts/a.ts'])
})

test('installs from a folder with uncommitted changes, leaving node_modules out, and records a fingerprint', () => {
  // A themesmith checkout that isn't published or committed yet: no commit to record.
  const folder = join(dir, 'local-themesmith')
  write(folder, 'skills/themesmith/SKILL.md', 'local one\n')
  write(folder, 'skills/themesmith/node_modules/pkg/index.js', 'installed\n')
  const fresh = join(dir, 'fresh')
  mkdirSync(fresh)
  git(fresh, 'init', '-q', '-b', 'main')
  const r = spawnSync('bun', [UPDATE, 'install', folder], { cwd: fresh, encoding: 'utf8' })
  expect(JSON.parse(r.stdout).ok).toBe(true)
  expect(readFileSync(join(fresh, '.agents/skills/themesmith/SKILL.md'), 'utf8')).toBe('local one\n')
  expect(existsSync(join(fresh, '.agents/skills/themesmith/node_modules'))).toBe(false)
  const entry = JSON.parse(readFileSync(join(fresh, '.agents/themesmith.lock.json'), 'utf8')).skills.themesmith
  expect(entry).toMatchObject({ source: folder, path: 'skills/themesmith' })
  expect(entry.commit).toMatch(/^local:[0-9a-f]{16}$/)

  // Later changes in the folder come in by fingerprint: unchanged files take the new version, and a file
  // changed on both sides keeps this copy with the folder's version beside it.
  write(folder, 'skills/themesmith/SKILL.md', 'local two\n')
  write(folder, 'skills/themesmith/new.md', 'new\n')
  const updated = JSON.parse(spawnSync('bun', [UPDATE], { cwd: fresh, encoding: 'utf8' }).stdout)
  expect(updated.skills[0]).toMatchObject({ updated: ['SKILL.md'], added: ['new.md'] })
  expect(readFileSync(join(fresh, '.agents/skills/themesmith/SKILL.md'), 'utf8')).toBe('local two\n')

  write(fresh, '.agents/skills/themesmith/SKILL.md', 'edited in the theme\n')
  write(folder, 'skills/themesmith/SKILL.md', 'local three\n')
  const both = JSON.parse(spawnSync('bun', [UPDATE], { cwd: fresh, encoding: 'utf8' }).stdout)
  expect(both.skills[0]).toMatchObject({ conflicts: ['SKILL.md'] })
  expect(readFileSync(join(fresh, '.agents/skills/themesmith/SKILL.md'), 'utf8')).toBe('edited in the theme\n')
  expect(readFileSync(join(fresh, '.agents/skills/themesmith/SKILL.md.upstream'), 'utf8')).toBe('local three\n')
})

test('takes upstream changes and keeps this repo\'s edits to other files', () => {
  write(repo, '.agents/skills/themesmith/scripts/a.ts', 'a1 customized\n')
  const head = release({ 'skills/themesmith/SKILL.md': 'one\ntwo\nthree\nfour\nfive\nsix\n', 'skills/themesmith/new.md': 'new\n', 'skills/themesmith/old.md': null })
  const r = update()
  expect(r.ok).toBe(true)
  expect(r.skills[0]).toMatchObject({ updated: ['SKILL.md'], added: ['new.md'], removed: ['old.md'], keptLocal: ['scripts/a.ts'] })
  expect(local('SKILL.md')).toBe('one\ntwo\nthree\nfour\nfive\nsix\n')
  expect(local('scripts/a.ts')).toBe('a1 customized\n')
  expect(existsSync(join(repo, '.agents/skills/themesmith/old.md'))).toBe(false)
  expect(lock().skills['themesmith'].commit).toBe(head)
})

test('merges edits to different parts of the same file', () => {
  write(repo, '.agents/skills/themesmith/SKILL.md', 'one LOCAL\ntwo\nthree\nfour\nfive\n')
  release({ 'skills/themesmith/SKILL.md': 'one\ntwo\nthree\nfour\nfive UPSTREAM\n' })
  expect(update().skills[0]).toMatchObject({ merged: ['SKILL.md'], conflicts: [] })
  expect(local('SKILL.md')).toBe('one LOCAL\ntwo\nthree\nfour\nfive UPSTREAM\n')
})

test('marks a conflict when both sides changed the same lines', () => {
  write(repo, '.agents/skills/themesmith/SKILL.md', 'one\ntwo\nLOCAL\nfour\nfive\n')
  release({ 'skills/themesmith/SKILL.md': 'one\ntwo\nUPSTREAM\nfour\nfive\n' })
  const r = update()
  expect(r.ok).toBe(false)
  expect(r.skills[0].conflicts).toEqual(['SKILL.md'])
  expect(local('SKILL.md')).toContain('<<<<<<< this repo\nLOCAL\n=======\nUPSTREAM\n>>>>>>> new upstream\n')
})

test('a dry run changes nothing', () => {
  const before = lock()
  release({ 'skills/themesmith/SKILL.md': 'changed\n' })
  expect(update('--dry-run').skills[0].updated).toEqual(['SKILL.md'])
  expect(local('SKILL.md')).toBe('one\ntwo\nthree\nfour\nfive\n')
  expect(lock()).toEqual(before)
})
