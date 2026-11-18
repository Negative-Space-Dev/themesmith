// The only way theme work gets pushed in GitHub mode. In order: stop any local dev servers (their watchers
// would put dev-mode files back), format, build, dev-mode check, theme checks, commit, pull, push, then the
// preview: the theme Shopify connected to this branch once the push reaches it, otherwise the branch's
// development theme (see lib/preview.ts). Stops at the first failing step and prints JSON naming it. The GitHub
// fetch and the theme lookup run while the build and checks do.
// Usage: bun save.ts --message "Update homepage hero text" [--no-push]
//        [--onto-protected-branch]  only after the person explicitly confirmed this push to a protected branch
//        [--force-with-lease]       only after the person explicitly confirmed replacing what is on GitHub for this
//                                   work branch (never a protected one): it overwrites the branch on GitHub, but only
//                                   if nobody pushed to it since this save fetched it
import { spawnSync } from 'node:child_process'
import { existsSync } from 'node:fs'
import { join } from 'node:path'
import { stopDev } from './lib/dev.ts'
import { exec } from './lib/exec.ts'
import { changedThemeFiles, findThemes, updatePreview, type Failure } from './lib/preview.ts'
import { isProtectedBranch, loadProfile } from './lib/profile.ts'
import { arg, Run } from './lib/run.ts'

function git(...args: string[]) {
  const r = spawnSync('git', args, { cwd: root, encoding: 'utf8' })
  return { ok: r.status === 0, out: `${r.stdout ?? ''}${r.stderr ?? ''}`.trim() }
}

// Porcelain lines start with a status column that may be a space, so the output must not be trimmed.
function changedFiles(): string[] {
  const status = spawnSync('git', ['status', '--porcelain', '--untracked-files=all'], { cwd: root, encoding: 'utf8' })
  return status.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => line.slice(3).split(' -> ').pop()!.replace(/^"|"$/g, ''))
    .filter((file) => existsSync(join(root, file)))
}

// Dev-mode markers in what Git holds, not the folder: `:` is what is staged for the commit, `HEAD` what gets pushed.
function devModeIn(ref: ':' | 'HEAD'): string[] {
  return profile.devModeMarkers
    .filter((m) => {
      const r = spawnSync('git', ['show', `${ref === ':' ? ':' : 'HEAD:'}${m.file}`], { cwd: root, encoding: 'utf8' })
      return r.status === 0 && r.stdout.includes(m.contains)
    })
    .map((m) => `${m.file} contains "${m.contains}"`)
}

function failWith(f: Failure): never {
  const { step, message, ok: _, ...extra } = f
  run.fail(step, message, extra)
}

const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).stdout.trim()
const run: Run = new Run(root)
const message = arg('--message')
const push = !process.argv.includes('--no-push')
if (!message) run.fail('arguments', 'Pass --message "<what changed, in plain words>".')

const profile = loadProfile(root)
const branch = git('branch', '--show-current').out
if (!branch) run.fail('branch', 'Not on a branch (detached HEAD). Create or switch to a branch first.')
const forceWithLease = process.argv.includes('--force-with-lease')
if (forceWithLease && isProtectedBranch(profile, branch)) {
  run.fail('branch', `"${branch}" is protected, so it is never force-pushed. Nothing was saved. The person can do that on GitHub themselves.`)
}
if (isProtectedBranch(profile, branch) && !process.argv.includes('--onto-protected-branch')) {
  run.fail('branch', `"${branch}" is protected. Create a new branch for this work before saving.`)
}

if (stopDev(root) > 0) run.ok('local preview', 'stopped, so its dev-mode files stay out of the build')

// Fetching the branch also tells whether it is on GitHub yet: a branch that isn't fails with "couldn't find
// remote ref".
const fetched = push ? exec(['git', 'fetch', 'origin', branch], { cwd: root, timeout: 120_000 }) : null
const themesFound = push ? findThemes(root, profile, branch) : null
await run.prepare(profile, changedFiles())

let committed: string[] = []
if (spawnSync('git', ['status', '--porcelain'], { cwd: root, encoding: 'utf8' }).stdout.trim() !== '') {
  git('add', '-A')
  // The last word on dev mode is what Git is about to save, whatever happened in the folder since the build.
  const staged = devModeIn(':')
  if (staged.length > 0) {
    git('reset', '-q')
    run.fail('dev mode check', `Dev-mode files were about to be saved: ${staged.join('; ')}. Nothing was saved. Run the build and save again.`)
  }
  const commit = git('commit', '-m', message!)
  if (!commit.ok) run.fail('commit', commit.out)
  run.ok('commit', git('log', '-1', '--format=%h %s').out)
  // Everything uncommitted is saved, so the agent checks this list against what it changed.
  // Compared with the branch's previous commit, so a merge lists what it brought in too (`git show` lists nothing
  // for a merge).
  const vsParent = git('diff', '--name-only', 'HEAD^1', 'HEAD')
  committed = (vsParent.ok ? vsParent : git('show', '--name-only', '--format=', 'HEAD')).out.split('\n').filter(Boolean)
} else {
  run.ok('commit', 'nothing new to commit')
}

if (!push) run.finish({ committed })

const remote = await fetched!
if (!remote.ok && !/couldn't find remote ref/i.test(remote.out)) run.fail('pull', `Could not get "${branch}" from GitHub:\n${remote.out}`)
// What GitHub has on this branch that this folder doesn't: what a force-push would drop.
const githubOnly = () => git('log', '--format=%h %s', `HEAD..origin/${branch}`).out.split('\n').filter(Boolean)
// The version of the branch this save fetched: a force-push replaces only that, never anything pushed since.
const lease = remote.ok ? git('rev-parse', `origin/${branch}`).out : null
// Combining with GitHub happens only when GitHub has something new. Unpushed work that includes a merge commit
// (bringing the base branch in, say) is merged with it, since a rebase would flatten the merge and copy the base
// branch's commits; otherwise it is rebased, for a straight history.
const newOnGitHub = remote.ok && !forceWithLease ? githubOnly() : []
if (newOnGitHub.length > 0) {
  const hasMerge = git('rev-list', '--merges', '--max-count=1', `origin/${branch}..HEAD`).out !== ''
  const pull = hasMerge ? git('merge', '--no-edit', `origin/${branch}`) : git('rebase', `origin/${branch}`)
  if (!pull.ok) {
    git(hasMerge ? 'merge' : 'rebase', '--abort')
    run.fail(
      'pull',
      `Someone else changed "${branch}" on GitHub and it conflicts with this work. Combine their changes with this work and save again. Only if the person confirms that what is on GitHub should be replaced, save with --force-with-lease, which drops the GitHub commits listed in githubOnly.\n${pull.out}`,
      { githubOnly: newOnGitHub }
    )
  }
  run.ok('pull', `brought in ${newOnGitHub.length} commit(s) from GitHub by ${hasMerge ? 'merging' : 'rebasing'}`)
}
const pushing = devModeIn('HEAD')
if (pushing.length > 0) run.fail('dev mode check', `What would be pushed has dev-mode files: ${pushing.join('; ')}. Nothing was pushed.`)

// The theme files this push carries: since the branch's last push, or for a new branch, since it left the base.
const head = git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD')
const mergeBase = git('merge-base', 'HEAD', head.ok ? head.out : 'origin/main')
const files = await changedThemeFiles(root, remote.ok ? `origin/${branch}` : mergeBase.ok ? mergeBase.out : null)

const dropped = forceWithLease && lease ? githubOnly() : []
const pushed = forceWithLease && lease ? git('push', `--force-with-lease=${branch}:${lease}`, '-u', 'origin', branch) : git('push', '-u', 'origin', branch)
if (!pushed.ok) {
  run.fail(
    'push',
    forceWithLease && /stale info|rejected/.test(pushed.out)
      ? `Someone pushed to "${branch}" after this save fetched it, so nothing was replaced. Save again to see their changes.`
      : pushed.out
  )
}
run.ok('push', dropped.length ? `origin/${branch}, replacing ${dropped.length} commit(s) that were only on GitHub: ${dropped.join('; ')}` : `origin/${branch}`)

const found = await themesFound!
if (!found.ok) failWith(found)
const preview = await updatePreview(root, profile, branch, found, files)
if (!preview.ok) failWith(preview)
run.ok('preview', preview.kind === 'connected' ? `"${preview.name}", connected to this branch, has the changes` : `development theme "${preview.name}" updated`)
if (preview.removedDevelopment) run.ok('old preview', `deleted development theme "${preview.removedDevelopment}": the connected theme replaces it`)
run.finish({
  committed,
  preview: preview.preview,
  editor: preview.editor,
  previewTheme: { kind: preview.kind, name: preview.name },
  // Shown under the preview link, as is.
  ...(preview.connectTip ? { connectTip: preview.connectTip } : {}),
})
