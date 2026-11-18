// The scripts that start work and keep it moving: profile detection, start.ts, the fast Theme Check, the
// background preview, and the background sign-in.
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { suggestProfile } from '../scripts/lib/detect.ts'

const SCRIPTS = resolve(import.meta.dir, '../scripts')
let dir: string
let repo: string

function write(file: string, content: string) {
  mkdirSync(dirname(join(repo, file)), { recursive: true })
  writeFileSync(join(repo, file), content)
}

function git(cwd: string, ...args: string[]) {
  return spawnSync('git', args, { cwd, encoding: 'utf8' }).stdout.trim()
}

function commit(message: string) {
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', message, '--allow-empty')
}

// A fake Shopify CLI, linked like a global install, from the given source.
function installShopify(source: string) {
  mkdirSync(join(dir, 'bin/cli'), { recursive: true })
  writeFileSync(join(dir, 'bin/cli/run.ts'), source)
  chmodSync(join(dir, 'bin/cli/run.ts'), 0o755)
  symlinkSync(join(dir, 'bin/cli/run.ts'), join(dir, 'bin/shopify'))
}

function script(name: string, ...args: string[]) {
  const r = spawnSync('bun', [join(SCRIPTS, name), ...args], {
    cwd: repo,
    encoding: 'utf8',
    env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, BUN_INSTALL_GLOBAL_DIR: join(dir, 'no-bun-global') },
  })
  return { code: r.status, stdout: r.stdout, stderr: r.stderr, json: () => JSON.parse(r.stdout) }
}

const profile = (extra: object = {}) => write('.agents/themesmith.json', JSON.stringify({ store: 'example.myshopify.com', mode: 'github', protectedBranches: ['main'], ...extra }))

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'themesmith-workflow-'))
  repo = join(dir, 'repo')
  mkdirSync(repo)
  git(repo, 'init', '-q', '-b', 'main')
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
})

afterEach(() => {
  spawnSync('bun', [join(SCRIPTS, 'dev.ts'), 'stop'], { cwd: repo })
  rmSync(dir, { recursive: true, force: true })
})

test('suggests a profile from the repository: protected branches, asset builds, and built files', async () => {
  git(repo, 'remote', 'add', 'origin', 'git@github.com:acme/theme.git')
  write('apps/package.json', JSON.stringify({ scripts: { dev: 'vite', build: 'vite build' } }))
  write('apps/vite.config.ts', 'export default {}\n')
  write('apps/bun.lock', '')
  write('discounts/package.json', JSON.stringify({ scripts: { dev: 'shopify app dev', build: 'shopify app build' } }))
  write('discounts/shopify.app.toml', '')
  write('snippets/vite-tag.liquid', "{% render 'vite_main.min.js' %}\n")
  // A workflow that runs on pull requests into release branches makes those bases too; catch-alls and
  // negations don't count.
  write('.github/workflows/ci.yml', "on:\n  pull_request:\n    branches: ['release/**', '!release/old', '**']\n  push:\n    branches: [feature-x]\n")
  commit('init')
  for (const branch of ['main', 'main', 'main-2', 'summer-sale']) commit(`Update from Shopify for theme acme/${branch}`)

  expect(await suggestProfile(repo)).toMatchObject({
    mode: 'github',
    protectedBranches: ['main', 'release/**'],
    dev: [
      { cwd: '.', run: 'bun {skill}/scripts/shopify.ts theme dev --store {store}' },
      { cwd: 'apps', run: 'bun run dev' },
    ],
    build: [{ cwd: 'apps', run: 'bun run build' }],
    devModeMarkers: [
      { file: 'snippets/vite-tag.liquid', contains: '127.0.0.1' },
      { file: 'snippets/vite-tag.liquid', contains: 'localhost' },
    ],
    generated: ['assets/vite_*', 'snippets/vite-tag.liquid'],
  })
})

test('start.ts makes a branch from the latest main and commits only the files setup changed', () => {
  const remote = join(dir, 'remote.git')
  git(dir, 'init', '-q', '--bare', '-b', 'main', remote)
  git(repo, 'remote', 'add', 'origin', remote)
  profile()
  commit('init')
  git(repo, 'push', '-q', '-u', 'origin', 'main')
  git(repo, 'remote', 'set-head', 'origin', 'main')
  // Setup wrote AGENTS.md; the person's own unsaved edit to notes.md must stay out of the setup commit.
  write('AGENTS.md', 'rules\n')
  write('notes.md', 'mine\n')
  write('.themesmith/setup-files.json', JSON.stringify(['AGENTS.md']))

  const r = script('start.ts', 'Fall Sale Banner', '--no-preview').json()
  expect(r.ok).toBe(true)
  expect(git(repo, 'branch', '--show-current')).toBe('fall-sale-banner')
  expect(git(repo, 'log', '-1', '--format=%s')).toBe('Set up themesmith')
  expect(git(repo, 'show', '--name-only', '--format=', 'HEAD')).toBe('AGENTS.md')
  expect(git(repo, 'status', '--porcelain')).toBe('?? notes.md')
  expect(existsSync(join(repo, '.themesmith/setup-files.json'))).toBe(false)
})

test('start.ts asks before leaving a branch that has work of its own', () => {
  const remote = join(dir, 'remote.git')
  git(dir, 'init', '-q', '--bare', '-b', 'main', remote)
  git(repo, 'remote', 'add', 'origin', remote)
  profile()
  commit('init')
  git(repo, 'push', '-q', '-u', 'origin', 'main')
  git(repo, 'remote', 'set-head', 'origin', 'main')
  git(repo, 'switch', '-qc', 'earlier-work')
  write('sections/hero.liquid', '<h1>Earlier</h1>\n')
  commit('Earlier work')

  const r = script('start.ts', 'new-work', '--no-preview')
  expect(r.code).toBe(1)
  expect(r.json().steps.at(-1)).toMatchObject({ step: 'branch', ok: false })
  expect(git(repo, 'branch', '--show-current')).toBe('earlier-work')
  expect(script('start.ts', '--continue', '--no-preview').json().ok).toBe(true)
})

test('theme-check.ts checks only the changed theme files, skipping built ones', () => {
  profile({ generated: ['snippets/vite-tag.liquid'] })
  write('sections/hero.liquid', "{% render 'missing-snippet' %}\n")
  write('sections/fine.liquid', '<h1>Fine</h1>\n')
  write('snippets/vite-tag.liquid', "{% render 'also-missing' %}\n")

  const broken = script('theme-check.ts', 'sections/hero.liquid', 'snippets/vite-tag.liquid', 'README.md')
  expect(broken.code).toBe(1)
  expect(broken.stdout).toContain("error   sections/hero.liquid:1  'snippets/missing-snippet.liquid' does not exist (MissingTemplate)")
  expect(broken.stdout).toContain('Theme Check, 1 changed file: 1 error, 0 warnings.')
  expect(broken.stdout).not.toContain('also-missing')

  expect(script('theme-check.ts', 'sections/fine.liquid').code).toBe(0)
  expect(script('theme-check.ts').stdout).toContain('No theme files changed')
})

test('dev.ts starts the preview in the background and finds pages to preview new templates on', async () => {
  installShopify(`const port = 20000 + Math.floor(Math.random() * 20000)
Bun.serve({ port, fetch: () => new Response('<a href="/pages/about">About</a><a href="/products/widget">Widget</a>', { headers: { 'content-type': 'text/html' } }) })
console.log('Preview your theme: http://127.0.0.1:' + port)
console.log('Share your theme preview (https://example.myshopify.com/?preview_theme_id=123)')
`)
  profile({ dev: [{ cwd: '.', run: 'bun {skill}/scripts/shopify.ts theme dev --store {store}' }] })

  const started = script('dev.ts').json()
  expect(started).toMatchObject({ ok: true, share: 'https://example.myshopify.com/?preview_theme_id=123', samples: { page: '/pages/about', product: '/products/widget', collection: null } })
  expect((await fetch(started.preview)).ok).toBe(true)
  expect(script('dev.ts', 'status').json().running).toBe(true)

  expect(script('dev.ts', 'stop').json()).toEqual({ ok: true, stopped: 1 })
  await Bun.sleep(300)
  expect(await fetch(started.preview).then(() => 'up', () => 'down')).toBe('down')
})

test('login.ts hands back the sign-in link at once and finishes when the person signs in', () => {
  // Like the Shopify CLI: `theme list --json` fails until signed in; plain `theme list` shows a code and waits.
  const signedIn = join(dir, 'signed-in')
  installShopify(`const fs = require('fs')
const a = process.argv.slice(2)
if (a.includes('--json')) {
  if (fs.existsSync(${JSON.stringify(signedIn)})) console.log(JSON.stringify({ themes: [] }))
  else { console.log(JSON.stringify({ error: { type: 'abort', message: 'Not logged in.' } })); process.exit(1) }
} else {
  console.log('To run this command, log in to Shopify.')
  console.log('User verification code: ABCD-EFGH')
  console.log('Opened link to start the auth process: https://accounts.shopify.com/activate-with-code?device_code%5Buser_code%5D=ABCD-EFGH')
  while (!fs.existsSync(${JSON.stringify(signedIn)})) Bun.sleepSync(100)
}
`)
  profile()

  expect(script('login.ts').json()).toMatchObject({
    status: 'waiting',
    code: 'ABCD-EFGH',
    url: 'https://accounts.shopify.com/activate-with-code?device_code%5Buser_code%5D=ABCD-EFGH',
  })
  writeFileSync(signedIn, '')
  expect(script('login.ts', '--wait').json()).toEqual({ status: 'ok' })
  expect(JSON.parse(readFileSync(join(repo, '.themesmith/jobs/login-shopify.json'), 'utf8'))).toEqual({ status: 'ok' })
})

test('a workflow pattern that covers the base branch replaces it', async () => {
  write('.github/workflows/ci.yml', "on:\n  pull_request:\n    branches: ['main*']\n")
  commit('init')
  expect((await suggestProfile(repo)).protectedBranches).toEqual(['main*'])
})

test('names a development theme after its branch, and connected themes the way Shopify does', async () => {
  const { devContext, connectedName } = await import('../scripts/lib/preview.ts')
  expect(devContext('fall-sale-banner')).toBe('fall-sale-banner')
  const long = 'product-page-add-on-items-section-redesign-and-cleanup-999'
  expect(devContext(long)).toMatch(new RegExp(`^${long.slice(0, 43)}~[0-9a-f]{6}$`))
  expect(devContext(long)).toHaveLength(50)
  expect(devContext(`${long}-v2`)).not.toBe(devContext(long))
  expect(connectedName('acme', 'main-5')).toBe('acme/main-5')
  expect(connectedName('acme', 'search-bar-warranty-form-text-box-zoom-fix-371')).toBe('acme/search-bar-warranty-form-text-box-zoom-fix...')
})
