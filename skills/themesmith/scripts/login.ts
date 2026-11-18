// Signs the person in to Shopify (this theme's store) or GitHub. Both show their sign-in code only in a
// terminal, so this runs the sign-in in a pseudo-terminal in the background and hands back the link right away.
//
//   bun login.ts [shopify|github]          already signed in: {"status":"ok"}; otherwise starts the sign-in and
//                                          prints {"status":"waiting","url":...,"code":...} for the person to open
//   bun login.ts [shopify|github] --wait   waits (up to 10 minutes) for the person to finish
// Progress is kept in .themesmith/jobs/login-<service>.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { exec, isRunning, startDetached } from './lib/exec.ts'
import { findRoot, loadProfile } from './lib/profile.ts'
import { runShopifyJsonAsync, shopifyCommand } from './lib/shopify.ts'

type LoginState =
  | { status: 'starting'; pid: number }
  | { status: 'waiting'; pid: number; url: string; code: string | null }
  | { status: 'ok' }
  | { status: 'error'; message: string }

type Service = {
  signedIn: () => Promise<boolean>
  command: () => string[] | null
  // A saved sign-in the service no longer accepts, and how to clear it before trying again.
  stale?: { pattern: RegExp; clear: string[] }
  url: RegExp
  code: RegExp
}

const root = findRoot()
const profile = loadProfile(root)
const service = process.argv.includes('github') ? 'github' : 'shopify'
const statePath = join(root, '.themesmith', 'jobs', `login-${service}.json`)

const SERVICES: Record<'shopify' | 'github', Service> = {
  shopify: {
    signedIn: async () => (await runShopifyJsonAsync(['theme', 'list', '--store', profile.store, '--no-input'], { cwd: root, timeout: 60_000 })).kind === 'result',
    command: () => {
      const cli = shopifyCommand()
      return cli ? [...cli, 'theme', 'list', '--store', profile.store] : null
    },
    // "Service is not valid for authentication": signing out clears it, and a second try starts a fresh sign-in.
    stale: { pattern: /not valid for authentication|\b401\b/i, clear: ['auth', 'logout'] },
    url: /https:\/\/accounts\.shopify\.com\/\S+/,
    code: /verification code:\s*([A-Z0-9-]+)/i,
  },
  github: {
    signedIn: async () => (await exec(['gh', 'auth', 'status'], { timeout: 30_000 })).ok,
    command: () => (Bun.which('gh') ? ['gh', 'auth', 'login', '--web', '--hostname', 'github.com', '--git-protocol', 'https'] : null),
    url: /https:\/\/github\.com\/login\/device\S*/,
    code: /one-time code:\s*([A-Z0-9-]+)/i,
  },
}

function readLogin(path = statePath): LoginState | null {
  return existsSync(path) ? (JSON.parse(readFileSync(path, 'utf8')) as LoginState) : null
}

function write(state: LoginState) {
  mkdirSync(dirname(statePath), { recursive: true })
  writeFileSync(statePath, `${JSON.stringify(state, null, 2)}\n`)
}

const strip = (text: string) => text.replace(/\x1b\[[0-9;?]*[ -/]*[@-~]/g, '').replace(/\r/g, '')

// Runs the sign-in in a pseudo-terminal. Resolves once the person has signed in, or it fails.
async function signInOnce(spec: Service, command: string[]): Promise<{ code: number; output: string }> {
  let output = ''
  let pressed = false
  let announced = false
  const proc = Bun.spawn(command, {
    cwd: root,
    terminal: {
      cols: 120,
      rows: 40,
      data(terminal, chunk) {
        output += new TextDecoder().decode(chunk)
        const text = strip(output)
        // "Press any key / Enter to open the login page": the key opens a browser where there is one.
        if (!pressed && /press (any key|enter)/i.test(text)) {
          pressed = true
          terminal.write('\r')
        }
        const url = text.match(spec.url)?.[0]
        if (url && !announced) {
          announced = true
          write({ status: 'waiting', pid: process.pid, url, code: text.match(spec.code)?.[1] ?? null })
        }
      },
    },
  })
  const code = await proc.exited
  proc.terminal?.close()
  return { code, output: strip(output) }
}

async function hold() {
  const spec = SERVICES[service]
  const command = spec.command()
  if (!command) return write({ status: 'error', message: `${service === 'shopify' ? 'The Shopify CLI' : 'The GitHub CLI'} is not installed.` })
  let result = await signInOnce(spec, command)
  if (result.code !== 0 && spec.stale?.pattern.test(result.output)) {
    const cli = shopifyCommand()
    if (cli) Bun.spawnSync([...cli, ...spec.stale.clear], { cwd: root })
    result = await signInOnce(spec, command)
  }
  write(result.code === 0 ? { status: 'ok' } : { status: 'error', message: result.output.trim().split('\n').slice(-6).join('\n') })
}

async function waitFor(done: (s: LoginState | null) => boolean, ms: number): Promise<LoginState | null> {
  const end = Date.now() + ms
  while (Date.now() < end) {
    const state = readLogin()
    if (done(state)) return state
    if (state && 'pid' in state && !isRunning(state.pid)) return { status: 'error', message: 'The sign-in stopped before it finished.' }
    await Bun.sleep(500)
  }
  return readLogin()
}

const settled = (s: LoginState | null) => s?.status === 'ok' || s?.status === 'error'

{
  if (process.argv.includes('--hold')) {
    await hold()
    process.exit(0)
  }

  if (process.argv.includes('--wait')) {
    const state = readLogin()
    const final = state && 'pid' in state ? await waitFor(settled, 10 * 60_000) : state
    const ok = final?.status === 'ok' || (final === null && (await SERVICES[service].signedIn()))
    console.log(JSON.stringify(ok ? { status: 'ok' } : (final ?? { status: 'error', message: 'No sign-in was started.' })))
    process.exit(ok ? 0 : 1)
  }

  const current = readLogin()
  if (current && 'pid' in current && isRunning(current.pid)) {
    // A sign-in is already waiting for the person: hand back the same link.
    console.log(JSON.stringify(current))
    process.exit(0)
  }
  if (await SERVICES[service].signedIn()) {
    write({ status: 'ok' })
    console.log(JSON.stringify({ status: 'ok' }))
    process.exit(0)
  }
  write({ status: 'starting', pid: startDetached(['bun', import.meta.path, service, '--hold'], { cwd: root, log: statePath.replace(/\.json$/, '.log') }) })
  const started = await waitFor((s) => s?.status === 'waiting' || settled(s), 60_000)
  console.log(JSON.stringify(started ?? { status: 'error', message: 'The sign-in did not start.' }))
  process.exit(started?.status === 'error' ? 1 : 0)
}
