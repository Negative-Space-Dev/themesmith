// Detects where this repo keeps its Node tooling and what formatting/checking setup is missing.
// Without flags it only reports. With `--apply` it installs Prettier + the Liquid plugin where the repo's
// package.json already lives (or at the top level if there is none), writes missing configs, and fills
// in .shopifyignore and the AGENTS.md rules block. Prints JSON, including the profile `format` and `checks` entries to use.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { pathGlob, PAGE_BUILDERS } from './lib/builders.ts'
import { missingInstructions, writeInstructions } from './lib/instructions.ts'
import { loadProfile, PROFILE_PATH } from './lib/profile.ts'
import { migrateLegacyNames } from './lib/migrate.ts'
import { runShopify } from './lib/shopify.ts'

type PackageManager = 'bun' | 'npm' | 'pnpm' | 'yarn'
const EXEC: Record<PackageManager, string> = { bun: 'bun x', npm: 'npx', pnpm: 'pnpm exec', yarn: 'yarn' }

type Tooling = {
  packageDir: string
  packageJsonExists: boolean
  packageManager: PackageManager
  missingPackages: string[]
  installed: boolean
  prettierConfig: string | null
  // Whether Prettier, with the theme's config, formats Liquid. A config without the Liquid plugin doesn't, so the
  // format command then loads the plugin itself. Null until Prettier is installed.
  liquidReady: boolean | null
  themeCheckConfig: boolean
  // Patterns .theme-check.yml should ignore and doesn't: everything outside the theme folders, and page builder files.
  missingThemeCheckIgnores: { pattern: string; reason: string }[]
  missingIgnores: string[]
  // Git should not track .themesmith/: the preview, sign-ins and CLI-mode sync keep their state there.
  stateGitignored: boolean
  // AGENTS.md and CLAUDE.md, when they lack the rules block for this profile. Empty until a profile exists.
  missingInstructions: string[]
}

const PRETTIER_PACKAGES = ['prettier', '@shopify/prettier-plugin-liquid']
const PRETTIER_CONFIGS = [
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.yaml',
  '.prettierrc.yml',
  '.prettierrc.json5',
  '.prettierrc.js',
  '.prettierrc.cjs',
  '.prettierrc.mjs',
  '.prettierrc.ts',
  'prettier.config.js',
  'prettier.config.cjs',
  'prettier.config.mjs',
  'prettier.config.ts',
]
const LOCKFILES: [string, PackageManager][] = [
  ['bun.lock', 'bun'],
  ['bun.lockb', 'bun'],
  ['pnpm-lock.yaml', 'pnpm'],
  ['yarn.lock', 'yarn'],
  ['package-lock.json', 'npm'],
]
const THEME_DIRS = new Set(['assets', 'blocks', 'config', 'layout', 'locales', 'sections', 'snippets', 'templates'])
const SKIP_DIRS = new Set(['node_modules', '.git', ...THEME_DIRS])
// Root files the Shopify CLI does not already skip on push (it skips .git, .vscode, node_modules/, .prettierrc.json).
const ROOT_FILE_IGNORES = [
  'package.json',
  ...LOCKFILES.map(([file]) => file),
  ...PRETTIER_CONFIGS.filter((c) => c !== '.prettierrc.json'),
  '.prettierignore',
  '.theme-check.yml',
  'AGENTS.md',
  'CLAUDE.md',
]
const AGENT_IGNORES = ['.agents/**', '.claude/**', '.cursor/**', '.codex/**', '.themesmith/**']
const SETUP_DIRS = ['.agents', '.claude', '.themesmith']

const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim() || process.cwd()
migrateLegacyNames(root)
const apply = process.argv.includes('--apply')

function packageJsonDirs(dir: string, depth: number): string[] {
  const found = existsSync(join(dir, 'package.json')) ? [dir] : []
  if (depth === 0) return found
  const children = readdirSync(dir, { withFileTypes: true })
    .filter((e) => e.isDirectory() && !SKIP_DIRS.has(e.name) && !e.name.startsWith('.'))
    .flatMap((e) => packageJsonDirs(join(dir, e.name), depth - 1))
  return [...found, ...children]
}

function readPackageJson(dir: string): Record<string, any> | null {
  const path = join(dir, 'package.json')
  return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null
}

function declaredDeps(dir: string): Set<string> {
  const pkg = readPackageJson(dir) ?? {}
  return new Set([...Object.keys(pkg.dependencies ?? {}), ...Object.keys(pkg.devDependencies ?? {})])
}

// Prefer the folder that already has Prettier, then one with installed node_modules, then the top level. A Shopify
// app in the same repository has its own tooling, so it's never the theme's.
function choosePackageDir(): string {
  const dirs = packageJsonDirs(root, 2).filter((d) => !existsSync(join(d, 'shopify.app.toml')))
  return (
    dirs.find((d) => declaredDeps(d).has('prettier')) ??
    dirs.find((d) => existsSync(join(d, 'node_modules'))) ??
    dirs.find((d) => d === root) ??
    dirs[0] ??
    root
  )
}

function findPrettierConfig(dirs: string[]): string | null {
  for (const dir of dirs) {
    const file = PRETTIER_CONFIGS.find((c) => existsSync(join(dir, c)))
    if (file) return join(dir, file)
    if (readPackageJson(dir)?.prettier) return join(dir, 'package.json')
  }
  return null
}

// Whether a package loads from `dir`, wherever the package manager put it: in the folder's node_modules, hoisted
// to a workspace's, or in Yarn Plug'n'Play's cache.
function resolvable(pkg: string, dir: string): boolean {
  if (existsSync(join(dir, 'node_modules', pkg, 'package.json'))) return true
  try {
    Bun.resolveSync(pkg, dir)
    return true
  } catch {
    return [dir, root].some((d) => existsSync(join(d, '.pnp.cjs'))) && declaredDeps(dir).has(pkg)
  }
}

const LIQUID_PLUGIN = '@shopify/prettier-plugin-liquid'

function formatsLiquid(packageDir: string, manager: PackageManager, config: string | null): boolean | null {
  const configArg = config ? ` --config "${relative(packageDir, config)}"` : ''
  const r = spawnSync(`${EXEC[manager]} prettier${configArg} --file-info sections/themesmith-probe.liquid`, { cwd: packageDir, encoding: 'utf8', shell: true, timeout: 30_000 })
  try {
    return (JSON.parse(r.stdout) as { inferredParser: string | null }).inferredParser === 'liquid-html'
  } catch {
    return null
  }
}

function gitignoreLines(): string[] {
  const path = join(root, '.gitignore')
  return existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/).map((l) => l.trim()) : []
}

function appendLines(file: string, lines: string[]) {
  const path = join(root, file)
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const sep = existing === '' || existing.endsWith('\n') ? '' : '\n'
  writeFileSync(path, `${existing}${sep}${lines.join('\n')}\n`)
}

const THEME_CHECK_CONFIG = '.theme-check.yml'

// The items of the block-style `ignore:` list, which is the form `shopify theme check --init` writes.
function themeCheckIgnores(): string[] {
  const path = join(root, THEME_CHECK_CONFIG)
  if (!existsSync(path)) return []
  const lines = readFileSync(path, 'utf8').split(/\r?\n/)
  const start = lines.findIndex((l) => /^ignore:\s*$/.test(l))
  if (start === -1) return []
  const items: string[] = []
  for (const line of lines.slice(start + 1)) {
    const item = line.match(/^\s+-\s+["']?(.*?)["']?\s*$/)
    if (!item) break
    items.push(item[1])
  }
  return items
}

function themeFiles(): string[] {
  const out: string[] = []
  const walk = (rel: string) => {
    for (const e of readdirSync(join(root, rel), { withFileTypes: true })) {
      if (e.isDirectory()) walk(`${rel}/${e.name}`)
      else out.push(`${rel}/${e.name}`)
    }
  }
  for (const dir of THEME_DIRS) if (existsSync(join(root, dir))) walk(dir)
  return out
}

function missingThemeCheckIgnores(): { pattern: string; reason: string }[] {
  const existing = themeCheckIgnores()
  const covered = (path: string) => existing.some((p) => pathGlob(p, path))
  const missing: { pattern: string; reason: string }[] = []
  // Folders setup itself makes: its settings and the skills copied into the theme (.agents), Claude Code's pointer
  // skills (.claude) and its state (.themesmith). They hold JSON files and may not exist yet when this runs, so
  // the first run already ignores them all.
  for (const dir of SETUP_DIRS) if (!covered(`${dir}/x`)) missing.push({ pattern: `${dir}/**`, reason: 'not part of the theme' })
  const entries = readdirSync(root, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))
  for (const e of entries) {
    // Theme Check reads Liquid and JSON files; other top-level files never reach it.
    if (THEME_DIRS.has(e.name) || e.name === '.git' || SETUP_DIRS.includes(e.name) || (!e.isDirectory() && !/\.(liquid|json)$/.test(e.name))) continue
    const [pattern, probe] = e.isDirectory() ? [`${e.name}/**`, `${e.name}/x`] : [e.name, e.name]
    if (!covered(probe)) missing.push({ pattern, reason: 'not part of the theme' })
  }
  const files = themeFiles()
  for (const builder of PAGE_BUILDERS) {
    for (const pattern of builder.patterns) {
      if (files.some((f) => pathGlob(pattern, f) && !covered(f))) missing.push({ pattern, reason: `made by ${builder.name}` })
    }
  }
  return missing
}

function addThemeCheckIgnores(patterns: string[]) {
  const path = join(root, THEME_CHECK_CONFIG)
  const lines = readFileSync(path, 'utf8').split('\n')
  const start = lines.findIndex((l) => /^ignore:\s*$/.test(l))
  if (start === -1) {
    if (lines.some((l) => /^ignore:/.test(l))) throw new Error(`${THEME_CHECK_CONFIG} lists ignore patterns inline; write them as a "- pattern" list so setup can add to it.`)
    appendLines(THEME_CHECK_CONFIG, ['', 'ignore:', ...patterns.map((p) => `  - ${p}`)])
    return
  }
  let end = start + 1
  while (end < lines.length && /^\s+-\s/.test(lines[end])) end++
  lines.splice(end, 0, ...patterns.map((p) => `  - ${p}`))
  writeFileSync(path, lines.join('\n'))
}

function readIgnores(): string[] {
  const path = join(root, '.shopifyignore')
  return existsSync(path) ? readFileSync(path, 'utf8').split(/\r?\n/).map((l) => l.trim()) : []
}

function detect(): Tooling {
  const packageDir = choosePackageDir()
  const deps = declaredDeps(packageDir)
  const lock = LOCKFILES.find(([file]) => existsSync(join(packageDir, file)))
  const packageRel = relative(root, packageDir)
  const wanted = [
    ...ROOT_FILE_IGNORES.filter((f) => existsSync(join(root, f))),
    ...AGENT_IGNORES,
    ...(packageRel && !THEME_DIRS.has(packageRel) ? [`${packageRel}/**`] : []),
  ]
  const present = new Set(readIgnores())
  const packageManager = lock?.[1] ?? 'bun'
  const installed = PRETTIER_PACKAGES.every((p) => resolvable(p, packageDir))
  const prettierConfig = findPrettierConfig(packageDir === root ? [root] : [packageDir, root])
  return {
    packageDir,
    packageJsonExists: existsSync(join(packageDir, 'package.json')),
    packageManager,
    missingPackages: PRETTIER_PACKAGES.filter((p) => !deps.has(p)),
    installed,
    prettierConfig,
    liquidReady: installed && prettierConfig ? formatsLiquid(packageDir, packageManager, prettierConfig) : null,
    themeCheckConfig: existsSync(join(root, '.theme-check.yml')),
    missingThemeCheckIgnores: missingThemeCheckIgnores(),
    missingIgnores: wanted.filter((p) => !present.has(p)),
    stateGitignored: !existsSync(join(root, '.git')) || gitignoreLines().some((l) => /^\/?\.themesmith\/?(\*\*)?$/.test(l)),
    missingInstructions: existsSync(join(root, PROFILE_PATH)) ? missingInstructions(root, loadProfile(root)) : [],
  }
}

function run(cmd: string, args: string[], cwd: string) {
  const r = spawnSync(cmd, args, { cwd, encoding: 'utf8', shell: process.platform === 'win32' })
  if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed in ${cwd}:\n${r.stdout}${r.stderr}`)
}

const ADD_DEV: Record<PackageManager, [string, string[]]> = {
  bun: ['bun', ['add', '-d']],
  npm: ['npm', ['install', '-D']],
  pnpm: ['pnpm', ['add', '-D']],
  yarn: ['yarn', ['add', '-D']],
}

function applyFixes(t: Tooling): string[] {
  const done: string[] = []
  if (!t.packageJsonExists) {
    writeFileSync(join(t.packageDir, 'package.json'), `${JSON.stringify({ name: 'theme', private: true }, null, 2)}\n`)
    done.push(`created ${relative(root, join(t.packageDir, 'package.json'))}`)
  }
  if (t.missingPackages.length > 0) {
    const [cmd, args] = ADD_DEV[t.packageManager]
    run(cmd, [...args, ...t.missingPackages], t.packageDir)
    done.push(`installed ${t.missingPackages.join(', ')} with ${t.packageManager}`)
  } else if (!t.installed) {
    run(t.packageManager, ['install'], t.packageDir)
    done.push(`ran ${t.packageManager} install in ${relative(root, t.packageDir) || '.'}`)
  }
  if (!t.prettierConfig) {
    const path = join(t.packageDir, '.prettierrc.json')
    writeFileSync(path, `${JSON.stringify({ plugins: ['@shopify/prettier-plugin-liquid'] }, null, 2)}\n`)
    t.prettierConfig = path
    done.push(`created ${relative(root, path)}`)
  }
  if (!t.themeCheckConfig) {
    const init = runShopify(['theme', 'check', '--init', '--path', root], { cwd: root })
    if (!init.ok) throw new Error(`shopify theme check --init failed:\n${init.out}`)
    done.push('created .theme-check.yml')
  }
  // The rules files are written first, so the ignore lists below include them.
  if (t.missingInstructions.length > 0) {
    for (const file of writeInstructions(root, loadProfile(root))) done.push(`wrote the themesmith rules to ${file}`)
  }
  const { missingIgnores, missingThemeCheckIgnores: themeCheck } = detect()
  if (themeCheck.length > 0) {
    addThemeCheckIgnores(themeCheck.map((m) => m.pattern))
    done.push(`added ${themeCheck.length} ignore patterns to .theme-check.yml`)
  }
  if (missingIgnores.length > 0) {
    appendLines('.shopifyignore', missingIgnores)
    done.push(`added ${missingIgnores.length} entries to .shopifyignore`)
  }
  if (!t.stateGitignored) {
    appendLines('.gitignore', ['.themesmith/'])
    done.push('added .themesmith/ to .gitignore')
  }
  return done
}

const tooling = detect()
const applied = apply ? applyFixes(tooling) : []
const after = apply ? detect() : tooling
const cwd = relative(root, after.packageDir) || '.'
const configArg = after.prettierConfig ? ` --config ${relative(after.packageDir, after.prettierConfig)}` : ''
const pluginArg = after.liquidReady === false ? ` --plugin ${LIQUID_PLUGIN}` : ''

console.log(
  JSON.stringify(
    {
      packageDir: cwd,
      packageManager: after.packageManager,
      missingPackages: after.missingPackages,
      installed: after.installed,
      prettierConfig: after.prettierConfig ? relative(root, after.prettierConfig) : null,
      liquidReady: after.liquidReady,
      themeCheckConfig: after.themeCheckConfig,
      missingThemeCheckIgnores: after.missingThemeCheckIgnores,
      missingIgnores: after.missingIgnores,
      stateGitignored: after.stateGitignored,
      missingInstructions: after.missingInstructions,
      applied,
      profile: {
        format: [{ cwd, run: `${EXEC[after.packageManager]} prettier${configArg}${pluginArg} --write {files}` }],
        checks: [{ cwd: '.', run: 'bun {skill}/scripts/theme-check.ts {files}' }],
      },
    },
    null,
    2
  )
)
