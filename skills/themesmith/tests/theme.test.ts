import { afterEach, beforeEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const SKILL_DIR = resolve(import.meta.dir, '..')
const LIVE = 100
let dir: string
let shop: string
let folder: string
let bin: string

type Result = { ok: boolean; files?: string[]; conflicts?: string[]; brought?: string[]; steps: { step: string; ok: boolean; detail?: string }[] } & Record<string, unknown>

function write(base: string, file: string, content: string) {
  mkdirSync(dirname(join(base, file)), { recursive: true })
  writeFileSync(join(base, file), content)
}

const read = (base: string, file: string) => readFileSync(join(base, file), 'utf8')
const themeDir = (id: number) => join(shop, 'themes', String(id))
const themes = () => JSON.parse(read(shop, 'themes.json')) as { id: number; name: string; role: string }[]
const draftId = () => themes().find((t) => t.role === 'unpublished')!.id

function theme(...args: string[]): Result {
  const r = spawnSync('bun', [join(SKILL_DIR, 'scripts/theme.ts'), ...args], {
    cwd: folder,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}`, FAKE_SHOPIFY: shop },
  })
  try {
    return JSON.parse(r.stdout) as Result
  } catch {
    throw new Error(`theme.ts printed no JSON:\n${r.stdout}\n${r.stderr}`)
  }
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'themesmith-cli-'))
  shop = join(dir, 'shop')
  folder = join(dir, 'theme')
  bin = join(dir, 'bin')
  mkdirSync(bin)
  // Linked like a global install, so theme.ts must find the entry script and run it on Bun: the file has no
  // shebang or execute bit, so running it as a plain command would fail.
  cpSync(join(SKILL_DIR, 'tests/fake-shopify.ts'), join(bin, 'cli/run.ts'))
  chmodSync(join(bin, 'cli/run.ts'), 0o755)
  symlinkSync(join(bin, 'cli/run.ts'), join(bin, 'shopify'))
  write(shop, 'themes.json', JSON.stringify([{ id: LIVE, name: 'Live', role: 'live' }]))
  write(shop, 'calls.log', '')
  write(themeDir(LIVE), 'sections/hero.liquid', '<h1>Live</h1>\n')
  write(themeDir(LIVE), 'templates/index.json', '{"v":1}\n')
  write(themeDir(LIVE), 'snippets/vite-tag.liquid', 'built\n')
  mkdirSync(join(folder, '.agents'), { recursive: true })
  write(
    folder,
    '.agents/themesmith.json',
    JSON.stringify({
      store: 'example.myshopify.com',
      mode: 'cli',
      build: [{ cwd: '.', run: `bun -e "require('fs').writeFileSync('snippets/vite-tag.liquid', 'built\\n')"` }],
      devModeMarkers: [{ file: 'snippets/vite-tag.liquid', contains: '127.0.0.1' }],
    })
  )
  write(folder, '.shopifyignore', '.agents/**\n.themesmith/**\n')
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

test('start copies the live theme into the folder', () => {
  expect(theme('start').ok).toBe(true)
  expect(read(folder, 'sections/hero.liquid')).toBe('<h1>Live</h1>\n')
})

test('start refuses to overwrite theme files that differ from the live theme', () => {
  write(folder, 'sections/hero.liquid', '<h1>Mine</h1>\n')
  const r = theme('start')
  expect(r.ok).toBe(false)
  expect(r.files).toEqual(['sections/hero.liquid'])
  expect(read(folder, 'sections/hero.liquid')).toBe('<h1>Mine</h1>\n')
})

test('the first push builds and creates a new unpublished theme, leaving the live theme alone', () => {
  theme('start')
  write(folder, 'sections/hero.liquid', '<h1>Sale</h1>\n')
  write(folder, 'snippets/vite-tag.liquid', 'http://127.0.0.1:5173\n')
  const r = theme('push', '--name', 'Fall sale')
  expect(r.steps.map((s) => s.step)).toEqual(['build', 'dev mode check', 'push'])
  expect(themes()).toEqual([
    { id: LIVE, name: 'Live', role: 'live' },
    { id: LIVE + 1, name: 'Fall sale', role: 'unpublished' },
  ])
  expect(read(themeDir(LIVE + 1), 'sections/hero.liquid')).toBe('<h1>Sale</h1>\n')
  expect(read(themeDir(LIVE + 1), 'snippets/vite-tag.liquid')).toBe('built\n')
  expect(read(themeDir(LIVE), 'sections/hero.liquid')).toBe('<h1>Live</h1>\n')
  expect(existsSync(join(themeDir(LIVE + 1), '.agents'))).toBe(false)
})

test('refuses to push when the build leaves dev-mode files behind', () => {
  theme('start')
  write(folder, '.agents/themesmith.json', JSON.stringify({ ...JSON.parse(read(folder, '.agents/themesmith.json')), build: [] }))
  write(folder, 'snippets/vite-tag.liquid', 'http://127.0.0.1:5173\n')
  const r = theme('push', '--name', 'Fall sale')
  expect(r.ok).toBe(false)
  expect(r.steps.at(-1)!.step).toBe('dev mode check')
  expect(themes()).toHaveLength(1)
})

test('Shopify rewriting pushed JSON is not mistaken for someone else\'s edit', () => {
  theme('start')
  write(folder, 'templates/index.json', '{\n"unknown_setting": 1,\n"v": 2\n}\n')
  theme('push', '--name', 'Fall sale')
  expect(read(themeDir(draftId()), 'templates/index.json')).toBe('{\n"v": 2\n}\n')
  write(folder, 'sections/hero.liquid', '<h1>Sale 2</h1>\n')
  expect(theme('push').ok).toBe(true)
})

test('refuses to overwrite a draft someone edited on Shopify since the last push', () => {
  theme('start')
  theme('push', '--name', 'Fall sale')
  write(themeDir(draftId()), 'templates/index.json', '{"v":"editor"}\n')
  write(folder, 'sections/hero.liquid', '<h1>Sale 2</h1>\n')
  const r = theme('push')
  expect(r.ok).toBe(false)
  expect(r.files).toEqual(['templates/index.json'])
  expect(read(themeDir(draftId()), 'sections/hero.liquid')).toBe('<h1>Live</h1>\n')
})

test('notices a file deleted on the draft, even though its mirror started as a copy of this folder', () => {
  theme('start')
  theme('push', '--name', 'Fall sale')
  rmSync(join(themeDir(draftId()), 'templates/index.json'))
  write(folder, 'sections/hero.liquid', '<h1>Sale 2</h1>\n')
  expect(theme('push').files).toEqual(['templates/index.json'])
})

test('pull-changes brings in editor edits, then the push keeps both', () => {
  theme('start')
  theme('push', '--name', 'Fall sale')
  write(themeDir(draftId()), 'templates/index.json', '{"v":"editor"}\n')
  write(folder, 'sections/hero.liquid', '<h1>Sale 2</h1>\n')
  expect(theme('pull-changes', '--from', 'draft').brought).toEqual(['templates/index.json'])
  expect(theme('push').ok).toBe(true)
  expect(read(themeDir(draftId()), 'templates/index.json')).toBe('{"v":"editor"}\n')
  expect(read(themeDir(draftId()), 'sections/hero.liquid')).toBe('<h1>Sale 2</h1>\n')
})

test('a file changed both here and on Shopify blocks the push until merged', () => {
  theme('start')
  theme('push', '--name', 'Fall sale')
  write(themeDir(draftId()), 'sections/hero.liquid', '<h1>Editor</h1>\n')
  write(folder, 'sections/hero.liquid', '<h1>Mine</h1>\n')
  const pulled = theme('pull-changes', '--from', 'draft')
  expect(pulled.conflicts).toEqual(['sections/hero.liquid'])
  expect(read(folder, '.themesmith/conflicts/draft/sections/hero.liquid')).toBe('<h1>Editor</h1>\n')
  expect(theme('push').files).toEqual(['draft/sections/hero.liquid'])
  rmSync(join(folder, '.themesmith/conflicts'), { recursive: true })
  expect(theme('push').ok).toBe(true)
})

test('pull-changes from live brings in customizer edits made to the live theme', () => {
  theme('start')
  theme('push', '--name', 'Fall sale')
  write(themeDir(LIVE), 'templates/index.json', '{"v":"live edit"}\n')
  expect(theme('pull-changes', '--from', 'live').brought).toEqual(['templates/index.json'])
  expect(theme('push').ok).toBe(true)
  expect(read(themeDir(draftId()), 'templates/index.json')).toBe('{"v":"live edit"}\n')
})

test('refuses to push to a draft that has since been published', () => {
  theme('start')
  theme('push', '--name', 'Fall sale')
  writeFileSync(join(shop, 'themes.json'), JSON.stringify([{ id: LIVE, name: 'Live', role: 'unpublished' }, { id: LIVE + 1, name: 'Fall sale', role: 'live' }]))
  write(folder, 'sections/hero.liquid', '<h1>After publish</h1>\n')
  const r = theme('push')
  expect(r.ok).toBe(false)
  expect(read(themeDir(LIVE + 1), 'sections/hero.liquid')).toBe('<h1>Live</h1>\n')
})

test('pushes to the live theme only with the explicit override, after building', () => {
  theme('start')
  write(folder, 'sections/hero.liquid', '<h1>Now</h1>\n')
  write(folder, 'snippets/vite-tag.liquid', 'http://127.0.0.1:5173\n')
  const r = theme('push', '--onto-live-theme')
  expect(r.steps.map((s) => s.step)).toEqual(['build', 'dev mode check', 'drift check', 'push'])
  expect(read(themeDir(LIVE), 'sections/hero.liquid')).toBe('<h1>Now</h1>\n')
  expect(read(themeDir(LIVE), 'snippets/vite-tag.liquid')).toBe('built\n')
})

test('the live override refuses when the live theme changed since start', () => {
  theme('start')
  write(themeDir(LIVE), 'templates/index.json', '{"v":"customizer"}\n')
  write(folder, 'sections/hero.liquid', '<h1>Now</h1>\n')
  const r = theme('push', '--onto-live-theme')
  expect(r.files).toEqual(['templates/index.json'])
  expect(read(themeDir(LIVE), 'sections/hero.liquid')).toBe('<h1>Live</h1>\n')
})

test('never passes a live or publish flag to the Shopify CLI', () => {
  theme('start')
  theme('push', '--name', 'Fall sale')
  theme('pull-changes', '--from', 'live')
  theme('status')
  expect(read(shop, 'calls.log')).not.toMatch(/--live|--allow-live|--publish|theme publish|theme delete/)
})

test('review-units lists the theme files changed since start, each whole', () => {
  theme('start')
  write(folder, 'sections/hero.liquid', '<h1>Sale</h1>\n<p>New</p>\n')
  const r = spawnSync('bun', [join(SKILL_DIR, 'scripts/review-units.ts')], { cwd: folder, encoding: 'utf8' })
  expect(JSON.parse(r.stdout).units).toEqual([
    { kind: 'section', name: 'hero', files: ['sections/hero.liquid'], changedLines: { 'sections/hero.liquid': [[1, 3]] } },
  ])
})

test('never falls back to a Shopify CLI that Bun cannot run', () => {
  // A `shopify` that isn't a JavaScript entry point (a Node wrapper script, say), and no Bun global install.
  const wrapperBin = join(dir, 'wrapper-bin')
  mkdirSync(wrapperBin)
  write(wrapperBin, 'shopify', `#!/bin/sh\necho ran >> ${join(dir, 'wrapper-ran')}\n`)
  chmodSync(join(wrapperBin, 'shopify'), 0o755)
  const r = spawnSync('bun', [join(SKILL_DIR, 'scripts/theme.ts'), 'start'], {
    cwd: folder,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${wrapperBin}:${dirname(process.execPath)}:/usr/bin:/bin`, BUN_INSTALL_GLOBAL_DIR: join(dir, 'no-bun-global') },
  })
  const result = JSON.parse(r.stdout) as Result
  expect(result.ok).toBe(false)
  expect(JSON.stringify(result)).toContain('bun add -g @shopify/cli@latest')
  expect(existsSync(join(dir, 'wrapper-ran'))).toBe(false)
})

test('hands on the verification page when Shopify asks the person to confirm their identity', () => {
  write(shop, 'verify', '')
  const r = theme('start')
  expect(r.ok).toBe(false)
  expect(r.steps.at(-1)!.step).toBe('theme list')
  expect(r.verifyUrl).toBe('https://accounts.shopify.com/verify/abc123')
})

test('a partial push records the draft, and the next push finishes it without creating another theme', () => {
  theme('start')
  write(folder, 'sections/hero.liquid', '<h1>Sale</h1>\n')
  write(folder, 'sections/broken.liquid', 'FAIL_UPLOAD\n')
  const partial = theme('push', '--name', 'Fall sale')
  expect(partial.ok).toBe(false)
  expect(partial.issues).toEqual([{ file: 'sections/broken.liquid', message: 'Liquid syntax error' }])
  expect(read(themeDir(LIVE + 1), 'sections/hero.liquid')).toBe('<h1>Sale</h1>\n')

  write(folder, 'sections/broken.liquid', '<p>Fixed</p>\n')
  const r = theme('push')
  expect(r.ok).toBe(true)
  expect(r.steps.map((s) => s.step)).toEqual(['build', 'dev mode check', 'drift check', 'push'])
  expect(themes()).toHaveLength(2)
  expect(read(themeDir(LIVE + 1), 'sections/broken.liquid')).toBe('<p>Fixed</p>\n')
})

test('keeps pushing to the same draft from state written with Shopify CLI 4, which stored numeric IDs', () => {
  theme('start')
  write(folder, 'sections/hero.liquid', '<h1>Sale</h1>\n')
  theme('push', '--name', 'Fall sale')
  const statePath = join(folder, '.themesmith/state.json')
  const state = JSON.parse(read(folder, '.themesmith/state.json'))
  writeFileSync(statePath, JSON.stringify({ ...state, live: { ...state.live, id: Number(state.live.id) }, draft: { ...state.draft, id: Number(state.draft.id) } }))
  write(folder, 'sections/hero.liquid', '<h1>Bigger sale</h1>\n')
  const r = theme('push')
  expect(r.ok).toBe(true)
  expect(themes()).toHaveLength(2)
  expect(read(themeDir(LIVE + 1), 'sections/hero.liquid')).toBe('<h1>Bigger sale</h1>\n')
})
