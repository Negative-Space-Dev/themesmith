import { afterEach, beforeEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { bunCommand, installFakeShopify, pathWith, removeDir, windows } from './helpers.ts'

const SKILL_DIR = resolve(import.meta.dir, '..')
const DEV_TAG = '<script src="http://127.0.0.1:5173/main.ts"></script>\n'
const BUILT_TAG = '<script src="{{ \'main.js\' | asset_url }}"></script>\n'
let dir: string
let remote: string
let repo: string
// A fake store (see fake-shopify.ts) the preview theme is uploaded to.
let shop: string

function git(cwd: string, ...args: string[]) {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8' })
  return r.stdout.trim()
}

function setProfile(build: string) {
  writeFileSync(
    join(repo, '.agents/themesmith.json'),
    JSON.stringify({
      store: 'example.myshopify.com',
      mode: 'github',
      protectedBranches: ['main*'],
      build: [{ cwd: '.', run: build }],
      format: [{ cwd: '.', run: `${bunCommand(dir, 'format', "require('fs').appendFileSync('format.log', process.argv.slice(2).join(' ') + '\\n')\n")} {files}` }],
      devModeMarkers: [{ file: 'snippets/vite-tag.liquid', contains: '127.0.0.1' }],
    })
  )
}

const env = () => ({ ...process.env, PATH: pathWith(join(dir, 'bin')), FAKE_SHOPIFY: shop, BUN_INSTALL_GLOBAL_DIR: join(dir, 'no-bun-global') })
const themes = () => JSON.parse(readFileSync(join(shop, 'themes.json'), 'utf8')) as { id: number; name: string; role: string }[]
const previewFile = (file: string) => readFileSync(join(shop, 'themes', '101', file), 'utf8')

function save(...args: string[]) {
  const r = spawnSync('bun', [join(SKILL_DIR, 'scripts/save.ts'), ...args], { cwd: repo, encoding: 'utf8', env: env() })
  return { code: r.status, result: JSON.parse(r.stdout) as { ok: boolean; steps: { step: string; ok: boolean; detail?: string }[] } }
}

const fixBuild = () => bunCommand(dir, 'fix-build', `require('fs').writeFileSync('snippets/vite-tag.liquid', ${JSON.stringify(BUILT_TAG)})\n`)

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'themesmith-save-'))
  shop = join(dir, 'shop')
  installFakeShopify(join(dir, 'bin'), readFileSync(join(SKILL_DIR, 'tests/fake-shopify.ts'), 'utf8'))
  mkdirSync(join(shop, 'themes/100'), { recursive: true })
  writeFileSync(join(shop, 'themes.json'), JSON.stringify([{ id: 100, name: 'Live', role: 'live' }]))
  writeFileSync(join(shop, 'calls.log'), '')
  remote = join(dir, 'remote.git')
  repo = join(dir, 'repo')
  git(dir, 'init', '-q', '--bare', '-b', 'main', remote)
  git(dir, 'clone', '-q', remote, repo)
  git(repo, 'config', 'user.email', 'test@example.com')
  git(repo, 'config', 'user.name', 'Test')
  git(repo, 'checkout', '-qb', 'main')
  mkdirSync(join(repo, 'snippets'))
  mkdirSync(join(repo, 'sections'))
  writeFileSync(join(repo, 'snippets/vite-tag.liquid'), BUILT_TAG)
  writeFileSync(join(repo, 'sections/hero.liquid'), '<h1>Old</h1>\n')
  writeFileSync(join(repo, '.gitignore'), 'format.log\n')
  mkdirSync(join(repo, '.agents'), { recursive: true })
  setProfile(fixBuild())
  git(repo, 'add', '-A')
  git(repo, 'commit', '-qm', 'init')
  git(repo, 'push', '-q', 'origin', 'main')
  git(repo, 'checkout', '-qb', 'hero-text')
})

afterEach(() => removeDir(dir))

test('builds before pushing, so a dev-mode tag never reaches the branch', () => {
  writeFileSync(join(repo, 'snippets/vite-tag.liquid'), DEV_TAG)
  writeFileSync(join(repo, 'sections/hero.liquid'), '<h1>New</h1>\n')
  const { code, result } = save('--message', 'Update hero text')
  expect(code).toBe(0)
  expect(result.steps.map((s) => s.step)).toEqual(['format', 'build', 'dev mode check', 'commit', 'push', 'preview'])
  expect(git(remote, 'show', 'hero-text:snippets/vite-tag.liquid') + '\n').toBe(BUILT_TAG)
  expect(git(remote, 'show', 'hero-text:sections/hero.liquid')).toBe('<h1>New</h1>')
  expect(git(remote, 'log', '-1', '--format=%s', 'hero-text')).toBe('Update hero text')
})

test('refuses to commit or push when the build leaves dev mode behind', () => {
  setProfile('bun --version')
  writeFileSync(join(repo, 'snippets/vite-tag.liquid'), DEV_TAG)
  const { code, result } = save('--message', 'Update hero text')
  expect(code).toBe(1)
  expect(result.steps.at(-1)).toMatchObject({ step: 'dev mode check', ok: false })
  expect(result.steps.at(-1)!.detail).toContain('snippets/vite-tag.liquid still contains "127.0.0.1"')
  expect(git(repo, 'log', '-1', '--format=%s')).toBe('init')
  expect(git(remote, 'branch', '--list', 'hero-text')).toBe('')
})

test('formats only the changed files', () => {
  writeFileSync(join(repo, 'sections/hero.liquid'), '<h1>New</h1>\n')
  save('--message', 'Update hero text')
  expect(readFileSync(join(repo, 'format.log'), 'utf8')).toBe('sections/hero.liquid\n')
})

test('commits a change that only deletes a file', () => {
  rmSync(join(repo, 'sections/hero.liquid'))
  const { code } = save('--message', 'Remove hero section')
  expect(code).toBe(0)
  expect(git(remote, 'ls-tree', '--name-only', 'hero-text', 'sections/')).toBe('')
})

test('refuses to save on a protected branch', () => {
  git(repo, 'checkout', '-q', 'main')
  writeFileSync(join(repo, 'sections/hero.liquid'), '<h1>New</h1>\n')
  const { code, result } = save('--message', 'Update hero text')
  expect(code).toBe(1)
  expect(result.steps[0]).toMatchObject({ step: 'branch', ok: false })
  expect(git(remote, 'log', '-1', '--format=%s', 'main')).toBe('init')
})

test('saves to a protected branch only with the explicit override, still building first', () => {
  git(repo, 'checkout', '-q', 'main')
  writeFileSync(join(repo, 'sections/hero.liquid'), '<h1>New</h1>\n')
  writeFileSync(join(repo, 'snippets/vite-tag.liquid'), DEV_TAG)
  const { result } = save('--message', 'Update hero text', '--onto-protected-branch')
  expect(result.ok).toBe(true)
  expect(git(remote, 'log', '-1', '--format=%s', 'main')).toBe('Update hero text')
  expect(git(remote, 'show', 'main:snippets/vite-tag.liquid')).toBe(BUILT_TAG.trim())
})

test('pulls theme editor commits on the branch before pushing', () => {
  writeFileSync(join(repo, 'sections/hero.liquid'), '<h1>New</h1>\n')
  save('--message', 'Update hero text')
  const editor = join(dir, 'editor')
  git(dir, 'clone', '-q', '-b', 'hero-text', remote, editor)
  git(editor, 'config', 'user.email', 'bot@example.com')
  git(editor, 'config', 'user.name', 'shopify[bot]')
  mkdirSync(join(editor, 'config'), { recursive: true })
  writeFileSync(join(editor, 'config/settings_data.json'), '{}\n')
  git(editor, 'add', '-A')
  git(editor, 'commit', '-qm', 'Update from Shopify')
  git(editor, 'push', '-q')

  writeFileSync(join(repo, 'sections/hero.liquid'), '<h1>Newer</h1>\n')
  const { code, result } = save('--message', 'Tweak hero text')
  expect(code).toBe(0)
  expect(result.steps.map((s) => s.step)).toContain('pull')
  expect(git(remote, 'log', '--format=%s', 'hero-text').split('\n').slice(0, 2)).toEqual(['Tweak hero text', 'Update from Shopify'])
})

test('runs profile checks with {skill} replaced by the folder this skill is installed in', () => {
  const profile = JSON.parse(readFileSync(join(repo, '.agents/themesmith.json'), 'utf8'))
  profile.checks = [{ cwd: '.', run: `${bunCommand(dir, 'check', "require('fs').writeFileSync('check.log', process.argv[2])\n")} {skill}` }]
  writeFileSync(join(repo, '.agents/themesmith.json'), JSON.stringify(profile))
  writeFileSync(join(repo, '.gitignore'), 'format.log\ncheck.log\n')
  writeFileSync(join(repo, 'sections/hero.liquid'), '<h1>New</h1>\n')
  expect(save('--message', 'Update hero text').result.ok).toBe(true)
  expect(readFileSync(join(repo, 'check.log'), 'utf8')).toBe(SKILL_DIR)
})

test('without a connected theme, uploads the built theme to a development theme named after the branch', () => {
  writeFileSync(join(repo, 'snippets/vite-tag.liquid'), DEV_TAG)
  writeFileSync(join(repo, 'sections/hero.liquid'), '<h1>New</h1>\n')
  const { result } = save('--message', 'Update hero text') as { result: { ok: boolean; preview?: string; previewTheme?: object } }
  expect(result).toMatchObject({ ok: true, preview: 'https://example.myshopify.com/?preview_theme_id=101', previewTheme: { kind: 'development', name: 'hero-text' } })
  // Every file it committed, for the agent to check against what it changed.
  expect((result as { committed?: string[] }).committed).toEqual(['sections/hero.liquid'])
  expect(themes()).toEqual([
    { id: 100, name: 'Live', role: 'live' },
    { id: 101, name: 'hero-text', role: 'development' },
  ])
  expect(previewFile('snippets/vite-tag.liquid')).toBe(BUILT_TAG)
  // A note under the link suggests connecting the branch, which syncs both ways.
  const tip = (result as { connectTip?: string }).connectTip!
  expect(tip).toStartWith('Tip: connect branch `hero-text` from GitHub')
  expect(tip).toContain('https://example.myshopify.com/admin/themes')
  
  // The next save reuses the same development theme.
  writeFileSync(join(repo, 'sections/hero.liquid'), '<h1>Newer</h1>\n')
  expect(save('--message', 'Update hero text again').result.ok).toBe(true)
  expect(themes()).toHaveLength(2)
  expect(previewFile('sections/hero.liquid')).toBe('<h1>Newer</h1>\n')
})

test('uses the theme Shopify connected to the branch once the push reaches it', () => {
  // Like Shopify's GitHub integration: every push to the branch is copied into the connected theme.
  const connected = join(shop, 'themes/200')
  // Git runs hooks with its own sh, also on Windows, where that sh wants forward slashes.
  const to = connected.replace(/\\/g, '/')
  const log = join(dir, 'hook.log').replace(/\\/g, '/')
  writeFileSync(
    join(remote, 'hooks/post-receive'),
    `#!/bin/sh\nwhile read old new ref; do mkdir -p "${to}" && git --work-tree="${to}" checkout -f "$new" -- . 2>> "${log}"; echo "synced $new" >> "${log}"; done\n`
  )
  chmodSync(join(remote, 'hooks/post-receive'), 0o755)
  // An earlier save, before the branch was connected, made a development theme for it.
  writeFileSync(
    join(shop, 'themes.json'),
    JSON.stringify([
      { id: 100, name: 'Live', role: 'live' },
      { id: 200, name: 'remote/hero-text', role: 'unpublished' },
      { id: 300, name: 'hero-text', role: 'development' },
      { id: 301, name: 'another-branch', role: 'development' },
    ])
  )
  writeFileSync(join(repo, 'sections/hero.liquid'), '<h1>New</h1>\n')

  const { result } = save('--message', 'Update hero text') as { result: { ok: boolean; preview?: string; previewTheme?: object; connectTip?: string; steps: { step: string }[] } }
  if (!existsSync(join(connected, 'sections/hero.liquid'))) {
    throw new Error(`The stand-in GitHub sync didn't copy the push:\n${existsSync(join(dir, 'hook.log')) ? readFileSync(join(dir, 'hook.log'), 'utf8') : '(the hook never ran)'}`)
  }
  expect(result).toMatchObject({ ok: true, preview: 'https://example.myshopify.com/?preview_theme_id=200', previewTheme: { kind: 'connected', name: 'remote/hero-text' } })
  expect(result.connectTip).toBeUndefined()
  // The branch's own development theme is gone; another branch's stays.
  expect(result.steps.map((s) => s.step)).toContain('old preview')
  expect(themes().map((t) => t.name)).toEqual(['Live', 'remote/hero-text', 'another-branch'])
})

test('falls back to a development theme when the push never reaches the connected theme', () => {
  writeFileSync(join(shop, 'themes.json'), JSON.stringify([{ id: 100, name: 'Live', role: 'live' }, { id: 200, name: 'remote/hero-text', role: 'unpublished' }]))
  writeFileSync(join(repo, 'sections/hero.liquid'), '<h1>New</h1>\n')
  const r = spawnSync('bun', [join(SKILL_DIR, 'scripts/save.ts'), '--message', 'Update hero text'], { cwd: repo, encoding: 'utf8', env: { ...env(), THEMESMITH_SYNC_SECONDS: '1' } })
  expect(JSON.parse(r.stdout)).toMatchObject({ ok: true, preview: 'https://example.myshopify.com/?preview_theme_id=201', previewTheme: { kind: 'development', name: 'hero-text' } })
})

test('checks what Git is about to save for dev mode, not only the folder', () => {
  // A build that leaves the folder clean but has staged a dev-mode tag before it ran.
  writeFileSync(join(repo, 'snippets/vite-tag.liquid'), DEV_TAG)
  git(repo, 'add', 'snippets/vite-tag.liquid')
  setProfile(
    bunCommand(
      dir,
      'staged-dev-tag',
      `const { execSync } = require('child_process')
require('fs').writeFileSync('snippets/vite-tag.liquid', 'x')
execSync('git add snippets/vite-tag.liquid && git show :snippets/vite-tag.liquid')
require('fs').writeFileSync('.git/info/attributes', 'snippets/vite-tag.liquid filter=devtag')
execSync('git config filter.devtag.clean "printf http://127.0.0.1:5173"')
`
    )
  )
  const { code, result } = save('--message', 'Update hero text')
  expect(code).toBe(1)
  expect(result.steps.at(-1)).toMatchObject({ step: 'dev mode check', ok: false })
  expect(existsSync(join(shop, 'themes/101'))).toBe(false)
})

// Someone else's commit on the branch on GitHub that changes the same line as this work.
function conflictingGitHubCommit() {
  const other = join(dir, 'other')
  git(dir, 'clone', '-q', '-b', 'hero-text', remote, other)
  git(other, 'config', 'user.email', 'bot@example.com')
  git(other, 'config', 'user.name', 'shopify[bot]')
  writeFileSync(join(other, 'sections/hero.liquid'), '<h1>From the editor</h1>\n')
  git(other, 'commit', '-qam', 'Update from Shopify')
  git(other, 'push', '-q')
}

test('lists what GitHub has that a force-push would drop, and replaces it only with --force-with-lease', () => {
  writeFileSync(join(repo, 'sections/hero.liquid'), '<h1>New</h1>\n')
  save('--message', 'Update hero text')
  conflictingGitHubCommit()

  writeFileSync(join(repo, 'sections/hero.liquid'), '<h1>Mine</h1>\n')
  const stopped = save('--message', 'Tweak hero text') as { code: number; result: { ok: boolean; githubOnly?: string[]; steps: { step: string }[] } }
  expect(stopped.code).toBe(1)
  expect(stopped.result.steps.at(-1)).toMatchObject({ step: 'pull', ok: false })
  expect(stopped.result.githubOnly).toHaveLength(1)
  expect(stopped.result.githubOnly![0]).toEndWith(' Update from Shopify')
  expect(git(remote, 'log', '-1', '--format=%s', 'hero-text')).toBe('Update from Shopify')

  // The person confirmed replacing it.
  const forced = save('--message', 'Tweak hero text', '--force-with-lease')
  expect(forced.code).toBe(0)
  expect(forced.result.steps.find((s) => s.step === 'push')!.detail).toContain('replacing 1 commit(s) that were only on GitHub')
  expect(git(remote, 'log', '--format=%s', 'hero-text').split('\n').slice(0, 2)).toEqual(['Tweak hero text', 'Update hero text'])
  expect(git(remote, 'show', 'hero-text:sections/hero.liquid')).toBe('<h1>Mine</h1>')
})

test('a force-push with lease replaces nothing when someone pushed after the save fetched the branch', () => {
  writeFileSync(join(repo, 'sections/hero.liquid'), '<h1>New</h1>\n')
  save('--message', 'Update hero text')
  conflictingGitHubCommit()
  // Someone pushes again while this save is building, after it fetched the branch.
  const other = join(dir, 'other')
  writeFileSync(join(other, 'sections/late.liquid'), 'late\n')
  git(other, 'add', '-A')
  git(other, 'commit', '-qm', 'Pushed during the build')
  setProfile(
    bunCommand(
      dir,
      'build-then-push',
      `require('fs').writeFileSync('snippets/vite-tag.liquid', ${JSON.stringify(BUILT_TAG)})
Bun.sleepSync(1000)
require('child_process').execFileSync('git', ['-C', ${JSON.stringify(other)}, 'push', '-q'])
`
    )
  )

  writeFileSync(join(repo, 'sections/hero.liquid'), '<h1>Mine</h1>\n')
  const { code, result } = save('--message', 'Tweak hero text', '--force-with-lease')
  expect(code).toBe(1)
  expect(result.steps.at(-1)).toMatchObject({ step: 'push', ok: false })
  expect(git(remote, 'log', '-1', '--format=%s', 'hero-text')).toBe('Pushed during the build')
})

test('never force-pushes a protected branch, even when asked', () => {
  git(repo, 'checkout', '-q', 'main')
  writeFileSync(join(repo, 'sections/hero.liquid'), '<h1>New</h1>\n')
  const { code, result } = save('--message', 'Update hero text', '--force-with-lease', '--onto-protected-branch')
  expect(code).toBe(1)
  expect(result.steps.at(-1)).toMatchObject({ step: 'branch', ok: false })
  expect(git(remote, 'log', '-1', '--format=%s', 'main')).toBe('init')
})

const start = (...args: string[]) => {
  const r = spawnSync('bun', [join(SKILL_DIR, 'scripts/start.ts'), ...args], { cwd: repo, encoding: 'utf8', env: env() })
  return JSON.parse(r.stdout) as { ok: boolean; conflicts?: string[]; steps: { step: string; ok: boolean; detail?: string }[] }
}

// New commits on main on GitHub, made after the work branch started.
function advanceMain(file: string, content: string) {
  const other = join(dir, 'main-work')
  if (!existsSync(other)) git(dir, 'clone', '-q', '-b', 'main', remote, other)
  git(other, 'config', 'user.email', 'dev@example.com')
  git(other, 'config', 'user.name', 'Dev')
  git(other, 'pull', '-q')
  mkdirSync(join(other, file, '..'), { recursive: true })
  writeFileSync(join(other, file), content)
  git(other, 'add', '-A')
  git(other, 'commit', '-qm', `Change ${file} on main`)
  git(other, 'push', '-q')
  return git(other, 'rev-parse', 'HEAD')
}

test('start.ts --update brings main into the work branch as a merge, keeping main\'s commits as they are', () => {
  writeFileSync(join(repo, 'sections/hero.liquid'), '<h1>New</h1>\n')
  save('--message', 'Update hero text')
  const mainCommit = advanceMain('sections/footer.liquid', '<p>Footer from main</p>\n')

  const updated = start('--update')
  expect(updated.ok).toBe(true)
  expect(updated.steps.at(-1)!.detail).toContain('brought in 1 commit(s) from main')
  const { code, result } = save('--message', 'Bring in the latest main')
  expect(code).toBe(0)
  // No rebase: nothing new was on GitHub's copy of the branch.
  expect(result.steps.map((s) => s.step)).not.toContain('pull')
  // What the merge brought in is listed, for the agent to check.
  expect((result as { committed?: string[] }).committed).toEqual(['sections/footer.liquid'])
  // The pushed branch has a real merge commit, and main's commit is the same one, not a copy.
  expect(git(remote, 'rev-list', '--parents', '-n', '1', 'hero-text').split(' ')).toHaveLength(3)
  expect(git(remote, 'rev-list', 'hero-text').split('\n')).toContain(mainCommit)
  expect(git(remote, 'log', '--format=%s', 'hero-text').split('\n').filter((s) => s === 'Change sections/footer.liquid on main')).toHaveLength(1)
  expect(git(remote, 'show', 'hero-text:sections/footer.liquid')).toBe('<p>Footer from main</p>')
})

test('a merge commit survives when GitHub has new commits on the branch too', () => {
  writeFileSync(join(repo, 'sections/hero.liquid'), '<h1>New</h1>\n')
  save('--message', 'Update hero text')
  const mainCommit = advanceMain('sections/footer.liquid', '<p>Footer from main</p>\n')
  // Meanwhile a theme editor commit lands on the work branch on GitHub.
  const editor = join(dir, 'editor')
  git(dir, 'clone', '-q', '-b', 'hero-text', remote, editor)
  git(editor, 'config', 'user.email', 'bot@example.com')
  git(editor, 'config', 'user.name', 'shopify[bot]')
  mkdirSync(join(editor, 'config'), { recursive: true })
  writeFileSync(join(editor, 'config/settings_data.json'), '{}\n')
  git(editor, 'add', '-A')
  git(editor, 'commit', '-qm', 'Update from Shopify')
  git(editor, 'push', '-q')

  start('--update')
  const { code, result } = save('--message', 'Bring in the latest main')
  expect(code).toBe(0)
  expect(result.steps.find((s) => s.step === 'pull')!.detail).toContain('by merging')
  expect(git(remote, 'rev-list', 'hero-text').split('\n')).toContain(mainCommit)
  expect(git(remote, 'log', '--format=%s', 'hero-text')).toContain('Update from Shopify')
})

test('start.ts --update stops on conflicts, listing the files to combine', () => {
  writeFileSync(join(repo, 'sections/hero.liquid'), '<h1>New</h1>\n')
  save('--message', 'Update hero text')
  advanceMain('sections/hero.liquid', '<h1>From main</h1>\n')
  const r = start('--update')
  expect(r.ok).toBe(false)
  expect(r.conflicts).toEqual(['sections/hero.liquid'])
  expect(readFileSync(join(repo, 'sections/hero.liquid'), 'utf8')).toContain('<<<<<<<')
})

function setFormat(run: string) {
  const path = join(repo, '.agents/themesmith.json')
  writeFileSync(path, JSON.stringify({ ...JSON.parse(readFileSync(path, 'utf8')), format: [{ cwd: '.', run }] }))
}

// A formatter that can't read any file whose name has "legacy" in it, the way Prettier fails on broken HTML.
const pickyFormat = () =>
  `${bunCommand(
    dir,
    'picky-format',
    `const a = process.argv.slice(2)
const legacy = a.find((f) => f.includes('legacy'))
if (legacy) {
  console.error('[error] ' + legacy + ': LiquidHTMLParsingError: Attempting to close HtmlElement')
  process.exit(2)
}
require('fs').appendFileSync('format.log', a.join(' ') + '\\n')
`
  )} {files}`

test('saves a file the formatter cannot read as it is, naming it, and formats the rest', () => {
  setFormat(pickyFormat())
  writeFileSync(join(repo, 'sections/legacy.liquid'), '<div>\n')
  writeFileSync(join(repo, 'sections/hero.liquid'), '<h1>New</h1>\n')
  const { result } = save('--message', 'Hero text', '--no-push')
  expect(result.ok).toBe(true)
  expect(result.steps.find((s) => s.step === 'format')?.detail).toContain("left unformatted, because the formatter couldn't read them: sections/legacy.liquid")
  expect(readFileSync(join(repo, 'format.log'), 'utf8')).toContain('sections/hero.liquid')
})

test('a formatter that fails for any other reason still stops the save', () => {
  setFormat(`${bunCommand(dir, 'broken-format', "console.error('No parser could be inferred')\nprocess.exit(2)\n")} {files}`)
  writeFileSync(join(repo, 'sections/hero.liquid'), '<h1>New</h1>\n')
  const { result } = save('--message', 'Hero text', '--no-push')
  expect(result.ok).toBe(false)
  expect(result.steps.at(-1)).toMatchObject({ step: 'format', ok: false })
})

test('refuses to save files that still have conflict markers, saving nothing', () => {
  writeFileSync(join(repo, 'sections/hero.liquid'), '<<<<<<< HEAD\n<h1>Ours</h1>\n=======\n<h1>Theirs</h1>\n>>>>>>> origin/main\n')
  const { result } = save('--message', 'Hero text', '--no-push')
  expect(result.ok).toBe(false)
  expect(result.steps.at(-1)).toMatchObject({ step: 'conflicts', ok: false })
  expect(git(repo, 'log', '-1', '--format=%s')).toBe('init')
  expect(git(repo, 'diff', '--cached', '--name-only')).toBe('')
})

test('formats and saves a file whose name has an accent', () => {
  writeFileSync(join(repo, 'sections/café.liquid'), '<h1>Menu</h1>\n')
  const { result } = save('--message', 'Café section', '--no-push')
  expect(result.ok).toBe(true)
  expect(readFileSync(join(repo, 'format.log'), 'utf8')).toBe('sections/café.liquid\n')
})

test.skipIf(windows)('keeps a backslash that is part of a file name on Mac and Linux', () => {
  writeFileSync(join(repo, 'sections/a\\b.liquid'), '<p>odd name</p>\n')
  save('--message', 'Odd name', '--no-push')
  expect(readFileSync(join(repo, 'format.log'), 'utf8')).toBe('sections/a\\b.liquid\n')
})
