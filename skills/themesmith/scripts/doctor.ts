// Checks and sets up everything theme work needs, on this computer and in this theme. Every check runs at the
// same time, and so do installs that don't share a package manager.
//
//   bun doctor.ts          check only; changes nothing. Prints `chart` to show the person, and when the theme
//                          isn't set up yet, the profile setup would write (`confirm`) for them to check
//   bun doctor.ts --fix [--store <x>.myshopify.com] [--mode github|cli] [--protected a,b]
//                       [--skip tool,tool] [--git-name "<name>"] [--git-email <email>]
//                          installs and updates the tools the person agreed to (all but --skip), sets up the
//                          theme, then starts the sign-ins and a full Theme Check in the background. Prints the
//                          sign-in links for the person.
//   bun doctor.ts --wait   waits for the sign-ins and the full Theme Check, then checks everything again
//   bun doctor.ts --update        updates themesmith on this computer to the newest version (see `update`)
//   bun doctor.ts --skip-update   stops offering the newest version
import { createHash } from 'node:crypto'
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { suggestProfile, type SuggestedProfile } from './lib/detect.ts'
import { exec, isRunning, startDetached } from './lib/exec.ts'
import { findRoot, loadProfile, parseProfile, PROFILE_PATH, ProfileError, type Profile } from './lib/profile.ts'
import { arg } from './lib/run.ts'
import { describeError, runShopifyJsonAsync } from './lib/shopify.ts'
import { checkTools, installChart, installTools, platform, toolChart, type ToolName, type ToolStatus } from './lib/tools.ts'
import { checkForUpdate, currentVersion, skipUpdate, update } from './lib/version.ts'

// One thing about this theme or the person's accounts. `needs` says who fixes it: setup, a sign-in, or the person.
type Item = { name: string; label: string; status: 'ok' | 'missing'; detail?: string; needs: 'setup' | 'sign in' | 'you' }

const SCRIPTS = import.meta.dir
const root = await (async () => {
  try {
    return findRoot()
  } catch {
    const git = await exec(['git', 'rev-parse', '--show-toplevel'], { timeout: 10_000 })
    return git.ok ? git.stdout.trim() : process.cwd()
  }
})()
const jobs = join(root, '.themesmith', 'jobs')
const themeCheckJob = join(jobs, 'theme-check.json')

function readProfile(): Profile | null {
  try {
    return loadProfile(root)
  } catch (error) {
    if (error instanceof ProfileError) return null
    throw error
  }
}

const ok = (name: string, label: string, detail?: string, needs: Item['needs'] = 'setup'): Item => ({ name, label, status: 'ok', needs, ...(detail ? { detail } : {}) })
const missing = (name: string, label: string, needs: Item['needs'], detail?: string): Item => ({ name, label, status: 'missing', needs, ...(detail ? { detail } : {}) })

async function githubTheme(profile: Profile | null): Promise<boolean> {
  return profile ? profile.mode === 'github' : (await exec(['git', 'remote', 'get-url', 'origin'], { cwd: root })).out.includes('github.com')
}

// Git and the GitHub CLI only matter in GitHub mode.
const neededTools = (github: boolean): ToolName[] => ['bun', ...(github ? (['git', 'gh'] as const) : []), 'npm', 'shopify', 'theme-check']

// Profile commands that won't work as written: the Shopify CLI must run through the wrapper (on Bun), Shopify CLI
// 5 removed `theme dev --poll`, and the whole-theme Theme Check gives way to checking only the changed files.
function commandFixes(profile: Profile): { problems: string[]; fixed: Profile } {
  const problems: string[] = []
  const fixCommand = (run: string) => {
    let next = run.replace(/^(npx\s+)?shopify\s/, 'bun {skill}/scripts/shopify.ts ')
    if (/\stheme\s+dev\b/.test(next)) next = next.replace(/\s--poll\b/, '')
    if (/scripts\/shopify\.ts theme check\b/.test(next)) next = 'bun {skill}/scripts/theme-check.ts {files}'
    if (next !== run) problems.push(`\`${run}\` → \`${next}\``)
    return next
  }
  const fix = (commands: Profile['dev']) => commands.map((c) => ({ ...c, run: fixCommand(c.run) }))
  return { problems, fixed: { ...profile, dev: fix(profile.dev), build: fix(profile.build), checks: fix(profile.checks) } }
}

type Tooling = {
  packageDir: string
  missingPackages: string[]
  installed: boolean
  prettierConfig: string | null
  themeCheckConfig: boolean
  missingThemeCheckIgnores: unknown[]
  missingIgnores: string[]
  stateGitignored: boolean
  missingInstructions: string[]
  applied: string[]
  profile: Pick<Profile, 'format' | 'checks'>
}

async function setupTools(apply = false): Promise<Tooling> {
  const r = await exec(['bun', join(SCRIPTS, 'setup-tools.ts'), ...(apply ? ['--apply'] : [])], { cwd: root, timeout: 15 * 60_000 })
  if (!r.ok) throw new Error(r.out.split('\n').slice(-8).join('\n'))
  return JSON.parse(r.stdout) as Tooling
}

function themeItems(profile: Profile | null, t: Tooling | Error): Item[] {
  if (t instanceof Error) return [missing('theme tools', 'Theme tools', 'setup', t.message)]
  const problems = profile ? commandFixes(profile).problems : []
  return [
    profile ? ok('profile', 'Themesmith settings', `${profile.store}, ${profile.mode === 'github' ? 'GitHub' : 'CLI'} mode`) : missing('profile', 'Themesmith settings', 'setup'),
    ...(profile ? [problems.length ? missing('profile commands', 'Preview and check commands', 'setup', problems.join('; ')) : ok('profile commands', 'Preview and check commands')] : []),
    t.missingPackages.length === 0 && t.installed && t.prettierConfig ? ok('prettier', 'Code formatter (Prettier)') : missing('prettier', 'Code formatter (Prettier)', 'setup'),
    t.themeCheckConfig && t.missingThemeCheckIgnores.length === 0 ? ok('theme check config', 'Theme Check settings') : missing('theme check config', 'Theme Check settings', 'setup'),
    t.missingIgnores.length === 0 ? ok('.shopifyignore', 'Files kept off Shopify') : missing('.shopifyignore', 'Files kept off Shopify', 'setup'),
    t.stateGitignored ? ok('.gitignore', 'Files kept out of Git') : missing('.gitignore', 'Files kept out of Git', 'setup'),
    profile && t.missingInstructions.length === 0 ? ok('agent rules', 'Safety rules for AI agents') : missing('agent rules', 'Safety rules for AI agents', 'setup'),
  ]
}

async function accountItems(profile: Profile | null, github: boolean): Promise<Item[]> {
  const [name, email, remote, gh, shopify] = await Promise.all([
    github ? exec(['git', 'config', 'user.name'], { cwd: root }) : null,
    github ? exec(['git', 'config', 'user.email'], { cwd: root }) : null,
    github ? exec(['git', 'remote', 'get-url', 'origin'], { cwd: root }) : null,
    github ? exec(['gh', 'auth', 'status'], { timeout: 30_000 }) : null,
    profile ? runShopifyJsonAsync(['theme', 'list', '--store', profile.store, '--no-input'], { cwd: root, timeout: 60_000 }) : null,
  ])
  const items: Item[] = []
  if (github) {
    items.push(name!.ok ? ok('git name', 'Your name on saved work', name!.stdout.trim(), 'you') : missing('git name', 'Your name on saved work', 'you'))
    items.push(email!.ok ? ok('git email', 'Your email on saved work', email!.stdout.trim(), 'you') : missing('git email', 'Your email on saved work', 'you'))
    items.push(remote!.ok && remote!.stdout.includes('github.com') ? ok('github remote', 'GitHub repository', remote!.stdout.trim(), 'you') : missing('github remote', 'GitHub repository', 'you', remote!.ok ? `origin is ${remote!.stdout.trim()}` : 'no origin remote'))
    items.push(gh!.ok ? ok('github sign-in', 'GitHub sign-in', undefined, 'sign in') : missing('github sign-in', 'GitHub sign-in', 'sign in'))
  }
  if (shopify) {
    items.push(
      shopify.kind === 'result'
        ? ok('shopify sign-in', 'Shopify sign-in', profile!.store, 'sign in')
        : missing('shopify sign-in', 'Shopify sign-in', 'sign in', shopify.verifyUrl ? `Shopify needs to confirm who you are: ${shopify.verifyUrl}` : describeError(shopify.error).split('\n')[0])
    )
  }
  // Shopify CLI 5 renamed the automation tokens and refuses to run when the new one is set beside an old one.
  const oldTokens = ['SHOPIFY_APP_AUTOMATION_TOKEN', 'SHOPIFY_CLI_PARTNERS_TOKEN'].filter((n) => process.env[n] !== undefined)
  if (oldTokens.length > 0) {
    items.push(
      missing(
        'shopify tokens',
        'Shopify automation tokens',
        'you',
        process.env.SHOPIFY_SERVICE_ACCOUNT_TOKEN !== undefined
          ? `SHOPIFY_SERVICE_ACCOUNT_TOKEN is set beside ${oldTokens.join(' and ')}, so the Shopify CLI won't run. Unset ${oldTokens.join(' and ')}.`
          : `${oldTokens.join(' and ')} still work but are deprecated. Rename to SHOPIFY_SERVICE_ACCOUNT_TOKEN, keeping the same value.`
      )
    )
  }
  return items
}

function itemChart(title: string, items: Item[]): string {
  const plan = (i: Item) => (i.needs === 'setup' ? 'Setup will add it' : i.needs === 'sign in' ? "You'll sign in once, in your browser" : 'Needs you')
  const rows = items.map((i) => `| **${i.label}** | ${i.status === 'ok' ? '✅ Ready' : `❌ ${plan(i)}`} |`)
  return [`| ${title} | Status |`, '| --- | --- |', ...rows].join('\n')
}

// The settings setup will save, in a few plain lines for the person to glance at. Not questions: one "OK?"
// covers them all.
function confirmText(s: SuggestedProfile): string {
  return [
    `- **Store:** ${
      s.store
        ? s.storeUnsure
          ? `${s.store}? (a guess: check it's this theme's store)`
          : s.store
        : s.storeOptions.length
          ? `which one: ${s.storeOptions.join(' or ')}?`
          : 'not found; ask for the `.myshopify.com` address'
    }`,
    s.mode === 'github'
      ? `- **Finished work:** goes to GitHub for review. \`${s.protectedBranches.join('`, `')}\` is never changed directly.`
      : '- **Finished work:** goes to an unpublished copy of your theme, for you to publish.',
  ].join('\n')
}

async function inspect() {
  const profile = readProfile()
  const github = await githubTheme(profile)
  const [tools, tooling, accounts, suggested, newer] = await Promise.all([
    checkTools(neededTools(github)),
    setupTools().catch((e: Error) => e),
    accountItems(profile, github),
    profile ? null : suggestProfile(root),
    checkForUpdate(),
  ])
  const theme = themeItems(profile, tooling)
  const ready = tools.every((t) => t.state === 'ok') && [...theme, ...accounts].every((i) => i.status === 'ok')
  const chart = [toolChart(tools), itemChart('This theme', theme), ...(accounts.length ? [itemChart('Accounts', accounts)] : [])].join('\n\n')
  return { profile, github, tools, tooling, theme, accounts, suggested, ready, chart, newer }
}

// The files setup may change, by content, so the setup commit includes exactly the ones it did change.
function setupCandidates(packageDir: string): string[] {
  const pkg = packageDir === '.' ? '' : `${packageDir}/`
  return [
    PROFILE_PATH,
    '.agents/themesmith.md',
    'AGENTS.md',
    'CLAUDE.md',
    '.theme-check.yml',
    '.shopifyignore',
    '.gitignore',
    ...['package.json', 'bun.lock', 'bun.lockb', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', '.prettierrc.json'].map((f) => `${pkg}${f}`),
  ]
}

// A file's or a whole folder's content, as one fingerprint. Installed packages don't count: Git ignores them.
function hash(path: string): string | null {
  const full = join(root, path)
  if (!existsSync(full)) return null
  if (!statSync(full).isDirectory()) return createHash('sha256').update(readFileSync(full)).digest('hex')
  const h = createHash('sha256')
  const walk = (rel: string) => {
    for (const name of readdirSync(join(full, rel)).sort()) {
      if (name === 'node_modules') continue
      const sub = rel ? `${rel}/${name}` : name
      if (statSync(join(full, sub)).isDirectory()) walk(sub)
      else h.update(`${sub}\0`).update(readFileSync(join(full, sub)))
    }
  }
  walk('')
  return h.digest('hex')
}

async function fix() {
  const skip = new Set((arg('--skip') ?? '').split(',').filter(Boolean))
  const before = await inspect()
  if (before.tooling instanceof Error) return { ok: false, message: before.tooling.message }
  const tooling0 = before.tooling
  const hashes = new Map(setupCandidates(tooling0.packageDir).map((f) => [f, hash(f)]))

  let profile = before.profile
  if (!profile) {
    const s = before.suggested!
    const store = arg('--store') ?? s.store
    if (!store) return { ok: false, message: 'Pass --store with the store\'s .myshopify.com address.' }
    const mode = (arg('--mode') ?? s.mode) as Profile['mode']
    profile = parseProfile({
      store,
      mode,
      protectedBranches: arg('--protected')?.split(',').filter(Boolean) ?? s.protectedBranches,
      dev: s.dev,
      build: s.build,
      format: tooling0.profile.format,
      checks: tooling0.profile.checks,
      devModeMarkers: s.devModeMarkers,
      generated: s.generated,
    })
  }
  profile = commandFixes(profile).fixed
  mkdirSync(join(root, '.agents'), { recursive: true })
  writeFileSync(join(root, PROFILE_PATH), `${JSON.stringify(profile, null, 2)}\n`)

  // Git and the GitHub CLI only matter in GitHub mode.
  const notNeeded = profile.mode === 'cli' ? ['git', 'gh'] : []
  const toInstall = before.tools.filter((t) => t.state !== 'ok' && !skip.has(t.name) && !notNeeded.includes(t.name)).map((t) => t.name)
  const installs = installTools(toInstall)
  const themeSetup = (async () => {
    const gitConfig = [
      ...(arg('--git-name') ? [exec(['git', 'config', '--global', 'user.name', arg('--git-name')!])] : []),
      ...(arg('--git-email') ? [exec(['git', 'config', '--global', 'user.email', arg('--git-email')!])] : []),
    ]
    // Creating the Theme Check config runs the Shopify CLI, so it waits for the CLI's install.
    if (!tooling0.themeCheckConfig && toInstall.includes('shopify')) await installs
    const [tooling] = await Promise.all([setupTools(true), ...gitConfig])
    return tooling
  })()
  const [installed, tooling] = await Promise.all([installs, themeSetup.catch((e: Error) => e)])

  // Remember what setup changed, so `start.ts` commits exactly those files.
  const changed = [...hashes].filter(([f, h]) => hash(f) !== h).map(([f]) => f)
  const listPath = join(root, '.themesmith', 'setup-files.json')
  const earlier = existsSync(listPath) ? (JSON.parse(readFileSync(listPath, 'utf8')) as string[]) : []
  mkdirSync(join(root, '.themesmith'), { recursive: true })
  writeFileSync(listPath, `${JSON.stringify([...new Set([...earlier, ...changed])], null, 2)}\n`)

  // In the background: the full Theme Check (once per theme) and the sign-ins, which wait for the person.
  const shopifyReady = before.tools.find((t) => t.name === 'shopify')?.state === 'ok' || installed.find((i) => i.name === 'shopify')?.ok
  const background: string[] = []
  if (shopifyReady && !existsSync(themeCheckJob)) {
    mkdirSync(jobs, { recursive: true })
    const pid = startDetached(['bun', join(SCRIPTS, 'theme-check.ts'), '--all', '--record'], { cwd: root, log: join(jobs, 'theme-check.log') })
    writeFileSync(themeCheckJob, `${JSON.stringify({ done: false, pid }, null, 2)}\n`)
    background.push('full Theme Check')
  }
  const signIn = async (service: 'shopify' | 'github') => {
    const r = await exec(['bun', join(SCRIPTS, 'login.ts'), service], { cwd: root, timeout: 120_000 })
    try {
      return JSON.parse(r.stdout.trim().split('\n').pop()!)
    } catch {
      return { status: 'error', message: r.out.split('\n').slice(-4).join('\n') }
    }
  }
  const ghReady = profile.mode === 'github' && (before.tools.find((t) => t.name === 'gh')?.state === 'ok' || installed.find((i) => i.name === 'gh')?.ok)
  const [shopify, github] = await Promise.all([shopifyReady ? signIn('shopify') : null, ghReady ? signIn('github') : null])

  const failed = installed.filter((i) => !i.ok)
  return {
    ok: failed.length === 0 && !(tooling instanceof Error),
    chart: installed.length ? installChart(installed) : 'All tools were already installed.',
    themeSetup: tooling instanceof Error ? { ok: false, message: tooling.message } : { ok: true, done: tooling.applied, profileSaved: true },
    needsYou: failed.map((i) => ({ label: i.label, ...(i.admin ? { run: i.manual, why: 'needs your computer password' } : i.manual ? { do: i.manual } : { error: i.detail }) })),
    skipped: [...skip],
    signIn: { ...(shopify ? { shopify } : {}), ...(github ? { github } : {}) },
    background,
  }
}

async function wait() {
  const waits: Promise<unknown>[] = []
  for (const service of ['shopify', 'github'] as const) {
    if (existsSync(join(jobs, `login-${service}.json`))) waits.push(exec(['bun', join(SCRIPTS, 'login.ts'), service, '--wait'], { cwd: root, timeout: 11 * 60_000 }))
  }
  waits.push(
    (async () => {
      const end = Date.now() + 10 * 60_000
      while (existsSync(themeCheckJob) && Date.now() < end) {
        const job = JSON.parse(readFileSync(themeCheckJob, 'utf8')) as { done: boolean; pid?: number }
        if (job.done || (job.pid && !isRunning(job.pid))) return
        await Bun.sleep(1000)
      }
    })()
  )
  await Promise.all(waits)
  const after = await inspect()
  const job = existsSync(themeCheckJob) ? (JSON.parse(readFileSync(themeCheckJob, 'utf8')) as { done: boolean; summary?: string; errors?: unknown[] }) : null
  return { ready: after.ready, chart: after.chart, themeCheck: job?.done ? { summary: job.summary, errors: job.errors } : null }
}

if (process.argv.includes('--update')) {
  const r = await update()
  console.log(JSON.stringify(r, null, 2))
  process.exitCode = r.ok ? 0 : 1
} else if (process.argv.includes('--skip-update')) {
  console.log(JSON.stringify(skipUpdate()))
} else if (process.argv.includes('--fix')) {
  console.log(JSON.stringify(await fix(), null, 2))
} else if (process.argv.includes('--wait')) {
  console.log(JSON.stringify(await wait(), null, 2))
} else {
  const r = await inspect()
  console.log(
    JSON.stringify(
      {
        platform,
        version: currentVersion(),
        // A newer themesmith the person hasn't turned down: ask once whether to update (SKILL.md).
        ...(r.newer ? { update: r.newer } : {}),
        ready: r.ready,
        chart: r.chart,
        ...(r.suggested ? { confirm: confirmText(r.suggested), suggestedProfile: r.suggested } : {}),
        tools: r.tools,
        theme: r.theme,
        accounts: r.accounts,
      },
      null,
      2
    )
  )
}
