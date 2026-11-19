import { afterEach, beforeEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { chmodSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const SETUP = resolve(import.meta.dir, '../scripts/setup-tools.ts')
let repo: string

function write(file: string, content = '') {
  mkdirSync(dirname(join(repo, file)), { recursive: true })
  writeFileSync(join(repo, file), content)
}

function setup(...args: string[]) {
  const r = spawnSync('bun', [SETUP, ...args], { cwd: repo, encoding: 'utf8' })
  return JSON.parse(r.stdout) as {
    missingThemeCheckIgnores: { pattern: string; reason: string }[]
    missingInstructions: string[]
    applied: string[]
    packageDir: string
    liquidReady: boolean | null
    profile: { format: { cwd: string; run: string }[] }
  }
}

beforeEach(() => {
  repo = mkdtempSync(join(tmpdir(), 'themesmith-setup-'))
  spawnSync('git', ['init', '-q'], { cwd: repo })
  // Tooling already in place, so --apply only touches ignore lists.
  write('package.json', JSON.stringify({ devDependencies: { prettier: '3', '@shopify/prettier-plugin-liquid': '1' } }))
  write('node_modules/prettier/package.json', '{}')
  write('node_modules/@shopify/prettier-plugin-liquid/package.json', '{}')
  // Prettier's --file-info, as the real one answers it: Liquid only with the plugin in the config.
  write(
    'node_modules/.bin/prettier',
    `#!/usr/bin/env bun
const a = process.argv.slice(2)
const config = a.includes('--config') ? require('fs').readFileSync(a[a.indexOf('--config') + 1], 'utf8') : ''
console.log(JSON.stringify({ ignored: false, inferredParser: config.includes('prettier-plugin-liquid') ? 'liquid-html' : null }))
`
  )
  chmodSync(join(repo, 'node_modules/.bin/prettier'), 0o755)
  write('.prettierrc.json', JSON.stringify({ plugins: ['@shopify/prettier-plugin-liquid'] }))
  write('.theme-check.yml', 'extends: theme-check:recommended\n\nignore:\n  - node_modules/**\n\nRemoteAsset:\n  enabled: false\n')
  write('sections/hero.liquid')
  write('sections/quiz-recommendation.liquid')
  write('snippets/reploChunk.abc.0.liquid')
  write('templates/page.replo.abc.liquid')
  write('layout/theme.pagefly.liquid')
  write('apps/main.ts')
  write('README.md')
  write('preview.liquid')
})

afterEach(() => rmSync(repo, { recursive: true, force: true }))

test('lists folders outside the theme, root Liquid and JSON files, and page builder files found in the theme', () => {
  expect(setup().missingThemeCheckIgnores).toEqual([
    // The folders setup itself makes, which hold JSON files, whether or not they exist yet.
    { pattern: '.agents/**', reason: 'not part of the theme' },
    { pattern: '.claude/**', reason: 'not part of the theme' },
    { pattern: '.themesmith/**', reason: 'not part of the theme' },
    { pattern: '.prettierrc.json', reason: 'not part of the theme' },
    { pattern: 'apps/**', reason: 'not part of the theme' },
    { pattern: 'package.json', reason: 'not part of the theme' },
    { pattern: 'preview.liquid', reason: 'not part of the theme' },
    { pattern: 'snippets/replo*', reason: 'made by Replo' },
    { pattern: 'templates/*.replo.*', reason: 'made by Replo' },
    { pattern: 'layout/theme.pagefly*', reason: 'made by PageFly' },
  ])
})

test('adds them to the existing ignore list, keeping the rest of the file, and a second run changes nothing', () => {
  setup('--apply')
  expect(readFileSync(join(repo, '.theme-check.yml'), 'utf8')).toBe(
    'extends: theme-check:recommended\n\nignore:\n  - node_modules/**\n  - .agents/**\n  - .claude/**\n  - .themesmith/**\n  - .prettierrc.json\n  - apps/**\n  - package.json\n  - preview.liquid\n  - snippets/replo*\n  - templates/*.replo.*\n  - layout/theme.pagefly*\n\nRemoteAsset:\n  enabled: false\n'
  )
  expect(setup('--apply').applied.filter((a) => a.includes('.theme-check.yml'))).toEqual([])
})

test('counts patterns the config already has under another spelling as covered', () => {
  write('.theme-check.yml', 'ignore:\n  - node_modules/**\n  - .agents/**\n  - .claude/**\n  - .themesmith/**\n  - .prettierrc.json\n  - package.json\n  - apps/**\n  - preview.liquid\n  - snippets/replo*.liquid\n  - templates/*replo*.liquid\n  - layout/theme.pagefly.liquid\n')
  expect(setup().missingThemeCheckIgnores).toEqual([])
})

test('writes the rules block to AGENTS.md and makes CLAUDE.md import it, keeping what both already say', () => {
  write('.agents/themesmith.json', JSON.stringify({ store: 'example.myshopify.com', mode: 'github', protectedBranches: ['main*'] }))
  write('AGENTS.md', '# Notes\n\nKeep the hero image.\n')
  write('CLAUDE.md', 'Use tabs.\n')
  expect(setup().missingInstructions).toEqual(['AGENTS.md', 'CLAUDE.md'])
  setup('--apply')
  const agents = readFileSync(join(repo, 'AGENTS.md'), 'utf8')
  expect(agents.startsWith('# Notes\n\nKeep the hero image.\n\n<!-- themesmith:start -->\n\n## Shopify theme work\n')).toBe(true)
  expect(agents).toContain("Never push to `main*` unless the person confirms it the way the skill's safety rules require, never force-push")
  expect(readFileSync(join(repo, 'CLAUDE.md'), 'utf8')).toBe('@AGENTS.md\n\nUse tabs.\n')
  expect(setup().missingInstructions).toEqual([])
})

test('moves a theme set up under the theme-dev name to the themesmith names, and the rules block with it', () => {
  write('.agents/theme-dev.json', JSON.stringify({ store: 'example.myshopify.com', mode: 'cli' }))
  write('.agents/theme-dev.md', 'Leave the footer alone.\n')
  write('.theme-dev/state.json', '{}')
  write('.gitignore', 'node_modules/\n.theme-dev/\n')
  write('.shopifyignore', '.agents/**\r\n.theme-dev/**\r\n')
  write('AGENTS.md', '# Notes\n\n<!-- theme-dev:start -->\nUse the theme-dev skill.\n<!-- theme-dev:end -->\n\nMore notes.\n')
  setup('--apply')
  expect(JSON.parse(readFileSync(join(repo, '.agents/themesmith.json'), 'utf8')).store).toBe('example.myshopify.com')
  expect(readFileSync(join(repo, '.agents/themesmith.md'), 'utf8')).toBe('Leave the footer alone.\n')
  expect(readFileSync(join(repo, '.themesmith/state.json'), 'utf8')).toBe('{}')
  expect(existsSync(join(repo, '.agents/theme-dev.json')) || existsSync(join(repo, '.theme-dev'))).toBe(false)
  expect(readFileSync(join(repo, '.gitignore'), 'utf8')).toBe('node_modules/\n.themesmith/\n')
  expect(readFileSync(join(repo, '.shopifyignore'), 'utf8').startsWith('.agents/**\r\n.themesmith/**\r\n')).toBe(true)
  const agents = readFileSync(join(repo, 'AGENTS.md'), 'utf8')
  expect(agents).not.toContain('theme-dev')
  expect(agents.startsWith('# Notes\n\n<!-- themesmith:start -->\n\n## Shopify theme work\n\nUse the themesmith skill')).toBe(true)
  expect(agents.endsWith('<!-- themesmith:end -->\n\nMore notes.\n')).toBe(true)
  expect(setup().missingInstructions).toEqual([])
})

test('the rules block tells an agent without the skill how to install it for the whole computer', () => {
  write('.agents/themesmith.json', JSON.stringify({ store: 'example.myshopify.com', mode: 'github', protectedBranches: ['main'] }))
  setup('--apply')
  const agents = readFileSync(join(repo, 'AGENTS.md'), 'utf8')
  expect(agents).toContain('install it for this whole computer')
  expect(agents).toContain('`git clone https://github.com/Negative-Space-Dev/themesmith ~/themesmith`')
  expect(agents).not.toContain('private')
  expect(agents).toContain('3. `bun ~/themesmith/install.ts`')
  expect(agents).toContain('ask the person to start one')
})

test('a rules block a formatter reshaped still counts as written', () => {
  write('.agents/themesmith.json', JSON.stringify({ store: 'example.myshopify.com', mode: 'github', protectedBranches: ['main'] }))
  setup('--apply')
  const written = readFileSync(join(repo, 'AGENTS.md'), 'utf8')
  // Written the way Prettier formats Markdown: a blank line after the start marker.
  expect(written).toStartWith('<!-- themesmith:start -->\n\n## Shopify theme work\n')
  // Reflowed by a formatter (different line breaks and spacing, same words): nothing to do.
  write('AGENTS.md', written.replace(/\n\n## Shopify theme work\n\n/, '\n## Shopify theme work\n').replace(/\. /g, '.\n'))
  expect(setup().missingInstructions).toEqual([])
  expect(setup('--apply').applied.filter((a) => a.includes('AGENTS.md'))).toEqual([])
  // Changed words are still noticed.
  write('AGENTS.md', written.replace('Never push', 'Always push'))
  expect(setup().missingInstructions).toEqual(['AGENTS.md'])
})

test('loads the Liquid plugin in the format command when the theme\'s Prettier config leaves it out', () => {
  expect(setup().profile.format[0].run).not.toContain('--plugin')
  write('.prettierrc.json', JSON.stringify({ semi: false }))
  const r = setup()
  expect(r.liquidReady).toBe(false)
  expect(r.profile.format[0].run).toBe('bun x prettier --config .prettierrc.json --plugin @shopify/prettier-plugin-liquid --write {files}')
})

test('never picks a Shopify app\'s folder for the theme\'s formatter, even when it has Prettier', () => {
  write('package.json', JSON.stringify({ private: true }))
  write('app/package.json', JSON.stringify({ devDependencies: { prettier: '3' } }))
  write('app/shopify.app.toml', '')
  expect(setup().packageDir).toBe('.')
})
