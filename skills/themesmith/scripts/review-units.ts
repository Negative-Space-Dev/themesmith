// Splits this piece of work's changes into review units (a section with the snippets/blocks it renders, a page,
// a component) so each can go through the theme-code-review skill on its own. Prints JSON.
// GitHub mode: changes on this branch since it left <base>. CLI mode: theme files changed since `theme.ts start`,
// each covered whole (no Git history to narrow it).
// Units already reviewed, with no file changed since, are left out (listed in `alreadyReviewed`), so each round
// reviews only what is new. `changedLines` still covers the whole piece of work.
// Usage: bun review-units.ts [--base <ref>] [--all]   list the units to review (--all: include reviewed ones)
//        bun review-units.ts --done                    record that the units last listed have been reviewed, as they
//                                                      were when listed
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { basename, dirname, join } from 'node:path'
import { defaultBranch } from './lib/git.ts'
import { builderOf } from './lib/builders.ts'
import { findRoot, globMatch, loadProfile } from './lib/profile.ts'
import { differing, readIgnores, snapshot, type Snapshot } from './lib/snapshot.ts'

type UnitKind = 'section' | 'block' | 'snippet' | 'layout' | 'page' | 'component' | 'assets'
// Line ranges changed on this branch, per file. A new file is one range covering the whole file.
type Unit = { kind: UnitKind; name: string; files: string[]; changedLines: Record<string, [number, number][]> }
type Skipped = { file: string; reason: string }

// Matches the review CLI's own filter: it exits with an error when handed only files outside this set.
const REVIEWABLE = /\.(liquid|html?|js|mjs|cjs|ts|tsx|css)$/i

function git(...args: string[]): string {
  return spawnSync('git', args, { cwd: root, encoding: 'utf8' }).stdout ?? ''
}

function baseRef(): string {
  const flag = process.argv.indexOf('--base')
  if (flag !== -1 && process.argv[flag + 1]) return process.argv[flag + 1]
  const branch = defaultBranch(root) ?? 'main'
  // A repository not pushed to GitHub yet has only the local branch.
  return git('rev-parse', '--verify', '--quiet', `origin/${branch}`).trim() ? `origin/${branch}` : branch
}

function changedSinceStart(): string[] {
  const path = join(root, '.themesmith/state.json')
  if (!existsSync(path)) return []
  const start = (JSON.parse(readFileSync(path, 'utf8')) as { live: { local: Snapshot } }).live.local
  return differing(start, snapshot(root, readIgnores(root))).filter((f) => existsSync(join(root, f)))
}

function wholeFile(file: string): [number, number][] {
  return [[1, readFileSync(join(root, file), 'utf8').split('\n').length]]
}

function changedFiles(mergeBase: string): string[] {
  const committed = git('diff', '--name-only', '--diff-filter=d', mergeBase).split('\n')
  const untracked = git('ls-files', '--others', '--exclude-standard').split('\n')
  return [...new Set([...committed, ...untracked].filter(Boolean))].filter((f) => existsSync(join(root, f))).sort()
}

function changedLines(mergeBase: string, file: string): [number, number][] {
  const diff = git('diff', '-U0', mergeBase, '--', file)
  if (diff === '') return wholeFile(file)
  return [...diff.matchAll(/^@@ -\S+ \+(\d+)(?:,(\d+))? @@/gm)]
    .map((m) => [Number(m[1]), Number(m[1]) + Number(m[2] ?? 1) - 1] as [number, number])
    .filter(([start, end]) => end >= start)
}

function rendered(file: string): Set<string> {
  const source = readFileSync(join(root, file), 'utf8')
  const names = new Set<string>()
  for (const m of source.matchAll(/\{%-?\s*(?:render|include)\s+['"]([^'"]+)['"]/g)) names.add(`snippets/${m[1]}.liquid`)
  for (const m of source.matchAll(/\{%-?\s*content_for\s+['"]block['"]\s*,\s*type:\s*['"]([^'"]+)['"]/g)) names.add(`blocks/${m[1]}.liquid`)
  for (const m of source.matchAll(/"type"\s*:\s*"([^"@][^"]*)"/g)) names.add(`blocks/${m[1]}.liquid`)
  return names
}

// Follows render/block references, but only through files that changed on this branch.
function claim(start: string, changed: Set<string>, claimed: Set<string>): string[] {
  const files = [start]
  claimed.add(start)
  for (let i = 0; i < files.length; i++) {
    for (const dep of rendered(files[i])) {
      if (changed.has(dep) && !claimed.has(dep)) {
        claimed.add(dep)
        files.push(dep)
      }
    }
  }
  return files
}

const root = findRoot()
const profile = loadProfile(root)
const cli = profile.mode === 'cli'
const base = cli ? 'theme.ts start' : baseRef()
const mergeBase = cli ? '' : git('merge-base', 'HEAD', base).trim()
// Without a merge base every change would look already saved, and the review would silently cover nothing.
if (!cli && !mergeBase) {
  console.log(JSON.stringify({ ok: false, error: `Can't tell where this work started: "${base}" has no history in common with this branch. Pass --base <branch> with the branch this work started from.` }))
  process.exit(1)
}
const lines = (file: string) => (cli ? wholeFile(file) : changedLines(mergeBase, file))
const skipped: Skipped[] = []
const reviewable: string[] = []

for (const file of cli ? changedSinceStart() : changedFiles(mergeBase)) {
  const builder = builderOf(file)
  if (profile.generated.some((g) => globMatch(g, file))) skipped.push({ file, reason: 'generated by the build' })
  else if (builder) skipped.push({ file, reason: `made by ${builder}; change it in ${builder}` })
  else if (file.startsWith('.agents/') || file.startsWith('.claude/') || file.startsWith('.cursor/')) skipped.push({ file, reason: 'agent files' })
  else if (!REVIEWABLE.test(file)) skipped.push({ file, reason: 'not theme source the review covers' })
  else reviewable.push(file)
}

const changed = new Set(reviewable)
const claimed = new Set<string>()
const units: Omit<Unit, 'changedLines'>[] = []
const name = (file: string) => basename(file).replace(/\.[^.]+$/, '')

for (const file of reviewable.filter((f) => f.startsWith('sections/'))) units.push({ kind: 'section', name: name(file), files: claim(file, changed, claimed) })
for (const file of reviewable.filter((f) => /^templates\/.*\.liquid$/.test(f))) units.push({ kind: 'page', name: name(file), files: claim(file, changed, claimed) })
for (const file of reviewable.filter((f) => f.startsWith('layout/'))) units.push({ kind: 'layout', name: name(file), files: claim(file, changed, claimed) })
for (const file of reviewable.filter((f) => f.startsWith('blocks/') && !claimed.has(f))) units.push({ kind: 'block', name: name(file), files: claim(file, changed, claimed) })
for (const file of reviewable.filter((f) => f.startsWith('snippets/') && !claimed.has(f))) units.push({ kind: 'snippet', name: name(file), files: claim(file, changed, claimed) })

const assets = reviewable.filter((f) => f.startsWith('assets/'))
if (assets.length > 0) units.push({ kind: 'assets', name: 'assets', files: assets })

const components = new Map<string, string[]>()
for (const file of reviewable.filter((f) => !claimed.has(f) && !f.startsWith('assets/'))) {
  const parts = file.split('/')
  let key = parts.length > 2 ? parts.slice(0, 2).join('/') : parts[0]
  // An entry file (apps/entries/search.tsx) belongs with its component folder (apps/search/) when one exists.
  if (parts.length === 3 && parts[1] === 'entries' && existsSync(join(root, parts[0], name(file)))) key = `${parts[0]}/${name(file)}`
  components.set(key, [...(components.get(key) ?? []), file])
}
for (const [key, files] of components) units.push({ kind: 'component', name: key, files })

// What each file held when it was last reviewed, by content hash.
const reviewedPath = join(root, '.themesmith', 'reviewed.json')
const hash = (file: string) => createHash('sha256').update(readFileSync(join(root, file))).digest('hex')
const reviewed: Record<string, string> = existsSync(reviewedPath) ? JSON.parse(readFileSync(reviewedPath, 'utf8')) : {}

// What each listed file held when it was handed to the review. `--done` records these, not the files as they are
// then: edits made while the review ran weren't part of it, so the next round still lists them.
const listedPath = join(root, '.themesmith', 'review-listed.json')

if (process.argv.includes('--done')) {
  const listed: Record<string, string> = existsSync(listedPath) ? JSON.parse(readFileSync(listedPath, 'utf8')) : Object.fromEntries(units.flatMap((u) => u.files).map((f) => [f, hash(f)]))
  mkdirSync(dirname(reviewedPath), { recursive: true })
  writeFileSync(reviewedPath, `${JSON.stringify({ ...reviewed, ...listed }, null, 2)}\n`)
  rmSync(listedPath, { force: true })
  console.log(JSON.stringify({ ok: true, reviewed: units.filter((u) => u.files.some((f) => f in listed)).map((u) => u.name) }))
  process.exit(0)
}

const isReviewed = (u: Omit<Unit, 'changedLines'>) => !process.argv.includes('--all') && u.files.every((f) => reviewed[f] === hash(f))
const toReview = units.filter((u) => !isReviewed(u)).map((u) => ({ ...u, changedLines: Object.fromEntries(u.files.map((f) => [f, lines(f)])) }))
mkdirSync(dirname(listedPath), { recursive: true })
writeFileSync(listedPath, `${JSON.stringify(Object.fromEntries(toReview.flatMap((u) => u.files).map((f) => [f, hash(f)])), null, 2)}\n`)
console.log(JSON.stringify({ base, units: toReview, alreadyReviewed: units.filter(isReviewed).map((u) => u.name), skipped }, null, 2))
