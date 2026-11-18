// GitHub mode: begin a piece of work. Prints JSON naming each step. The first save makes the preview.
//   bun start.ts <short-name>     a new branch from the latest default branch, e.g. fall-sale-banner
//   bun start.ts --continue       keep working on the current branch
//   add --new to start a new branch even though the current one has work of its own
// Files setup changed (listed in .themesmith/setup-files.json) are committed first as "Set up themesmith",
// without a build or checks: they are settings, not theme code.
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { exec } from './lib/exec.ts'
import { findRoot, isProtectedBranch, loadProfile } from './lib/profile.ts'
import { Run } from './lib/run.ts'

const root = findRoot()
const run: Run = new Run(root)
const profile = loadProfile(root)
const args = process.argv.slice(2)
const name = args.find((a) => !a.startsWith('--'))
const keepGoing = args.includes('--continue')

async function git(...gitArgs: string[]) {
  const r = await exec(['git', ...gitArgs], { cwd: root, timeout: 120_000 })
  return { ok: r.ok, out: r.out }
}

if (profile.mode !== 'github') run.fail('mode', 'This theme uses CLI mode. Start with `theme.ts start` instead.')
if (!name && !keepGoing) run.fail('arguments', 'Pass a short name for the work, like fall-sale-banner, or --continue.')

const [current, head] = await Promise.all([git('branch', '--show-current'), git('symbolic-ref', '--short', 'refs/remotes/origin/HEAD')])
const base = head.out.replace(/^origin\//, '') || 'main'
// The fetch runs while the current branch is inspected.
const fetched = keepGoing ? null : git('fetch', 'origin', base)

if (keepGoing) {
  if (!current.out || isProtectedBranch(profile, current.out)) run.fail('branch', `"${current.out || 'this commit'}" is protected, so work can't continue on it. Pass a name to start a new branch.`)
  run.ok('branch', `continuing on ${current.out}`)
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
  const fetch = await fetched!
  if (!fetch.ok) run.fail('fetch', `Could not get the latest "${base}" from GitHub:\n${fetch.out}`)
  // Uncommitted changes, such as the files setup just wrote, come along to the new branch.
  const created = await git('switch', '-c', branch, `origin/${base}`)
  if (!created.ok) run.fail('branch', `Could not create "${branch}":\n${created.out}`)
  run.ok('branch', `${branch}, from the latest ${base}`)
  // New work starts with a clean review record (see references/review.md).
  for (const f of ['reviewed.json', 'review-notes.md']) rmSync(join(root, '.themesmith', f), { force: true })
}

const setupList = join(root, '.themesmith', 'setup-files.json')
if (existsSync(setupList)) {
  const files = (JSON.parse(readFileSync(setupList, 'utf8')) as string[]).filter((f) => existsSync(join(root, f)))
  if (files.length > 0) {
    const added = await git('add', '--', ...files)
    const commit = added.ok ? await git('commit', '-m', 'Set up themesmith', '--', ...files) : added
    if (!commit.ok && !/nothing (added )?to commit/.test(commit.out)) run.fail('setup commit', commit.out)
    if (commit.ok) run.ok('setup commit', `committed ${files.length} setup files`)
  }
  rmSync(setupList)
}

run.finish()
