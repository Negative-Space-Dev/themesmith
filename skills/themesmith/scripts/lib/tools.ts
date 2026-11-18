// The programs theme work needs on this computer: how to tell which version is installed, the oldest version
// that works, and how to install or update each one without the person typing commands.
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { exec, sh } from './exec.ts'
import { SKILL_DIR } from './run.ts'
import { MIN_MAJOR, SHOPIFY_INSTALL, shopifyCommand } from './shopify.ts'

export type Platform = 'mac' | 'windows' | 'linux'
export const platform: Platform = process.platform === 'darwin' ? 'mac' : process.platform === 'win32' ? 'windows' : 'linux'

// One package manager installs one thing at a time (brew, winget and apt each hold a lock), so installs in the
// same queue run in order and the queues run side by side.
type Queue = 'bun' | 'bun-skill' | 'brew' | 'winget' | 'apt'
type Install = { queue: Queue; command: string; admin?: boolean } | { manual: string }

export type ToolName = 'bun' | 'git' | 'gh' | 'npm' | 'shopify' | 'theme-check'
type ToolSpec = {
  name: ToolName
  label: string
  // What the person gets from it, in a few plain words.
  why: string
  min: string | null
  // The version must be exactly `min`, not just at least it.
  exact?: boolean
  version: () => Promise<string | null>
  install: () => Promise<Install>
}

export type ToolState = 'ok' | 'missing' | 'outdated'
export type ToolStatus = { name: ToolName; label: string; why: string; state: ToolState; version: string | null; min: string | null }

export const THEME_CHECK_PACKAGE = '@shopify/theme-check-node'
// The Theme Check this skill checks changed files with: the release the supported Shopify CLI bundles, pinned in
// the skill's package.json, so results match `shopify theme check` exactly.
export const THEME_CHECK_VERSION = (JSON.parse(readFileSync(join(SKILL_DIR, 'package.json'), 'utf8')) as { dependencies: Record<string, string> }).dependencies[THEME_CHECK_PACKAGE]

const firstVersion = (text: string) => text.match(/\d+\.\d+(?:\.\d+)?/)?.[0] ?? null

async function commandVersion(cmd: string[]): Promise<string | null> {
  const r = await exec(cmd, { timeout: 30_000 })
  return r.ok ? firstVersion(r.stdout || r.stderr) : null
}

const has = (program: string) => Bun.which(program) !== null

// Installs through the computer's package manager, which on Linux needs an administrator password unless sudo
// is set up to skip it.
async function systemInstall(packages: { brew?: string; winget?: string; apt?: string }, manual: string): Promise<Install> {
  if (platform === 'mac') return packages.brew && has('brew') ? { queue: 'brew', command: `brew install ${packages.brew}` } : { manual }
  if (platform === 'windows') {
    return packages.winget && has('winget')
      ? { queue: 'winget', command: `winget install --id ${packages.winget} -e --silent --accept-package-agreements --accept-source-agreements` }
      : { manual }
  }
  if (!packages.apt || !has('apt-get')) return { manual }
  const passwordless = (await exec(['sudo', '-n', 'true'], { timeout: 5_000 })).ok
  return { queue: 'apt', command: `sudo ${passwordless ? '-n ' : ''}apt-get install -y ${packages.apt}`, admin: !passwordless }
}

export const TOOLS: ToolSpec[] = [
  {
    name: 'bun',
    label: 'Bun',
    why: 'runs the themesmith scripts',
    min: '1.4.0',
    version: async () => Bun.version,
    install: async () => ({ queue: 'bun', command: 'bun upgrade' }),
  },
  {
    name: 'git',
    label: 'Git',
    why: 'saves versions of your work',
    min: '2.30.0',
    version: () => commandVersion(['git', '--version']),
    install: () => systemInstall({ brew: 'git', winget: 'Git.Git', apt: 'git' }, 'Install Git from https://git-scm.com/downloads'),
  },
  {
    name: 'gh',
    label: 'GitHub CLI',
    why: 'opens pull requests for review',
    min: '2.40.0',
    version: () => commandVersion(['gh', '--version']),
    install: () => systemInstall({ brew: 'gh', winget: 'GitHub.cli', apt: 'gh' }, 'Install the GitHub CLI from https://cli.github.com'),
  },
  {
    name: 'npm',
    label: 'npm (comes with Node.js)',
    why: 'used by the Shopify CLI',
    min: null,
    version: () => commandVersion(['npm', '--version']),
    install: () => systemInstall({ brew: 'node', winget: 'OpenJS.NodeJS.LTS', apt: 'nodejs npm' }, 'Install Node.js from https://nodejs.org'),
  },
  {
    name: 'shopify',
    label: 'Shopify CLI',
    why: 'previews and uploads the theme',
    min: `${MIN_MAJOR}.0.0`,
    version: async () => {
      const command = shopifyCommand()
      return command ? commandVersion([...command, 'version']) : null
    },
    install: async () => ({ queue: 'bun', command: SHOPIFY_INSTALL }),
  },
  {
    name: 'theme-check',
    label: 'Fast Theme Check',
    why: 'checks only the files you changed',
    min: THEME_CHECK_VERSION,
    exact: true,
    version: async () => {
      const path = join(SKILL_DIR, 'node_modules', THEME_CHECK_PACKAGE, 'package.json')
      return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as { version: string }).version : null
    },
    install: async () => ({ queue: 'bun-skill', command: `bun install --cwd "${SKILL_DIR}" --frozen-lockfile` }),
  },
]

export function atLeast(version: string, min: string): boolean {
  const a = version.split('.').map(Number)
  const b = min.split('.').map(Number)
  for (let i = 0; i < 3; i++) {
    if ((a[i] ?? 0) !== (b[i] ?? 0)) return (a[i] ?? 0) > (b[i] ?? 0)
  }
  return true
}

export async function checkTools(names: ToolName[]): Promise<ToolStatus[]> {
  return Promise.all(
    TOOLS.filter((t) => names.includes(t.name)).map(async (t) => {
      const version = await t.version()
      const wrong = t.min !== null && (t.exact ? version !== t.min : version !== null && !atLeast(version, t.min))
      const state: ToolState = version === null ? 'missing' : wrong ? 'outdated' : 'ok'
      return { name: t.name, label: t.label, why: t.why, state, version, min: t.min }
    })
  )
}

export type InstallOutcome = { name: ToolName; label: string; ok: boolean; version: string | null; detail?: string; manual?: string; admin?: boolean }

// Installs every named tool. Each package manager's installs run in order; different package managers run at
// the same time.
export async function installTools(names: ToolName[]): Promise<InstallOutcome[]> {
  const specs = TOOLS.filter((t) => names.includes(t.name))
  const plans = await Promise.all(specs.map(async (t) => ({ spec: t, install: await t.install() })))
  const outcomes: InstallOutcome[] = []
  const queues = new Map<Queue, typeof plans>()
  for (const plan of plans) {
    if ('manual' in plan.install) {
      outcomes.push({ name: plan.spec.name, label: plan.spec.label, ok: false, version: null, manual: plan.install.manual })
      continue
    }
    if (plan.install.admin) {
      outcomes.push({ name: plan.spec.name, label: plan.spec.label, ok: false, version: null, admin: true, manual: plan.install.command })
      continue
    }
    queues.set(plan.install.queue, [...(queues.get(plan.install.queue) ?? []), plan])
  }
  await Promise.all(
    [...queues.values()].map(async (queue) => {
      for (const { spec, install } of queue) {
        const r = await sh((install as { command: string }).command, { timeout: 15 * 60_000 })
        const version = await spec.version()
        const ok = r.ok && version !== null && (!spec.min || (spec.exact ? version === spec.min : atLeast(version, spec.min)))
        outcomes.push({ name: spec.name, label: spec.label, ok, version, ...(ok ? {} : { detail: r.out.split('\n').slice(-8).join('\n') }) })
      }
    })
  )
  return specs.map((s) => outcomes.find((o) => o.name === s.name)!)
}

// The table the agent shows the person as is: one row per tool, what state it's in, and what setup will do.
export function toolChart(tools: ToolStatus[]): string {
  const rows = tools.map((t) => {
    const status =
      t.state === 'ok'
        ? `✅ ${t.version}`
        : t.state === 'outdated'
          ? TOOLS.find((s) => s.name === t.name)?.exact
            ? `⚠️ ${t.version} (needs exactly ${t.min})`
            : `⚠️ ${t.version} is too old (needs ${t.min}+)`
          : '❌ Not installed'
    const plan = t.state === 'ok' ? 'Ready' : t.state === 'outdated' ? 'Update' : 'Install'
    return `| **${t.label}** | ${t.why} | ${status} | ${plan} |`
  })
  return ["| Tool | What it's for | Status | Setup will |", '| --- | --- | --- | --- |', ...rows].join('\n')
}

export function installChart(outcomes: InstallOutcome[]): string {
  const rows = outcomes.map((o) => {
    const result = o.ok ? `✅ ${o.version}` : o.admin ? '🔑 Needs your computer password' : o.manual ? '✋ Needs you' : '❌ Failed'
    return `| **${o.label}** | ${result} |`
  })
  return ['| Tool | Result |', '| --- | --- |', ...rows].join('\n')
}
