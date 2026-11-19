// Works out a theme's profile from the repository, so setup can show it to the person to confirm instead of
// asking them for each value. Every guess says where it came from.
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { homedir } from 'node:os'
import { join, relative } from 'node:path'
import { defaultBranch as namedDefaultBranch, onGitHub } from './git.ts'
import { exec } from './exec.ts'
import { globMatch, type Command, type DevModeMarker, type Mode } from './profile.ts'

export type SuggestedProfile = {
  store: string | null
  storeSource: string | null
  // True when the store is only a guess the person should check: the store the Shopify CLI last used, which
  // doesn't match this repository.
  storeUnsure: boolean
  // When several stores match the repository's name and nothing settles which: the person picks one.
  storeOptions: string[]
  mode: Mode
  modeSource: string
  // The base branch, plus any branch GitHub Actions treats as a base for pull requests.
  protectedBranches: string[]
  dev: Command[]
  build: Command[]
  devModeMarkers: DevModeMarker[]
  generated: string[]
}

const STORE = /\b([a-z0-9][a-z0-9-]*\.myshopify\.com)\b/
// Store names that docs use as examples, never a real theme's store.
const PLACEHOLDER_STORE = /^(?:example|examples|your-?store(?:-name)?|store-?name|your-?shop|shop|test|demo|sample|xxx+)$/

const git = async (root: string, ...args: string[]) => {
  const r = await exec(['git', ...args], { cwd: root, timeout: 15_000 })
  return r.ok ? r.stdout.trim() : ''
}

// The Shopify CLI's settings folder for one of its config files.
function cliConfig(name: string): Record<string, unknown> | null {
  const dirs = {
    darwin: join(homedir(), 'Library', 'Preferences'),
    win32: join(process.env.APPDATA ?? join(homedir(), 'AppData', 'Roaming')),
  } as Record<string, string>
  const base = dirs[process.platform] ?? join(process.env.XDG_CONFIG_HOME ?? join(homedir(), '.config'))
  const file = join(base, name, process.platform === 'win32' ? 'Config' : '', 'config.json')
  if (!existsSync(file)) return null
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as Record<string, unknown>
  } catch {
    return null
  }
}

// The last store the Shopify CLI worked with on this computer. Only the store name is read.
function cliThemeStore(): string | null {
  const store = cliConfig('shopify-cli-theme-conf-nodejs')?.themeStore
  return typeof store === 'string' && STORE.test(store) ? store : null
}

// Stores the Shopify CLI has worked with on this computer, by handle (acme-audio for
// acme-audio.myshopify.com): the keys of its per-store settings. Only the keys are read, never the values.
function cliKnownStores(): string[] {
  const names = ['shopify-cli-development-theme-config-nodejs', 'shopify-cli-development-theme-conf-nodejs', 'shopify-cli-theme-store-password-nodejs']
  return [...new Set(names.flatMap((n) => Object.keys(cliConfig(n) ?? {}).filter((k) => /^[a-z0-9][a-z0-9-]*$/.test(k))))]
}

// The stores whose handle matches the repository: exactly, or starting with its name (acme-4 for acme).
// Several prefix matches are settled by the CLI's last-used store only when it's one of them.
function storesForRepo(names: string[], known: string[], lastUsed: string | null): string[] {
  for (const name of names) {
    if (known.includes(name)) return [`${name}.myshopify.com`]
  }
  const prefixed = known.filter((k) => names.some((n) => k.startsWith(`${n}-`))).sort()
  const last = lastUsed?.replace(/\.myshopify\.com$/, '')
  if (last && prefixed.includes(last)) return [lastUsed!]
  return prefixed.map((k) => `${k}.myshopify.com`)
}

function storeInFiles(root: string): string | null {
  for (const file of ['README.md', 'readme.md', 'package.json', 'shopify.theme.toml', '.shopify/project.json']) {
    const path = join(root, file)
    if (existsSync(path)) {
      const real = [...readFileSync(path, 'utf8').matchAll(new RegExp(STORE, 'g'))].map((m) => m[1]).find((s) => !PLACEHOLDER_STORE.test(s.replace(/\.myshopify\.com$/, '')))
      if (real) return real
    }
  }
  return null
}

function packageDirs(root: string): string[] {
  const out: string[] = []
  const walk = (dir: string, depth: number) => {
    if (existsSync(join(dir, 'package.json'))) out.push(dir)
    if (depth === 0) return
    let entries
    try {
      entries = readdirSync(dir, { withFileTypes: true })
    } catch {
      // A folder this user can't read holds nothing setup needs.
      return
    }
    for (const e of entries) {
      if (e.isDirectory() && !e.name.startsWith('.') && e.name !== 'node_modules') walk(join(dir, e.name), depth - 1)
    }
  }
  walk(root, 2)
  return out
}

function runner(dir: string): string {
  if (existsSync(join(dir, 'bun.lock')) || existsSync(join(dir, 'bun.lockb'))) return 'bun run'
  if (existsSync(join(dir, 'pnpm-lock.yaml'))) return 'pnpm run'
  if (existsSync(join(dir, 'yarn.lock'))) return 'yarn'
  return 'npm run'
}

// Branches GitHub Actions workflows run on for pull requests into them: those are bases work merges into, so
// they're protected like the default branch. Negated patterns and catch-alls (`*`, `**`) are left out.
function workflowBases(root: string): string[] {
  const dir = join(root, '.github', 'workflows')
  if (!existsSync(dir)) return []
  const bases: string[] = []
  for (const file of readdirSync(dir).filter((f) => /\.ya?ml$/.test(f))) {
    let workflow: unknown
    try {
      workflow = Bun.YAML.parse(readFileSync(join(dir, file), 'utf8'))
    } catch {
      continue
    }
    const on = (workflow as { on?: unknown })?.on
    if (typeof on !== 'object' || on === null || Array.isArray(on)) continue
    for (const trigger of ['pull_request', 'pull_request_target']) {
      const branches = (on as Record<string, { branches?: unknown } | null>)[trigger]?.branches
      const list = typeof branches === 'string' ? [branches] : Array.isArray(branches) ? branches : []
      for (const b of list) if (typeof b === 'string' && !b.startsWith('!') && !/^\*+$/.test(b)) bases.push(b)
    }
  }
  return [...new Set(bases)]
}

// The default branch and the workflow bases, without patterns another one already covers.
function protectedPatterns(defaultBranch: string, bases: string[]): string[] {
  const all = [...new Set([defaultBranch, ...bases])]
  return all.filter((p) => !all.some((other) => other !== p && globMatch(other, p)))
}

export async function suggestProfile(root: string): Promise<SuggestedProfile> {
  const [origin, log] = await Promise.all([git(root, 'remote', 'get-url', 'origin'), git(root, 'log', '--format=%s', '-500')])
  // Shopify's GitHub integration commits as "Update from Shopify for theme <repo>/<branch>", most often on the
  // branch the live theme follows.
  const syncs = new Map<string, number>()
  for (const m of log.matchAll(/Update from Shopify for theme [^/\s]+\/(\S+)/g)) syncs.set(m[1], (syncs.get(m[1]) ?? 0) + 1)
  const connected = [...syncs.keys()].sort((a, b) => syncs.get(b)! - syncs.get(a)!)
  // The default branch: what origin/HEAD names, else main or master, else the branch Shopify syncs most.
  const defaultBranch = namedDefaultBranch(root) ?? connected[0] ?? 'main'
  const github = onGitHub(origin)
  const mode: Mode = github ? 'github' : 'cli'
  const modeSource = github
    ? connected.length > 0
      ? 'the GitHub repository has commits from Shopify, so the live theme is connected to it'
      : 'the folder is a GitHub repository'
    : 'the folder is not connected to GitHub'

  // The store, most reliable first: named in the repository's files; a store this computer's Shopify CLI has
  // used whose handle matches the repository (its GitHub name, or the "<name>/<branch>" Shopify's sync commits
  // use); only then the store the CLI last used, marked as a guess.
  const repoNames = [
    ...new Set([origin.match(/([^/:]+?)(?:\.git)?\/?$/)?.[1], ...[...log.matchAll(/Update from Shopify for theme ([^/\s]+)\//g)].map((m) => m[1])].filter(Boolean).map((n) => n!.toLowerCase())),
  ]
  const lastUsed = cliThemeStore()
  const fromFiles = storeInFiles(root)
  const matching = fromFiles ? [] : storesForRepo(repoNames, cliKnownStores(), lastUsed)
  const fromRepo = matching.length === 1 ? matching[0] : null
  const storeOptions = matching.length > 1 ? matching : []
  const store = fromFiles ?? fromRepo ?? (storeOptions.length ? null : lastUsed)
  const storeUnsure = !fromFiles && !fromRepo && store !== null
  const storeSource = fromFiles
    ? 'found in this repository'
    : fromRepo
      ? 'a store this computer has worked with whose name matches this repository'
      : storeOptions.length
        ? 'several stores this computer has worked with match this repository'
        : lastUsed
          ? 'the store the Shopify CLI last used on this computer, which may not be this theme\'s'
          : null

  const protectedBranches = protectedPatterns(defaultBranch, workflowBases(root))

  const dev: Command[] = [{ cwd: '.', run: 'bun {skill}/scripts/shopify.ts theme dev --store {store}' }]
  const build: Command[] = []
  // Files a build writes into the theme: the `-o`/`--output` of its build and dev scripts (Tailwind CLI, esbuild,
  // Sass and the like).
  const outputs = new Set<string>()
  for (const dir of packageDirs(root)) {
    // A Shopify app in the same repository has its own `shopify app dev`; only theme asset builds belong here.
    if (existsSync(join(dir, 'shopify.app.toml'))) continue
    let scripts: Record<string, string>
    try {
      scripts = (JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')) as { scripts?: Record<string, string> }).scripts ?? {}
    } catch {
      // A package.json no tool can read builds nothing.
      continue
    }
    const cwd = relative(root, dir) || '.'
    // A `build` that runs the Shopify CLI (`shopify theme package`, say) isn't an asset build.
    if (scripts.build && !/\bshopify\b/.test(scripts.build)) build.push({ cwd, run: `${runner(dir)} build` })
    // A `dev` script that starts the Shopify CLI, itself or through scripts it runs, would start a second preview
    // beside the first command.
    const runsOthers = /\b(?:npm-run-all|run-[ps]|concurrently|npm run|pnpm|yarn|bun run)\b/.test(scripts.dev ?? '')
    const startsShopify = /\bshopify\b/.test(scripts.dev ?? '') || (runsOthers && Object.values(scripts).some((v) => /shopify\s+theme\s+dev/.test(v)))
    if (scripts.dev && !startsShopify) dev.push({ cwd, run: `${runner(dir)} dev` })
    for (const s of [scripts.build, scripts.dev]) {
      for (const m of (s ?? '').matchAll(/(?:^|\s)(?:-o|--output|--outfile)[\s=]+['"]?([^\s'"]+)/g)) {
        const out = relative(root, join(dir, m[1])).replace(/\\/g, '/')
        if (/^(assets|snippets)\//.test(out)) outputs.add(out)
      }
    }
  }

  // Build tools such as vite-plugin-shopify write a snippet that loads the built files. In dev mode it points at
  // a local server, which must never be pushed.
  const snippets = existsSync(join(root, 'snippets')) ? readdirSync(join(root, 'snippets')).filter((f) => /vite.*\.liquid$/.test(f)) : []
  const devModeMarkers = snippets.flatMap((f) => [
    { file: `snippets/${f}`, contains: '127.0.0.1' },
    { file: `snippets/${f}`, contains: 'localhost' },
  ])
  const assetPrefixes = new Set<string>()
  for (const f of snippets) {
    const committed = await git(root, 'show', `HEAD:snippets/${f}`)
    for (const m of committed.matchAll(/['"]([A-Za-z]+_)[^'"/]*\.(?:js|css)['"]/g)) assetPrefixes.add(m[1])
  }
  const generated = [...[...assetPrefixes].map((p) => `assets/${p}*`), ...snippets.map((f) => `snippets/${f}`), ...outputs]

  return { store, storeSource, storeUnsure, storeOptions, mode, modeSource, protectedBranches, dev, build, devModeMarkers, generated }
}
