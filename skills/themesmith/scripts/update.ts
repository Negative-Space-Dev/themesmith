// Installs skills from an upstream repo into a theme's .agents/skills, and later applies upstream changes on top
// of that copy's own edits. .agents/themesmith.lock.json records, per skill, where it came from, the version it
// was last taken at, and a fingerprint of each file it installed.
//
// The upstream is a Git URL, or a folder on this computer (a themesmith checkout that may not be published or
// committed yet). A folder's files are taken as they are on disk, node_modules left out.
//
// An update merges file by file. When the recorded version is a Git commit, changed text is merged three ways.
// When it is only a fingerprint (`local:...`, a folder with uncommitted changes), a file changed on one side
// takes that side, and a file changed on both keeps this copy, with upstream's beside it as <file>.upstream.
//
//   bun update.ts install <repo-url|folder> [--ref <ref>]   copy every skill under skills/
//   bun update.ts [--skill <name>] [--ref <ref>] [--dry-run]
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, unlinkSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, isAbsolute, join, resolve } from 'node:path'
import { arg } from './lib/run.ts'
import { migrateLegacyNames } from './lib/migrate.ts'

// `commit`: the Git commit the skill was taken at, or `local:<fingerprint>` for a folder's uncommitted files.
// `files`: each installed file's SHA-256, so an update can tell what changed even without the old contents.
type LockEntry = { source: string; path: string; commit: string; files?: Record<string, string> }
type Lock = { skills: Record<string, LockEntry> }
type Outcome = { skill: string; from: string; to: string; updated: string[]; added: string[]; removed: string[]; merged: string[]; conflicts: string[]; keptLocal: string[] }

const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout?.trim() || process.cwd()
migrateLegacyNames(root)
const LOCK_PATH = '.agents/themesmith.lock.json'
const SKILLS_DIR = '.agents/skills'
const dryRun = process.argv.includes('--dry-run')
const clones = new Map<string, string>()

const sha = (content: Buffer) => createHash('sha256').update(content).digest('hex')
// A folder on this computer rather than a Git URL.
const isFolder = (source: string) => !/^[a-z+]+:\/\/|^git@/.test(source) && existsSync(source)
// Never copied from a folder: installed packages and system clutter.
const SKIPPED = new Set(['node_modules', '.DS_Store', 'Thumbs.db'])

function git(cwd: string, ...args: string[]): Buffer {
  const r = spawnSync('git', args, { cwd, encoding: 'buffer' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr.toString()}`)
  return r.stdout
}

function clone(source: string): string {
  if (!clones.has(source)) {
    const dir = mkdtempSync(join(tmpdir(), 'themesmith-upstream-'))
    const flags = ['--quiet', '--no-checkout']
    const cloned = (args: string[]) => spawnSync(args[0], args.slice(1), { cwd: dir, encoding: 'utf8' }).status === 0
    const plain = spawnSync('git', ['clone', ...flags, source, '.'], { cwd: dir, encoding: 'utf8' })
    // A private GitHub repo over https needs saved credentials. Without them, try the GitHub CLI's sign-in,
    // then an SSH key.
    const github = source.match(/^https:\/\/github\.com\/([^/]+\/[^/]+?)(?:\.git)?\/?$/)
    const ok =
      plain.status === 0 ||
      (github !== null &&
        ((Bun.which('gh') !== null && cloned(['gh', 'repo', 'clone', github[1], '.', '--', ...flags])) ||
          cloned(['git', '-c', 'core.sshCommand=ssh -o BatchMode=yes', 'clone', ...flags, `git@github.com:${github[1]}.git`, '.'])))
    if (!ok) throw new Error(`Could not download ${source}: ${plain.stderr}`)
    clones.set(source, dir)
  }
  return clones.get(source)!
}

// Files of `path` at `commit`, relative to `path`. An empty commit means "nothing" (a fresh install).
function upstreamFiles(repo: string, commit: string, path: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>()
  if (commit === '') return files
  const names = git(repo, 'ls-tree', '-r', '--name-only', commit, '--', path).toString().split('\n').filter(Boolean)
  for (const name of names) files.set(name.slice(path.length + 1), git(repo, 'show', `${commit}:${name}`))
  return files
}

function localFiles(dir: string): Map<string, Buffer> {
  const files = new Map<string, Buffer>()
  const walk = (rel: string) => {
    for (const name of readdirSync(join(dir, rel))) {
      if (SKIPPED.has(name)) continue
      const path = rel ? `${rel}/${name}` : name
      if (statSync(join(dir, path)).isDirectory()) walk(path)
      else files.set(path, readFileSync(join(dir, path)))
    }
  }
  if (existsSync(dir)) walk('')
  return files
}

// A folder upstream: its files as they are on disk, at its commit when the folder is a Git checkout with no
// uncommitted changes under `path`, otherwise at a fingerprint of the files.
function folderVersion(source: string, path: string): { target: string; files: Map<string, Buffer> } {
  const files = localFiles(join(source, path))
  const inGit = spawnSync('git', ['rev-parse', '--verify', 'HEAD'], { cwd: source, encoding: 'utf8' })
  const dirty = spawnSync('git', ['status', '--porcelain', '--', path], { cwd: source, encoding: 'utf8' })
  if (inGit.status === 0 && dirty.status === 0 && dirty.stdout.trim() === '') return { target: inGit.stdout.trim(), files }
  const manifest = [...files].sort(([a], [b]) => a.localeCompare(b)).map(([f, c]) => `${f}\0${sha(c)}`).join('\n')
  return { target: `local:${sha(Buffer.from(manifest)).slice(0, 16)}`, files }
}

const same = (a: Buffer | undefined, b: Buffer | undefined) => (a === undefined ? b === undefined : b !== undefined && a.equals(b))

// git merge-file merges text in place: 0 = clean, >0 = that many conflicts (markers written), <0 = error.
function mergeText(ours: Buffer, base: Buffer, theirs: Buffer): { content: Buffer; clean: boolean } {
  const dir = mkdtempSync(join(tmpdir(), 'themesmith-merge-'))
  for (const [name, content] of [['ours', ours], ['base', base], ['theirs', theirs]] as const) writeFileSync(join(dir, name), content)
  const r = spawnSync('git', ['merge-file', '-L', 'this repo', '-L', 'previous upstream', '-L', 'new upstream', 'ours', 'base', 'theirs'], { cwd: dir })
  const content = readFileSync(join(dir, 'ours'))
  rmSync(dir, { recursive: true, force: true })
  if (r.status === null || r.status < 0 || content.includes(0)) return { content: ours, clean: false }
  return { content, clean: r.status === 0 }
}

function apply(skill: string, entry: LockEntry, to: string): Outcome & { files: Record<string, string> } {
  let target: string
  let theirs: Map<string, Buffer>
  // The previous upstream version: its files when Git still has them, otherwise only their fingerprints.
  let base: Map<string, Buffer> | null = null
  if (isFolder(entry.source)) {
    ;({ target, files: theirs } = folderVersion(entry.source, entry.path))
    if (entry.commit === '') base = new Map()
    else if (!entry.commit.startsWith('local:') && spawnSync('git', ['cat-file', '-e', `${entry.commit}^{commit}`], { cwd: entry.source }).status === 0) {
      base = upstreamFiles(entry.source, entry.commit, entry.path)
    }
  } else {
    const repo = clone(entry.source)
    target = git(repo, 'rev-parse', `${to}^{commit}`).toString().trim()
    theirs = upstreamFiles(repo, target, entry.path)
    base = upstreamFiles(repo, entry.commit, entry.path)
  }
  const baseHashes = entry.files ?? {}
  const outcome: Outcome = { skill, from: entry.commit, to: target, updated: [], added: [], removed: [], merged: [], conflicts: [], keptLocal: [] }
  const dir = join(root, SKILLS_DIR, skill)
  const ours = localFiles(dir)
  const write = (file: string, content: Buffer | undefined) => {
    if (dryRun) return
    const path = join(dir, file)
    if (content === undefined) unlinkSync(path)
    else {
      mkdirSync(dirname(path), { recursive: true })
      writeFileSync(path, content)
    }
  }
  // Compares a file with its previous upstream version: by content when Git has it, by fingerprint otherwise.
  const isBase = (file: string, content: Buffer | undefined) =>
    base ? same(base.get(file), content) : content === undefined ? baseHashes[file] === undefined : baseHashes[file] === sha(content)
  const files = [...new Set([...(base?.keys() ?? Object.keys(baseHashes)), ...theirs.keys(), ...ours.keys()])].sort()
  for (const file of files) {
    const [b, t, o] = [base?.get(file), theirs.get(file), ours.get(file)]
    if (isBase(file, t) || same(o, t)) {
      if (!isBase(file, o) && !same(o, t)) outcome.keptLocal.push(file)
      continue
    }
    if (isBase(file, o)) {
      write(file, t)
      ;(t === undefined ? outcome.removed : o === undefined ? outcome.added : outcome.updated).push(file)
      continue
    }
    // Changed here and upstream.
    if (b !== undefined && t !== undefined && o !== undefined) {
      const merged = mergeText(o, b, t)
      write(file, merged.content)
      ;(merged.clean ? outcome.merged : outcome.conflicts).push(file)
    } else {
      // One side deleted the file the other changed: keep this repo's version and put upstream's beside it.
      if (t !== undefined) write(`${file}.upstream`, t)
      outcome.conflicts.push(file)
    }
  }
  return { ...outcome, files: Object.fromEntries([...theirs].map(([f, c]) => [f, sha(c)])) }
}

function readLock(): Lock {
  const path = join(root, LOCK_PATH)
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as Lock) : { skills: {} }
}

const command = process.argv[2] === 'install' ? 'install' : 'update'
const lock = readLock()
const ref = arg('--ref') ?? 'HEAD'
const outcomes: (Outcome & { files: Record<string, string> })[] = []

try {
  if (command === 'install') {
    const given = process.argv[3]
    if (!given || given.startsWith('--')) throw new Error('Usage: bun update.ts install <repo-url|folder> [--ref <ref>]')
    const source = isFolder(given) ? (isAbsolute(given) ? given : resolve(given)) : given
    process.argv[3] = source
    const names = isFolder(source)
      ? readdirSync(join(source, 'skills'), { withFileTypes: true }).filter((d) => d.isDirectory() && existsSync(join(source, 'skills', d.name, 'SKILL.md'))).map((d) => d.name).sort()
      : git(clone(source), 'ls-tree', '-d', '--name-only', `${ref}:skills`).toString().split('\n').filter(Boolean)
    for (const name of names) {
      if (lock.skills[name]) throw new Error(`${name} is already installed from ${lock.skills[name].source}. Run an update instead.`)
      outcomes.push(apply(name, { source, path: `skills/${name}`, commit: '' }, ref))
    }
  } else {
    const only = arg('--skill')
    const names = only ? [only] : Object.keys(lock.skills)
    for (const name of names) {
      const entry = lock.skills[name]
      if (!entry) throw new Error(`${name} is not in ${LOCK_PATH}.`)
      outcomes.push(apply(name, entry, ref))
    }
  }
  if (!dryRun) {
    for (const o of outcomes) {
      const previous = lock.skills[o.skill]
      lock.skills[o.skill] = { source: previous?.source ?? process.argv[3], path: previous?.path ?? `skills/${o.skill}`, commit: o.to, files: o.files }
    }
    mkdirSync(dirname(join(root, LOCK_PATH)), { recursive: true })
    writeFileSync(join(root, LOCK_PATH), `${JSON.stringify(lock, null, 2)}\n`)
  }
  console.log(JSON.stringify({ ok: outcomes.every((o) => o.conflicts.length === 0), dryRun, skills: outcomes.map(({ files: _, ...o }) => o) }, null, 2))
  process.exitCode = outcomes.some((o) => o.conflicts.length > 0) ? 1 : 0
} catch (error) {
  console.log(JSON.stringify({ ok: false, error: (error as Error).message }, null, 2))
  process.exitCode = 2
} finally {
  for (const dir of clones.values()) rmSync(dir, { recursive: true, force: true })
}
