// The scripts that start work and keep it moving: profile detection, start.ts, the fast Theme Check, the
// background preview, and the background sign-in.
import { afterEach, beforeEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { suggestProfile } from '../scripts/lib/detect.ts'
import { bunCommand, installCommand, installFakeShopify, pathWith, removeDir } from './helpers.ts'

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
  installFakeShopify(join(dir, 'bin'), source)
}

function script(name: string, ...args: string[]) {
  const r = spawnSync('bun', [join(SCRIPTS, name), ...args], {
    cwd: repo,
    encoding: 'utf8',
    // dev.ts waits up to 3 minutes for a preview; give up sooner and show why (see the dev.ts test).
    timeout: 40_000,
    env: { ...process.env, PATH: pathWith(join(dir, 'bin')), BUN_INSTALL_GLOBAL_DIR: join(dir, 'no-bun-global') },
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
  removeDir(dir)
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
  write('notes.md', 'original\n')
  commit('init')
  git(repo, 'push', '-q', '-u', 'origin', 'main')
  git(repo, 'remote', 'set-head', 'origin', 'main')
  // Setup wrote AGENTS.md. The person also has unsaved edits of their own, which have nothing to do with setup.
  write('AGENTS.md', 'rules\n')
  write('notes.md', 'my unsaved edit\n')
  write('draft.liquid', 'mine\n')
  write('.themesmith/setup-files.json', JSON.stringify(['AGENTS.md']))

  // It stops and lists them, so they don't end up in this work unnoticed.
  const stopped = script('start.ts', 'Fall Sale Banner')
  expect(stopped.code).toBe(1)
  expect(stopped.json()).toMatchObject({ ok: false, files: ['notes.md', 'draft.liquid'] })
  expect(git(repo, 'branch', '--show-current')).toBe('main')

  // --leave sets them aside; the new branch gets only setup's files.
  const r = script('start.ts', 'Fall Sale Banner', '--leave').json()
  expect(r.ok).toBe(true)
  expect(git(repo, 'branch', '--show-current')).toBe('fall-sale-banner')
  expect(git(repo, 'log', '-1', '--format=%s')).toBe('Set up themesmith')
  expect(git(repo, 'show', '--name-only', '--format=', 'HEAD')).toBe('AGENTS.md')
  expect(git(repo, 'status', '--porcelain')).toBe('')
  expect(existsSync(join(repo, '.themesmith/setup-files.json'))).toBe(false)
  // And `git stash pop` brings them back.
  git(repo, 'stash', 'pop', '-q')
  expect(readFileSync(join(repo, 'notes.md'), 'utf8')).toBe('my unsaved edit\n')
  expect(readFileSync(join(repo, 'draft.liquid'), 'utf8')).toBe('mine\n')
})

test('start.ts --carry brings unrelated uncommitted changes along as part of the work', () => {
  const remote = join(dir, 'remote.git')
  git(dir, 'init', '-q', '--bare', '-b', 'main', remote)
  git(repo, 'remote', 'add', 'origin', remote)
  profile()
  commit('init')
  git(repo, 'push', '-q', '-u', 'origin', 'main')
  git(repo, 'remote', 'set-head', 'origin', 'main')
  write('sections/hero.liquid', '<h1>Started before</h1>\n')

  expect(script('start.ts', 'hero-text', '--carry').json().ok).toBe(true)
  expect(git(repo, 'branch', '--show-current')).toBe('hero-text')
  expect(git(repo, 'status', '--porcelain', '--untracked-files=all')).toBe('?? sections/hero.liquid')
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
  installShopify(`require('fs').writeFileSync(${JSON.stringify(join(dir, 'cli-started'))}, process.argv.slice(2).join(' '))
const port = 20000 + Math.floor(Math.random() * 20000)
Bun.serve({ port, fetch: () => new Response('<a href="/pages/about">About</a><a href="/products/widget">Widget</a>', { headers: { 'content-type': 'text/html' } }) })
// Written straight to the file first: if only this line reaches the log, console.log's output is being held back.
require('fs').writeSync(1, 'fake CLI started\\n')
console.log('Preview your theme: http://127.0.0.1:' + port)
console.log('Share your theme preview (https://example.myshopify.com/?preview_theme_id=123)')
`)
  // A line from the step before the Shopify CLI wrapper, so a failure shows which step loses the output.
  const marker = bunCommand(dir, 'marker', "require('fs').writeSync(1, 'shell step ok\\n')\n")
  profile({ dev: [{ cwd: '.', run: `${marker} && bun {skill}/scripts/shopify.ts theme dev --store {store}` }] })

  const run = script('dev.ts')
  const log = (i: number) => (existsSync(join(repo, `.themesmith/dev/${i}.log`)) ? readFileSync(join(repo, `.themesmith/dev/${i}.log`), 'utf8') : '(no log)')
  let started
  try {
    started = run.json()
  } catch {
    const cli = existsSync(join(dir, 'cli-started')) ? `ran with: ${readFileSync(join(dir, 'cli-started'), 'utf8')}` : 'never ran'
    const state = existsSync(join(repo, '.themesmith/dev.json')) ? readFileSync(join(repo, '.themesmith/dev.json'), 'utf8') : '(no dev.json)'
    throw new Error(`dev.ts printed no JSON (exit ${run.code}):\n${run.stdout}\n${run.stderr}\npreview log:\n${log(0)}\nfake CLI ${cli}\n${state}`)
  }
  expect(started).toMatchObject({ ok: true, share: 'https://example.myshopify.com/?preview_theme_id=123', samples: { page: '/pages/about', product: '/products/widget', collection: null } })
  expect((await fetch(started.preview)).ok).toBe(true)
  expect(script('dev.ts', 'status').json().running).toBe(true)

  expect(script('dev.ts', 'stop').json()).toEqual({ ok: true, stopped: 1 })
  await Bun.sleep(300)
  expect(await fetch(started.preview).then(() => 'up', () => 'down')).toBe('down')
})

test('dev.ts leaves out a command whose submodule is not downloaded', () => {
  installShopify(`const port = 20000 + Math.floor(Math.random() * 20000)
Bun.serve({ port, fetch: () => new Response('ok') })
console.log('Preview your theme: http://127.0.0.1:' + port)
`)
  writeFileSync(join(repo, '.gitmodules'), '[submodule "cart"]\n\tpath = cart\n\turl = git@example.com:private/cart.git\n')
  mkdirSync(join(repo, 'cart'))
  profile({ dev: [{ cwd: '.', run: 'bun {skill}/scripts/shopify.ts theme dev --store {store}' }, { cwd: 'cart', run: 'bun run dev' }] })
  expect(script('dev.ts').json()).toMatchObject({ ok: true })
  expect(script('dev.ts', 'stop').json()).toEqual({ ok: true, stopped: 1 })
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

test('start.ts --update works on a branch started before the theme was set up', () => {
  const remote = join(dir, 'remote.git')
  git(dir, 'init', '-q', '--bare', '-b', 'main', remote)
  git(repo, 'remote', 'add', 'origin', remote)
  write('sections/hero.liquid', '<h1>Hi</h1>\n')
  commit('init')
  git(repo, 'push', '-q', '-u', 'origin', 'main')
  git(repo, 'remote', 'set-head', 'origin', 'main')
  // Work started before setup, so this branch has no profile.
  git(repo, 'switch', '-qc', 'old-work')
  write('sections/hero.liquid', '<h1>Old work</h1>\n')
  commit('Old work')
  // Setup happened on main afterwards.
  git(repo, 'switch', '-q', 'main')
  profile()
  commit('Set up themesmith')
  git(repo, 'push', '-q', 'origin', 'main')
  git(repo, 'switch', '-q', 'old-work')
  expect(existsSync(join(repo, '.agents/themesmith.json'))).toBe(false)

  const r = script('start.ts', '--update').json()
  expect(r.ok).toBe(true)
  // The merge brought the profile in, ready for the save that commits it.
  expect(existsSync(join(repo, '.agents/themesmith.json'))).toBe(true)
  expect(existsSync(join(repo, '.git/MERGE_HEAD'))).toBe(true)
  // Without --update, a branch without a profile still needs setup.
  git(repo, 'merge', '--abort')
  expect(script('start.ts', '--continue').code).not.toBe(0)
})

test('theme-check.ts fails only on errors the change added, listing the ones the file already had', () => {
  profile()
  write('sections/legacy.liquid', "<h1>Old</h1>\n{% render 'gone-snippet' %}\n")
  commit('legacy theme')
  git(repo, 'checkout', '-qb', 'work')

  write('sections/legacy.liquid', "<h1>New heading</h1>\n<p>More</p>\n{% render 'gone-snippet' %}\n")
  const touched = script('theme-check.ts', 'sections/legacy.liquid')
  expect(touched.code).toBe(0)
  expect(touched.stdout).toContain('earlier sections/legacy.liquid:3')
  expect(touched.stdout).toContain('0 errors, 0 warnings. 1 more error was already in these files before this work')

  write('sections/legacy.liquid', "<h1>New heading</h1>\n{% render 'new-missing' %}\n{% render 'gone-snippet' %}\n")
  const added = script('theme-check.ts', 'sections/legacy.liquid')
  expect(added.code).toBe(1)
  expect(added.stdout).toContain("error   sections/legacy.liquid:2  'snippets/new-missing.liquid' does not exist (MissingTemplate)")
})

test('suggests a Tailwind CLI build, marks what it writes as built, and leaves out scripts that run the Shopify CLI', async () => {
  write(
    'package.json',
    JSON.stringify({
      scripts: {
        build: 'tailwindcss -i src/app.css -o ./assets/app.css --minify',
        dev: 'tailwindcss -i src/app.css -o assets/app.css --watch',
        start: 'shopify theme dev',
        package: 'shopify theme package',
      },
    })
  )
  write('package-lock.json', '{}')
  commit('init')
  expect(await suggestProfile(repo)).toMatchObject({
    dev: [
      { cwd: '.', run: 'bun {skill}/scripts/shopify.ts theme dev --store {store}' },
      { cwd: '.', run: 'npm run dev' },
    ],
    build: [{ cwd: '.', run: 'npm run build' }],
    generated: ['assets/app.css'],
  })
})

test('does not start a second preview from a dev script that runs `shopify theme dev` through other scripts', async () => {
  write('package.json', JSON.stringify({ scripts: { dev: 'run-p dev:*', 'dev:theme': 'shopify theme dev', 'dev:css': 'tailwindcss -o assets/app.css --watch' } }))
  commit('init')
  expect((await suggestProfile(repo)).dev).toEqual([{ cwd: '.', run: 'bun {skill}/scripts/shopify.ts theme dev --store {store}' }])
})

test('theme-check.ts --all checks a theme in a dot-folder through a link, and reports its files by theme path', () => {
  const hidden = join(dir, '.worktrees', 'theme')
  mkdirSync(hidden, { recursive: true })
  repo = hidden
  profile()
  write('sections/hero.liquid', '<h1>Hi</h1>\n')
  installShopify(`const a = process.argv.slice(2)
const path = a[a.indexOf('--path') + 1]
require('fs').writeFileSync(${JSON.stringify(join(dir, 'check-path'))}, path)
console.log(JSON.stringify({ issues: [{ filePath: path + '/sections/hero.liquid', check: 'MissingTemplate', severity: 'error', startRow: 2, message: 'broken' }] }))
`)
  const r = script('theme-check.ts', '--all')
  expect(readFileSync(join(dir, 'check-path'), 'utf8')).not.toContain('/.worktrees/')
  expect(r.stdout).toContain('error   sections/hero.liquid:2  broken (MissingTemplate)')
})

test('a GitHub remote behind an SSH host alias counts as GitHub', async () => {
  // ssh -G, as it answers with `Host github-work` / `HostName github.com` in ~/.ssh/config.
  installCommand(join(dir, 'bin'), 'ssh', "const host = process.argv[3]\nconsole.log(`hostname ${host === 'github-work' ? 'github.com' : host}`)\n")
  git(repo, 'remote', 'add', 'origin', 'git@github-work:acme/theme.git')
  commit('init')
  const path = process.env.PATH
  process.env.PATH = pathWith(join(dir, 'bin'))
  try {
    expect((await suggestProfile(repo)).mode).toBe('github')
    git(repo, 'remote', 'set-url', 'origin', 'git@gitlab.com:acme/theme.git')
    expect((await suggestProfile(repo)).mode).toBe('cli')
  } finally {
    process.env.PATH = path
  }
})
