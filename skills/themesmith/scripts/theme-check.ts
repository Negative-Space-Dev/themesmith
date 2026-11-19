// Theme Check for the files a change touched. Profile `checks` commands use it:
//   bun {skill}/scripts/theme-check.ts {files}      check these files (fast: about a second)
//   bun {skill}/scripts/theme-check.ts --all        check the whole theme with the Shopify CLI (slower)
//   bun {skill}/scripts/theme-check.ts --all --record   ...and save the result in .themesmith/jobs/theme-check.json
// Only Liquid and JSON files in the theme folders are checked, never files the build writes (`generated`).
// Checking files, it exits 1 only on errors the change added: an error the file already had before this work
// started (GitHub mode: where the branch left the default branch; CLI mode: the live theme at `theme.ts start`)
// is listed but doesn't block. With --all, every error fails. Warnings are listed but never fail.
import { spawnSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, resolve } from 'node:path'
import { defaultBranch } from './lib/branch.ts'
import { exec } from './lib/exec.ts'
import { findRoot, globMatch, loadProfile } from './lib/profile.ts'
import { SKILL_DIR } from './lib/run.ts'
import { runShopifyJson } from './lib/shopify.ts'
import { THEME_CHECK_PACKAGE } from './lib/tools.ts'

type Offense = { check: string; file: string; line: number; column: number; severity: 'error' | 'warning' | 'info'; message: string }
type CliIssue = { filePath: string; check: string; severity: string; startRow?: number; startColumn?: number; message: string }

const THEME_DIRS = ['assets', 'blocks', 'config', 'layout', 'locales', 'sections', 'snippets', 'templates']
// Past this many files the full check, which reads the theme once, is quicker than checking file by file.
const MAX_FILES = 150

const root = findRoot()
const profile = loadProfile(root)
const args = process.argv.slice(2)
const all = args.includes('--all')
const record = args.includes('--record')

const files = [
  ...new Set(
    args
      .filter((a) => !a.startsWith('--'))
      .map((f) => relative(root, resolve(process.cwd(), f)).replace(/\\/g, '/'))
      .filter((f) => THEME_DIRS.includes(f.split('/')[0]) && /\.(liquid|json)$/.test(f))
      .filter((f) => existsSync(join(root, f)) && !profile.generated.some((g) => globMatch(g, f)))
  ),
]

const libraryReady = existsSync(join(SKILL_DIR, 'node_modules', THEME_CHECK_PACKAGE, 'package.json'))

async function checkFiles(paths: string[], baseline?: string): Promise<Offense[]> {
  if (paths.length === 0) return []
  const lib = join(SKILL_DIR, 'scripts', 'lib')
  const r = await exec(['bun', `--tsconfig-override=${join(lib, 'tsconfig.isolated.json')}`, join(lib, 'theme-check-files.ts'), root, ...(baseline ? ['--baseline', baseline] : []), ...paths], { cwd: root })
  if (!r.ok) throw new Error(`Theme Check could not run:\n${r.stderr.split('\n').slice(-15).join('\n')}`)
  return JSON.parse(r.stdout) as Offense[]
}

async function checkAll(): Promise<Offense[]> {
  const r = runShopifyJson<{ issues: CliIssue[] }>(['theme', 'check', '--path', root, '--fail-level', 'error'], { cwd: root })
  if (r.kind === 'error') throw new Error(`Theme Check could not run: ${r.error.message}`)
  return r.result.issues.map((i) => ({
    check: i.check,
    file: relative(root, i.filePath).replace(/\\/g, '/'),
    line: i.startRow ?? 1,
    column: i.startColumn ?? 1,
    severity: i.severity === 'error' ? 'error' : i.severity === 'warning' ? 'warning' : 'info',
    message: i.message,
  }))
}

const full = all || files.length > MAX_FILES || (!libraryReady && files.length > 0)
if (!full && files.length === 0) {
  console.log('No theme files changed, so there is nothing for Theme Check to check.')
  process.exit(0)
}

// Each file as it was before this work started, or nothing for a file this work added.
function earlierVersions(): Map<string, string> {
  const out = new Map<string, string>()
  if (profile.mode === 'github') {
    const git = (...a: string[]) => spawnSync('git', a, { cwd: root, encoding: 'utf8' })
    const branch = defaultBranch(root) ?? 'main'
    const base = [`origin/${branch}`, branch].map((ref) => git('merge-base', 'HEAD', ref).stdout.trim()).find(Boolean)
    if (!base) return out
    for (const f of files) {
      const shown = git('show', `${base}:${f}`)
      if (shown.status === 0) out.set(f, shown.stdout)
    }
    return out
  }
  const statePath = join(root, '.themesmith', 'state.json')
  if (!existsSync(statePath)) return out
  const mirror = join(root, '.themesmith', 'mirror', String((JSON.parse(readFileSync(statePath, 'utf8')) as { live: { id: string } }).live.id))
  for (const f of files) if (existsSync(join(mirror, f))) out.set(f, readFileSync(join(mirror, f), 'utf8'))
  return out
}

// The errors each file already had before this work: what its earlier version gets reported, by check and
// message (lines move). Null when they can't be told apart, so every error counts as new.
async function earlierErrors(): Promise<Map<string, number> | null> {
  if (!libraryReady) return null
  const earlier = earlierVersions()
  const dir = mkdtempSync(join(tmpdir(), 'themesmith-check-'))
  try {
    for (const [f, text] of earlier) {
      mkdirSync(dirname(join(dir, f)), { recursive: true })
      writeFileSync(join(dir, f), text)
    }
    const counts = new Map<string, number>()
    for (const o of await checkFiles([...earlier.keys()], dir)) {
      if (o.severity === 'error') counts.set(errorKey(o), (counts.get(errorKey(o)) ?? 0) + 1)
    }
    return counts
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

const errorKey = (o: Offense) => `${o.file}\0${o.check}\0${o.message}`

let offenses: Offense[]
let earlier: Map<string, number> | null = null
try {
  ;[offenses, earlier] = await Promise.all([
    // Past MAX_FILES the whole theme is checked at once, but only the given files' results count.
    full ? checkAll().then((found) => (all ? found : found.filter((o) => files.includes(o.file)))) : checkFiles(files),
    all ? null : earlierErrors(),
  ])
} catch (error) {
  console.error((error as Error).message)
  process.exit(2)
}

const allErrors = offenses.filter((o) => o.severity === 'error')
const existing: Offense[] = []
const errors = allErrors.filter((o) => {
  const left = earlier?.get(errorKey(o)) ?? 0
  if (left === 0) return true
  earlier!.set(errorKey(o), left - 1)
  existing.push(o)
  return false
})
const warnings = offenses.filter((o) => o.severity === 'warning')
const scope = all ? 'the whole theme' : `${files.length} changed file${files.length === 1 ? '' : 's'}`
const summary =
  `Theme Check, ${scope}: ${errors.length} error${errors.length === 1 ? '' : 's'}, ${warnings.length} warning${warnings.length === 1 ? '' : 's'}.` +
  (existing.length ? ` ${existing.length} more error${existing.length === 1 ? ' was' : 's were'} already in these files before this work, so ${existing.length === 1 ? 'it doesn\'t' : 'they don\'t'} block it.` : '')

if (record) {
  const path = join(root, '.themesmith', 'jobs', 'theme-check.json')
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, `${JSON.stringify({ done: true, finishedAt: new Date().toISOString(), summary, errors, warningCount: warnings.length }, null, 2)}\n`)
}

for (const o of [...errors, ...warnings]) console.log(`${o.severity.padEnd(7)} ${o.file}:${o.line}  ${o.message} (${o.check})`)
for (const o of existing) console.log(`earlier ${o.file}:${o.line}  ${o.message} (${o.check}, already there before this work)`)
console.log(summary)
process.exit(errors.length > 0 ? 1 : 0)
