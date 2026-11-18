// CLI mode: work on a copy of the live theme and push it to an unpublished draft theme, never to the live one.
// Before overwriting a remote theme it checks that nobody changed it since the last sync (the theme editor
// counts). Prints JSON naming every step; exits 1 on the first failure.
//
//   bun theme.ts start [--replace-local | --keep-local]   copy the live theme into this folder and begin new work
//   bun theme.ts push [--name "<draft theme name>"]       build, check, and push to the draft (created on first push)
//   bun theme.ts push --onto-live-theme                   only after the person explicitly confirmed pushing to live
//   bun theme.ts pull-changes --from draft|live           bring in edits made on Shopify since the last sync
//   bun theme.ts status                                   what changed here, on the draft, and on the live theme
import { cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, unlinkSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { findRoot, loadProfile } from './lib/profile.ts'
import { stopDev } from './lib/dev.ts'
import { describeError, runShopifyJsonAsync } from './lib/shopify.ts'
import { arg, Run } from './lib/run.ts'
import { differing, readIgnores, snapshot, THEME_DIRS, threeWay, type Agreement, type Snapshot } from './lib/snapshot.ts'

// Shopify CLI 5 gives theme IDs as decimal strings.
type Theme = { id: string; name: string; role: string }
type PushedTheme = Theme & { previewUrl: string | null; editorUrl: string | null }
type PushResult =
  | { status: 'success' | 'partial'; changed: boolean; theme: PushedTheme; issues: { filePath: string; message: string }[] }
  | { status: 'skipped'; reason: string }
  | { status: 'cancelled' }
type PullResult = { status: 'success'; changed: boolean; directory: string } | { status: 'skipped'; reason: string } | { status: 'cancelled' }
type SyncPoint = { id: string; name: string } & Agreement
type State = { store: string; live: SyncPoint; draft: SyncPoint | null }
type Remote = 'draft' | 'live'

const STATE_DIR = '.themesmith'
const root = findRoot()
const run: Run = new Run(root)
const profile = loadProfile(root)
const ignores = readIgnores(root)
const statePath = join(root, STATE_DIR, 'state.json')
const conflictsDir = join(root, STATE_DIR, 'conflicts')
const mirrorsDir = join(root, STATE_DIR, 'mirror')

// Runs `shopify theme <args> --json` and returns its result, which may come with a nonzero exit (a partial push).
// Stops at an error, handing on the page where the person confirms their identity when Shopify asks for that.
async function shopify<T>(step: string, ...args: string[]): Promise<{ exitedOk: boolean; result: T }> {
  const r = await runShopifyJsonAsync<T>(['theme', ...args, '--store', profile.store, '--no-input', '--no-color'], { cwd: root })
  if (r.kind === 'result') return r
  if (r.verifyUrl) {
    run.fail(
      step,
      'Shopify needs to confirm who you are before it continues. Open the verification page in a browser where you are logged in to Shopify with the same account the Shopify CLI uses, complete it, then run this again.',
      { verifyUrl: r.verifyUrl }
    )
  }
  run.fail(step, describeError(r.error), r.error.code ? { code: r.error.code } : {})
}

async function themes(): Promise<Theme[]> {
  const { result } = await shopify<{ themes: Theme[] }>('theme list', 'list')
  return result.themes
}

function liveTheme(list: Theme[]): Theme {
  const live = list.find((t) => t.role === 'live')
  if (!live) run.fail('theme list', 'The store has no live theme.')
  return live
}

// Each remote theme is pulled into its own mirror folder that only this script touches. The CLI skips files
// whose checksums already match, so after the first pull only changed files download. A new mirror starts as a
// copy of this folder, which usually matches the theme closely.
async function download(theme: Theme): Promise<{ dir: string; files: Snapshot }> {
  const dir = join(mirrorsDir, theme.id)
  if (!existsSync(dir)) {
    for (const top of THEME_DIRS) if (existsSync(join(root, top))) cpSync(join(root, top), join(dir, top), { recursive: true })
    mkdirSync(dir, { recursive: true })
  }
  const { exitedOk, result } = await shopify<PullResult>('download', 'pull', '--theme', theme.id, '--path', dir)
  if (!exitedOk || result.status !== 'success') run.fail('download', `Could not download "${theme.name}": ${JSON.stringify(result)}`)
  return { dir, files: snapshot(dir, ignores) }
}

function loadState(): State {
  if (!existsSync(statePath)) run.fail('state', 'No work started in this folder yet. Run `start` first.')
  const state = JSON.parse(readFileSync(statePath, 'utf8')) as State
  // State written with Shopify CLI 4 holds numeric theme IDs; CLI 5 compares them as strings.
  state.live.id = String(state.live.id)
  if (state.draft) state.draft.id = String(state.draft.id)
  return state
}

function saveState(state: State) {
  mkdirSync(dirname(statePath), { recursive: true })
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
  const kept = new Set([state.live.id, state.draft?.id])
  if (existsSync(mirrorsDir)) for (const id of readdirSync(mirrorsDir)) if (!kept.has(id)) rmSync(join(mirrorsDir, id), { recursive: true, force: true })
}

function local(): Snapshot {
  return snapshot(root, ignores)
}

// What this folder last agreed with: the draft after a push, otherwise the live theme it started from.
function localBase(state: State): Snapshot {
  return (state.draft ?? state.live).local
}

function unresolvedConflicts(): string[] {
  if (!existsSync(conflictsDir)) return []
  return (readdirSync(conflictsDir, { recursive: true, withFileTypes: true }) as import('node:fs').Dirent[])
    .filter((d) => d.isFile())
    .map((d) => join(d.parentPath, d.name).slice(conflictsDir.length + 1).replace(/\\/g, '/'))
}

function copyIn(from: string, files: string[]) {
  for (const f of files) {
    mkdirSync(dirname(join(root, f)), { recursive: true })
    cpSync(join(from, f), join(root, f))
  }
}

async function start() {
  const existing = existsSync(statePath) ? loadState() : null
  const live = liveTheme(await themes())
  const pulled = await download(live)
  const here = local()
  // Without a previous sync, only files present here can hold work worth keeping.
  const unsaved = existing ? differing(localBase(existing), here) : differing(pulled.files, here).filter((f) => f in here)
  const replace = process.argv.includes('--replace-local')
  const keep = process.argv.includes('--keep-local')
  if (unsaved.length > 0 && !replace && !keep) {
    run.fail(
      'start',
      existing
        ? 'This folder has changes that were never pushed. Push them, or start over with --replace-local to throw them away.'
        : 'The theme files in this folder differ from the live theme. Use --replace-local to replace them with the live theme, or --keep-local to keep them as the start of this work.',
      { files: unsaved }
    )
  }
  if (!keep) {
    copyIn(pulled.dir, Object.keys(pulled.files))
    for (const f of Object.keys(here)) if (!(f in pulled.files)) unlinkSync(join(root, f))
  }
  rmSync(conflictsDir, { recursive: true, force: true })
  // New work starts with a clean review record (see references/review.md).
  for (const f of ['reviewed.json', 'review-notes.md']) rmSync(join(root, STATE_DIR, f), { force: true })
  saveState({ store: profile.store, live: { id: live.id, name: live.name, local: pulled.files, remote: pulled.files }, draft: null })
  run.ok('start', keep ? `Kept this folder's files; the live theme "${live.name}" is the starting point.` : `Copied the live theme "${live.name}" into this folder.`)
  if (existing?.draft) run.ok('previous draft', `"${existing.draft.name}" stays in the theme list; nothing pushes to it any more.`)
  run.finish()
}

async function push() {
  if (process.argv.includes('--onto-live-theme')) return await pushLive()
  const state = loadState()
  const conflicts = unresolvedConflicts()
  if (conflicts.length > 0) {
    run.fail('conflicts', `Merge these files with the copies in ${STATE_DIR}/conflicts/ and delete each copy when done.`, { files: conflicts })
  }
  const list = await themes()
  let draft = state.draft ? list.find((t) => t.id === state.draft!.id) : undefined
  if (state.draft && !draft) {
    run.fail('draft', `The draft theme "${state.draft.name}" no longer exists. Run \`pull-changes --from live\`, then push with --name to create a new draft.`)
  }
  if (draft?.role === 'live') {
    run.fail('draft', `"${draft.name}" is now the live theme, so it can't be the draft. Run \`start\` to begin new work.`)
  }
  const name = arg('--name')
  if (!draft && !name) run.fail('arguments', 'This is the first push, so pass --name "<draft theme name>".')

  stopLocalPreview()
  // The draft downloads for the drift check while the build and checks run.
  const [, pulled] = await Promise.all([run.prepare(profile, differing(localBase(state), local())), draft ? download(draft) : null])

  if (draft && pulled) {
    const drift = differing(state.draft!.remote, pulled.files)
    if (drift.length > 0) {
      run.fail('drift check', `Someone changed "${draft.name}" on Shopify since the last push. Run \`pull-changes --from draft\` first so their edits aren't overwritten.`, { files: drift })
    }
    run.ok('drift check', `"${draft.name}" has not changed since the last push.`)
  }

  const pushed = draft ? await pushTo(['--theme', draft.id]) : await pushTo(['--unpublished', '--theme', name!])
  if (pushed.theme.role === 'live') run.fail('push', 'Refusing to record the live theme as the draft.')
  draft = pushed.theme
  const stored = await download(draft)
  if (pushed.issues) {
    // The draft holds part of this work now. Recording what it holds keeps the next push's drift check
    // accurate, and keeping the old local base keeps every changed file in the next push's checks.
    saveState({ ...state, draft: { id: draft.id, name: draft.name, local: localBase(state), remote: stored.files } })
    run.fail('push', `Some files didn't upload to "${draft.name}". Fix them and push again; the files that did upload stay there.`, { issues: pushed.issues })
  }
  saveState({ ...state, draft: { id: draft.id, name: draft.name, local: local(), remote: stored.files } })
  run.ok('push', `"${draft.name}" (${draft.id})`)
  run.finish({
    preview: pushed.theme.previewUrl ?? `https://${profile.store}?preview_theme_id=${draft.id}`,
    editor: pushed.theme.editorUrl ?? `https://${profile.store}/admin/themes/${draft.id}/editor`,
  })
}

// One `theme push`. A partial upload still names the theme it went to, with the files that failed.
async function pushTo(target: string[]): Promise<{ theme: PushedTheme; issues: { file: string; message: string }[] | null }> {
  const { exitedOk, result } = await shopify<PushResult>('push', 'push', ...target, '--path', root)
  if (result.status === 'success' && exitedOk) return { theme: result.theme, issues: null }
  if (result.status === 'success' || result.status === 'partial') {
    const issues = result.issues.map((i) => ({ file: i.filePath, message: i.message }))
    return { theme: result.theme, issues: issues.length > 0 ? issues : [{ file: '', message: 'The push did not finish.' }] }
  }
  run.fail('push', result.status === 'skipped' ? `The Shopify CLI skipped the push: ${result.reason}.` : 'The push was cancelled.')
}

// The override path: same build and checks, and refuses if the live theme changed since this folder last
// agreed with it.
async function pushLive() {
  const state = loadState()
  const conflicts = unresolvedConflicts()
  if (conflicts.length > 0) run.fail('conflicts', `Merge these files with the copies in ${STATE_DIR}/conflicts/ and delete each copy when done.`, { files: conflicts })
  const live = liveTheme(await themes())
  stopLocalPreview()
  const [, pulled] = await Promise.all([run.prepare(profile, differing(state.live.local, local())), download(live)])
  const drift = live.id === state.live.id ? differing(state.live.remote, pulled.files) : Object.keys(pulled.files)
  if (drift.length > 0) {
    run.fail('drift check', `The live theme changed on Shopify since this work started. Run \`pull-changes --from live\` first so those edits aren't overwritten.`, { files: drift })
  }
  run.ok('drift check', `"${live.name}" has not changed since this work started.`)
  const pushed = await pushTo(['--theme', live.id, '--allow-live'])
  const stored = await download(live)
  if (pushed.issues) {
    saveState({ ...state, live: { id: live.id, name: live.name, local: state.live.local, remote: stored.files } })
    run.fail('push', `Some files didn't upload to the live theme "${live.name}". Fix them and push again; the files that did upload are live now.`, { issues: pushed.issues })
  }
  saveState({ ...state, live: { id: live.id, name: live.name, local: local(), remote: stored.files } })
  run.ok('push', `the live theme "${live.name}" (${live.id})`)
  run.finish()
}

// Local dev servers rewrite built files back to dev mode, so they stop before a push builds the theme.
function stopLocalPreview() {
  if (stopDev(root) > 0) run.ok('local preview', 'stopped, so its dev-mode files stay out of the build')
}

async function pullChanges() {
  const from = arg('--from')
  if (from !== 'draft' && from !== 'live') run.fail('arguments', 'Pass --from draft or --from live.')
  const state = loadState()
  const list = await themes()
  const point = from === 'draft' ? state.draft : state.live
  if (!point) run.fail('pull-changes', 'There is no draft yet; nothing to pull from it.')
  const theme = from === 'live' ? liveTheme(list) : list.find((t) => t.id === point.id)
  if (!theme) run.fail('pull-changes', `The draft theme "${point.name}" no longer exists.`)
  const pulled = await download(theme)
  const merge = threeWay(point, local(), pulled.files)
  copyIn(pulled.dir, merge.take)
  for (const f of merge.remove) unlinkSync(join(root, f))
  for (const f of merge.conflicts) {
    const copy = join(conflictsDir, from, f)
    mkdirSync(dirname(copy), { recursive: true })
    if (f in pulled.files) cpSync(join(pulled.dir, f), copy)
    else writeFileSync(`${copy}.deleted`, `${from} deleted ${f}\n`)
  }
  const agreed = { ...point.local }
  for (const f of merge.take) agreed[f] = pulled.files[f]
  for (const f of merge.remove) delete agreed[f]
  const next = { id: theme.id, name: theme.name, local: agreed, remote: pulled.files }
  saveState(from === 'draft' ? { ...state, draft: next } : { ...state, live: next })
  run.ok('pull-changes', `${merge.changedRemote.length} file(s) changed on "${theme.name}" since the last sync.`)
  if (from === 'live' && theme.id !== point.id) run.ok('live theme', `A different theme is live now: "${theme.name}" (was "${point.name}").`)
  if (merge.conflicts.length > 0) {
    run.fail('conflicts', `Changed both here and on Shopify. Their version is in ${STATE_DIR}/conflicts/${from}/. Merge each into this folder's file, then delete the copy.`, { brought: merge.take, removed: merge.remove, conflicts: merge.conflicts })
  }
  run.finish({ brought: merge.take, removed: merge.remove })
}

async function status() {
  const state = loadState()
  const list = await themes()
  const live = liveTheme(list)
  const here = local()
  const report: Record<string, unknown> = { localChanges: differing(localBase(state), here), conflicts: unresolvedConflicts() }
  if (state.draft) {
    const draft = list.find((t) => t.id === state.draft!.id)
    if (!draft) report.draft = { name: state.draft.name, missing: true }
    else if (draft.role === 'live') report.draft = { name: draft.name, published: true }
    else {
      const pulled = await download(draft)
      report.draft = { name: draft.name, id: draft.id, changedOnShopify: differing(state.draft.remote, pulled.files), preview: `https://${profile.store}?preview_theme_id=${draft.id}` }
    }
  }
  const pulledLive = await download(live)
  report.live = { name: live.name, sameThemeAsStart: live.id === state.live.id, changedOnShopify: differing(state.live.remote, pulledLive.files) }
  run.ok('status')
  run.finish(report)
}

if (profile.mode !== 'cli') run.fail('mode', 'This theme uses GitHub mode. Save with save.ts instead.')
const commands: Record<string, () => Promise<void>> = { start, push, 'pull-changes': pullChanges, status }
const command = commands[process.argv[2] ?? '']
if (!command) run.fail('arguments', `Usage: bun theme.ts ${Object.keys(commands).join('|')}`)
await command()
