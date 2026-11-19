// GitHub mode: begin a piece of work. Prints JSON naming each step. The first save makes the preview.
//   bun start.ts <short-name>     a new branch from the latest default branch, e.g. fall-sale-banner
//   bun start.ts --continue       keep working on the current branch
//   bun start.ts --update         bring the latest default branch into this work branch: merges it without
//                                 committing, so the next save builds, checks and commits it as a merge
//   add --new to start a new branch even though the current one has work of its own
//   add --carry or --leave when other uncommitted changes are in the way (see below)
// Files setup changed (listed in .themesmith/setup-files.json) are committed first as "Set up themesmith",
// without a build or checks: they are settings, not theme code.
//
// A new branch takes every uncommitted change along, and the next save commits everything, so changes that
// aren't setup's would end up in this work unnoticed. When there are any, it stops and lists them, for the
// person to choose: --carry brings them along as part of this work; --leave sets them aside with `git stash`,
// where `git stash pop` brings them back.
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { defaultBranch } from './lib/git.ts'
import { exec } from './lib/exec.ts'
import { findRoot, isProtectedBranch, loadProfile, parseProfile, PROFILE_PATH, ProfileError, type Profile } from './lib/profile.ts'
import { Run } from './lib/run.ts'

const args = process.argv.slice(2)
// A branch started before the theme was set up has no profile yet: `--update` reads it from the default branch on
// GitHub, and the merge then brings it into the branch.
const { root, profile } = await locate()
const run: Run = new Run(root)
const name = args.find((a) => !a.startsWith('--'))
const keepGoing = args.includes('--continue') || args.includes('--update')
const setupList = join(root, '.themesmith', 'setup-files.json')
const setupFiles = existsSync(setupList) ? (JSON.parse(readFileSync(setupList, 'utf8')) as string[]) : []

async function git(...gitArgs: string[]) {
  const r = await exec(['git', ...gitArgs], { cwd: root, timeout: 120_000 })
  return { ok: r.ok, out: r.out }
}

async function locate(): Promise<{ root: string; profile: Profile }> {
  try {
    const root = findRoot()
    return { root, profile: loadProfile(root) }
  } catch (error) {
    if (!(error instanceof ProfileError) || !args.includes('--update')) throw error
    const top = await exec(['git', 'rev-parse', '--show-toplevel'])
    if (!top.ok) throw error
    const root = top.stdout.trim()
    const base = defaultBranch(root) ?? 'main'
    await exec(['git', 'fetch', 'origin', base], { cwd: root, timeout: 120_000 })
    const shown = await exec(['git', 'show', `origin/${base}:${PROFILE_PATH}`], { cwd: root })
    if (!shown.ok) throw error
    return { root, profile: parseProfile(JSON.parse(shown.stdout)) }
  }
}

if (profile.mode !== 'github') run.fail('mode', 'This theme uses CLI mode. Start with `theme.ts start` instead.')
if (!name && !keepGoing) run.fail('arguments', 'Pass a short name for the work, like fall-sale-banner, or --continue.')

const current = await git('branch', '--show-current')
const base = defaultBranch(root) ?? 'main'
// The fetch runs while the current branch is inspected.
const fetched = keepGoing ? null : git('fetch', 'origin', base)

if (keepGoing) {
  if (!current.out || isProtectedBranch(profile, current.out)) run.fail('branch', `"${current.out || 'this commit'}" is protected, so work can't continue on it. Pass a name to start a new branch.`)
  run.ok('branch', `continuing on ${current.out}`)
  if (args.includes('--update')) await bringInBase()
} else {
  const branch = name!.toLowerCase().replace(/[^a-z0-9/-]+/g, '-').replace(/^-+|-+$/g, '')
  if (current.out && !isProtectedBranch(profile, current.out) && !args.includes('--new')) {
    const own = await git('log', '--oneline', `origin/${base}..HEAD`)
    if (own.ok && own.out) {
      run.fail('branch', `"${current.out}" already has work of its own. Ask whether this request continues it (--continue) or starts something new (--new).`, {
        commits: own.out.split('\n'),
      })
    }
  }
  const others = await uncommittedOutsideSetup()
  if (others.length > 0) {
    if (args.includes('--leave')) {
      const stash = await git('stash', 'push', '--include-untracked', '-m', `themesmith: set aside before starting ${branch}`, '--', ...others)
      if (!stash.ok) run.fail('uncommitted', `Could not set the other changes aside:\n${stash.out}`)
      run.ok('uncommitted', `set aside ${others.length} unrelated changed file(s) with git stash; \`git stash pop\` brings them back`)
    } else if (args.includes('--carry')) {
      run.ok('uncommitted', `bringing along ${others.length} changed file(s) as part of this work`)
    } else {
      run.fail(
        'uncommitted',
        "These files have changes that aren't saved and aren't part of setup. Ask the person whether they belong to this new work (--carry) or should be left out of it (--leave sets them aside; `git stash pop` brings them back).",
        { files: others }
      )
    }
  }
  const fetch = await fetched!
  if (!fetch.ok) run.fail('fetch', `Could not get the latest "${base}" from GitHub:\n${fetch.out}`)
  // Uncommitted changes, such as the files setup just wrote, come along to the new branch.
  const created = await git('switch', '-c', branch, `origin/${base}`)
  if (!created.ok) run.fail('branch', `Could not create "${branch}":\n${created.out}`)
  run.ok('branch', `${branch}, from the latest ${base}`)
  // New work starts with a clean review record (see references/review.md).
  for (const f of ['reviewed.json', 'review-notes.md']) rmSync(join(root, '.themesmith', f), { force: true })
}

if (existsSync(setupList)) {
  const files = setupFiles.filter((f) => existsSync(join(root, f)))
  if (files.length > 0) {
    const added = await git('add', '--', ...files)
    const commit = added.ok ? await git('commit', '-m', 'Set up themesmith', '--', ...files) : added
    if (!commit.ok && !/nothing (added )?to commit/.test(commit.out)) run.fail('setup commit', commit.out)
    if (commit.ok) run.ok('setup commit', `committed ${files.length} setup files`)
  }
  rmSync(setupList)
}

run.finish()

// Merges the latest default branch into this work branch without committing, so `save.ts` builds and checks the
// result and commits it as a merge commit, keeping both histories as they are. A rebase onto it would rewrite
// commits already on GitHub, which would need a force-push.
async function bringInBase() {
  const others = await uncommittedOutsideSetup()
  if (others.length > 0) {
    run.fail('update', 'Save or set aside the unsaved changes first, so bringing in the latest work stays separate from them.', { files: others })
  }
  const fetch = await git('fetch', 'origin', base)
  if (!fetch.ok) run.fail('fetch', `Could not get the latest "${base}" from GitHub:\n${fetch.out}`)
  const behind = await git('rev-list', '--count', `HEAD..origin/${base}`)
  if (behind.out.trim() === '0') run.finish({ update: `already has everything from ${base}` })
  const merged = await git('merge', '--no-commit', '--no-ff', `origin/${base}`)
  const conflicts = (await exec(['git', 'diff', '--name-only', '--diff-filter=U'], { cwd: root })).stdout.split('\n').filter(Boolean)
  if (conflicts.length > 0) {
    run.fail(
      'update',
      `The latest "${base}" changes the same lines as this work in these files. Combine both versions in each (remove the <<<<<<< ======= >>>>>>> markers), then save. To back out instead, run \`git merge --abort\`.`,
      { conflicts }
    )
  }
  if (!merged.ok) run.fail('update', merged.out)
  run.ok('update', `brought in ${behind.out.trim()} commit(s) from ${base}; save next, to build, check and commit them`)
  run.finish()
}

// Changed, added or deleted files Git would carry to a new branch, other than setup's (a listed file, or a file
// inside a listed folder) and themesmith's own state in .themesmith/. Ignored files never move, so they don't
// count.
async function uncommittedOutsideSetup(): Promise<string[]> {
  const r = await exec(['git', 'status', '--porcelain=v1', '-z', '--untracked-files=all'], { cwd: root })
  const fields = r.stdout.split('\0')
  const paths: string[] = []
  for (let i = 0; i < fields.length; i++) {
    const entry = fields[i]
    if (entry.length < 4) continue
    paths.push(entry.slice(3))
    // A rename is followed by its old path.
    if (entry[0] === 'R' || entry[0] === 'C') i++
  }
  const isSetup = (p: string) => p.startsWith('.themesmith/') || setupFiles.some((f) => p === f || p.startsWith(`${f}/`))
  return paths.filter((p) => !isSetup(p))
}
