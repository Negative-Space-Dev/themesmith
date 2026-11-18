import { afterEach, beforeEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const DOCTOR = resolve(import.meta.dir, '../scripts/doctor.ts')
let dir: string
let theme: string

type Tool = { name: string; state: string; version: string | null }
type Item = { name: string; label: string; status: string; detail?: string; needs: string }
type Report = { ready: boolean; chart: string; confirm?: string; tools: Tool[]; theme: Item[]; accounts: Item[] }

function write(file: string, content: string) {
  mkdirSync(dirname(file), { recursive: true })
  writeFileSync(file, content)
}

// A Shopify CLI linked like a global install: reports `version`, lists no themes, and passes Theme Check.
function installShopify(version: string) {
  write(
    join(dir, 'bin/cli/run.ts'),
    `const a = process.argv.slice(2)
if (a[0] === 'version') console.log(${JSON.stringify(`\n${version}`)})
else if (a[1] === 'list') console.log(JSON.stringify({ themes: [] }))
else if (a[1] === 'check' && a.includes('--init')) require('fs').writeFileSync(a[a.indexOf('--path') + 1] + '/.theme-check.yml', 'extends: theme-check:recommended\\n')
else if (a[1] === 'check') console.log(JSON.stringify({ valid: true, issues: [], errorCount: 0, warningCount: 0, infoCount: 0 }))
`
  )
  // Bun.which, like a shell, only finds executable files.
  chmodSync(join(dir, 'bin/cli/run.ts'), 0o755)
  symlinkSync(join(dir, 'bin/cli/run.ts'), join(dir, 'bin/shopify'))
}

function doctor(args: string[] = [], env: Record<string, string> = {}) {
  const r = spawnSync('bun', [DOCTOR, ...args], {
    cwd: theme,
    encoding: 'utf8',
    // The store the Shopify CLI last used is read from its config folder: never the real one in tests.
    env: { ...process.env, PATH: `${join(dir, 'bin')}:${process.env.PATH}`, BUN_INSTALL_GLOBAL_DIR: join(dir, 'no-bun-global'), XDG_CONFIG_HOME: join(dir, 'config'), ...env },
  })
  try {
    return JSON.parse(r.stdout)
  } catch {
    throw new Error(`doctor printed no JSON:\n${r.stdout}\n${r.stderr}`)
  }
}

const profile = (extra: object = {}) =>
  write(
    join(theme, '.agents/themesmith.json'),
    JSON.stringify({
      store: 'example.myshopify.com',
      mode: 'cli',
      dev: [{ cwd: '.', run: 'shopify theme dev --store example.myshopify.com --poll' }],
      checks: [{ cwd: '.', run: 'bun {skill}/scripts/shopify.ts theme check --fail-level error' }],
      ...extra,
    })
  )

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'themesmith-doctor-'))
  theme = join(dir, 'theme')
  write(join(theme, 'sections/hero.liquid'), '<h1>Hi</h1>\n')
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

test('flags a Shopify CLI older than 5.0 in the chart', () => {
  installShopify('4.9.4')
  profile()
  const r: Report = doctor()
  expect(r.tools.find((t) => t.name === 'shopify')).toMatchObject({ state: 'outdated', version: '4.9.4' })
  expect(r.chart).toContain('| **Shopify CLI** | previews and uploads the theme | ⚠️ 4.9.4 is too old (needs 5.0.0+) | Update |')
  expect(r.ready).toBe(false)
})

test('accepts Shopify CLI 5, run on Bun', () => {
  installShopify('5.0.1')
  profile()
  const r: Report = doctor()
  expect(r.tools.find((t) => t.name === 'shopify')).toMatchObject({ state: 'ok', version: '5.0.1' })
  expect(r.chart).toContain('| **Bun** | runs the themesmith scripts | ✅ ')
})

test('names profile commands that need changing, and --fix changes them', () => {
  installShopify('5.0.1')
  profile()
  const before: Report = doctor()
  expect(before.theme.find((i) => i.name === 'profile commands')).toMatchObject({ status: 'missing' })
  expect(before.theme.find((i) => i.name === 'profile commands')!.detail).toContain('→ `bun {skill}/scripts/shopify.ts theme dev --store example.myshopify.com`')

  const fixed = doctor(['--fix'])
  expect(fixed.ok).toBe(true)
  const saved = JSON.parse(readFileSync(join(theme, '.agents/themesmith.json'), 'utf8'))
  expect(saved.dev[0].run).toBe('bun {skill}/scripts/shopify.ts theme dev --store example.myshopify.com')
  expect(saved.checks[0].run).toBe('bun {skill}/scripts/theme-check.ts {files}')
})

test('flags an old automation token set beside the new one, which Shopify CLI 5 refuses to run with', () => {
  installShopify('5.0.1')
  profile()
  const r: Report = doctor([], { SHOPIFY_CLI_PARTNERS_TOKEN: 'x', SHOPIFY_SERVICE_ACCOUNT_TOKEN: 'x' })
  expect(r.accounts.find((i) => i.name === 'shopify tokens')!.detail).toContain('Unset SHOPIFY_CLI_PARTNERS_TOKEN')
})

test('before setup, lists what setup will do and the profile it would save for the person to confirm', () => {
  installShopify('5.0.1')
  write(join(theme, 'README.md'), 'Run `shopify theme dev --store mystore.myshopify.com`\n')
  const r: Report = doctor()
  expect(r.ready).toBe(false)
  expect(r.theme.find((i) => i.name === 'profile')).toMatchObject({ status: 'missing', needs: 'setup' })
  expect(r.theme.find((i) => i.name === 'agent rules')).toMatchObject({ status: 'missing' })
  expect(r.chart).toContain('| **Themesmith settings** | ❌ Setup will add it |')
  expect(r.confirm).toBe('- **Store:** mystore.myshopify.com\n- **Finished work:** goes to an unpublished copy of your theme, for you to publish.')
})

test('--fix sets up a new theme from the confirmed settings and lists the files it changed', () => {
  installShopify('5.0.1')
  const r = doctor(['--fix', '--store', 'mystore.myshopify.com'])
  expect(r).toMatchObject({ ok: true, themeSetup: { ok: true, profileSaved: true }, signIn: { shopify: { status: 'ok' } } })
  const saved = JSON.parse(readFileSync(join(theme, '.agents/themesmith.json'), 'utf8'))
  expect(saved).toMatchObject({ store: 'mystore.myshopify.com', mode: 'cli', checks: [{ cwd: '.', run: 'bun {skill}/scripts/theme-check.ts {files}' }] })
  const changed = JSON.parse(readFileSync(join(theme, '.themesmith/setup-files.json'), 'utf8'))
  expect(changed).toEqual(expect.arrayContaining(['.agents/themesmith.json', 'AGENTS.md', 'CLAUDE.md', '.theme-check.yml', '.shopifyignore']))
  expect(existsSync(join(theme, '.themesmith/jobs/theme-check.json'))).toBe(true)
})

test('the first setup run already ignores the folders setup and agents make', () => {
  installShopify('5.0.1')
  profile()
  expect(doctor(['--fix']).ok).toBe(true)
  expect(readFileSync(join(theme, '.theme-check.yml'), 'utf8')).toContain('  - .agents/**\n  - .claude/**\n  - .themesmith/**')
  expect(doctor().theme.find((i: Item) => i.name === 'theme check config')).toMatchObject({ status: 'ok' })
})

test('finds the store from the repository before the store the Shopify CLI last used', () => {
  installShopify('5.0.1')
  spawnSync('git', ['init', '-q', '-b', 'main'], { cwd: theme })
  spawnSync('git', ['remote', 'add', 'origin', 'git@github.com:acme/acme-audio.git'], { cwd: theme })
  // The CLI last used another store, and has also worked with this one.
  write(join(dir, 'config/shopify-cli-theme-conf-nodejs/config.json'), JSON.stringify({ themeStore: 'other-brand.myshopify.com' }))
  write(join(dir, 'config/shopify-cli-theme-store-password-nodejs/config.json'), JSON.stringify({ 'other-brand': 'x', 'acme-audio': 'x' }))
  expect(doctor().confirm).toStartWith('- **Store:** acme-audio.myshopify.com\n')

  // Two stores match the name and nothing settles it: the person picks.
  spawnSync('git', ['remote', 'set-url', 'origin', 'git@github.com:acme/acme.git'], { cwd: theme })
  write(join(dir, 'config/shopify-cli-theme-store-password-nodejs/config.json'), JSON.stringify({ 'acme-audio': 'x', 'acme-wholesale': 'x' }))
  expect(doctor().confirm).toStartWith('- **Store:** which one: acme-audio.myshopify.com or acme-wholesale.myshopify.com?\n')

  // Nothing matches: the last-used store, marked as a guess.
  spawnSync('git', ['remote', 'set-url', 'origin', 'git@github.com:acme/unrelated.git'], { cwd: theme })
  expect(doctor().confirm).toStartWith("- **Store:** other-brand.myshopify.com? (a guess: check it's this theme's store)\n")
})

test('--fix stops before changing anything when no store is known', () => {
  installShopify('5.0.1')
  const r = doctor(['--fix'])
  expect(r).toEqual({ ok: false, message: "Pass --store with the store's .myshopify.com address." })
  expect(existsSync(join(theme, '.agents/themesmith.json'))).toBe(false)
})
