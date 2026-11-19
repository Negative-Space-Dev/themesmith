import { spawnSync } from 'node:child_process'
import { existsSync, mkdtempSync, realpathSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs'
import { homedir, tmpdir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'
import { exec } from './exec.ts'

// The Shopify CLI always runs on Bun, never Node: Theme Check took 72s instead of 103s on a large theme, and the other
// theme commands 10-25% less, with identical results. Bun runs the CLI's JavaScript entry point directly, so the
// CLI must be installed where that file can be found; `shopify` alone may be a Node wrapper.
export const SHOPIFY_INSTALL = 'bun add -g @shopify/cli@latest'

const ENTRY = join('node_modules', '@shopify', 'cli', 'bin', 'run.js')

export function shopifyEntry(): string | null {
  const bin = Bun.which('shopify')
  const real = bin ? realpathSync(bin) : null
  const bunGlobal = process.env.BUN_INSTALL_GLOBAL_DIR ?? join(process.env.BUN_INSTALL ?? join(homedir(), '.bun'), 'install', 'global')
  const candidates = [
    // `shopify` on PATH first, so this runs the same version the person gets by typing it. Bun and npm on
    // Mac/Linux link it straight to the entry script.
    ...(real && /\.[cm]?[jt]s$/.test(real) ? [real] : []),
    // npm on Windows puts a shopify.cmd shim beside node_modules.
    ...(bin ? [join(dirname(bin), ENTRY)] : []),
    // Installed with `bun add -g`, which on Windows puts a shopify.exe shim on PATH instead of a link.
    join(bunGlobal, ENTRY),
  ]
  return candidates.find((c) => existsSync(c)) ?? null
}

export function shopifyCommand(): string[] | null {
  const entry = shopifyEntry()
  return entry ? [process.execPath, '--bun', entry] : null
}

export const NOT_INSTALLED = `The Shopify CLI isn't installed where Bun can run it. Install it with \`${SHOPIFY_INSTALL}\`.`

// Theme Check stops applying .theme-check.yml's ignore list when the theme's path has a folder starting with a
// dot (as in ~/.worktrees/... or .claude/worktrees/...): on a large theme it inspected 2183 files instead of 753
// and reported 578 offenses instead of 2. Checking through a link whose path has no such folder gives the right
// result. `done` removes only the link, never anything it points to.
export function checkablePath(args: string[], cwd: string): { args: string[]; done: () => void } {
  const pathFlag = args.indexOf('--path')
  const themePath = resolve(cwd, pathFlag === -1 ? '.' : args[pathFlag + 1])
  if (args[0] !== 'theme' || args[1] !== 'check' || !themePath.split(sep).some((part) => part.startsWith('.') && part.length > 1)) return { args, done: () => {} }
  const link = join(mkdtempSync(join(tmpdir(), 'themesmith-check-')), 'theme')
  symlinkSync(themePath, link, 'junction')
  const linked = pathFlag === -1 ? [...args, '--path', link] : args.map((a, i) => (i === pathFlag + 1 ? link : a))
  return {
    args: linked,
    done: () => {
      unlinkSync(link)
      rmdirSync(dirname(link))
    },
  }
}

export function runShopify(args: string[], options: { cwd: string; timeout?: number; inherit?: boolean }) {
  const command = shopifyCommand()
  if (!command) return { ok: false, status: null, stdout: '', stderr: '', out: NOT_INSTALLED }
  const [cmd, ...pre] = command
  const linked = checkablePath(args, options.cwd)
  const r = spawnSync(cmd, [...pre, ...linked.args], { cwd: options.cwd, timeout: options.timeout, encoding: 'utf8', stdio: options.inherit ? 'inherit' : 'pipe' })
  linked.done()
  const stdout = r.stdout ?? ''
  const stderr = r.stderr ?? ''
  return { ok: r.status === 0, status: r.status, stdout, stderr, out: `${stdout}${stderr}`.trim() }
}

// Shopify CLI 5 is the oldest version whose JSON output this skill reads.
export const MIN_MAJOR = 5

export function shopifyMajor(versionOutput: string): number | null {
  const match = versionOutput.match(/(\d+)\.\d+\.\d+/)
  return match ? Number(match[1]) : null
}

// The fatal error document Shopify CLI 5 prints on stdout: {"error": {...}}.
export type ShopifyError = { type: string; message: string; code?: string; tryMessage?: string; nextSteps?: string[] }

// A finished command's result, which a nonzero exit can still carry (a partial push), or the reason it stopped.
export type JsonOutcome<T> =
  | { kind: 'result'; exitedOk: boolean; result: T }
  | { kind: 'error'; error: ShopifyError; verifyUrl: string | null }

// Runs `shopify <args> --json`. Shopify CLI 5 writes the result or error as one JSON document on stdout, and
// progress and diagnostics as JSON events on stderr.
export function runShopifyJson<T>(args: string[], options: { cwd: string; timeout?: number }): JsonOutcome<T> {
  return parseJsonOutcome<T>(runShopify([...args, '--json'], options))
}

// The same, without blocking, so it can run while other work happens.
export async function runShopifyJsonAsync<T>(args: string[], options: { cwd: string; timeout?: number }): Promise<JsonOutcome<T>> {
  const command = shopifyCommand()
  if (!command) return { kind: 'error', error: { type: 'abort', message: NOT_INSTALLED }, verifyUrl: null }
  const linked = checkablePath(args, options.cwd)
  try {
    return parseJsonOutcome<T>(await exec([...command, ...linked.args, '--json'], options))
  } finally {
    linked.done()
  }
}

function parseJsonOutcome<T>(r: { ok: boolean; stdout: string; stderr: string; out: string }): JsonOutcome<T> {
  let doc: unknown
  try {
    doc = JSON.parse(r.stdout)
  } catch {
    return { kind: 'error', error: { type: 'external', message: diagnostics(r.stderr) || r.out || 'The Shopify CLI printed nothing.' }, verifyUrl: null }
  }
  if (typeof doc === 'object' && doc !== null && 'error' in doc) {
    const error = (doc as { error: ShopifyError }).error
    return { kind: 'error', error, verifyUrl: verificationUrl(error) }
  }
  return { kind: 'result', exitedOk: r.ok, result: doc as T }
}

// Without a terminal, a command that needs the person to confirm their identity stops with an abort error whose
// next steps hold the verification page. The error has no stable code, so it is recognized by its message.
function verificationUrl(error: ShopifyError): string | null {
  if (!/verify your identity/i.test(error.message)) return null
  return JSON.stringify(error).match(/https:\/\/[^\s"'\\)\]]+/)?.[0] ?? null
}

function diagnostics(stderr: string): string {
  return stderr
    .split('\n')
    .flatMap((line) => {
      try {
        const event = JSON.parse(line) as { type?: string; level?: string; message?: string }
        return event.type === 'diagnostic' && event.level === 'error' && event.message ? [event.message] : []
      } catch {
        return line.trim() ? [line.trim()] : []
      }
    })
    .join('\n')
}

// The error in plain words, with the CLI's suggested next steps.
export function describeError(error: ShopifyError): string {
  return [error.message, error.tryMessage, ...(error.nextSteps ?? [])].filter(Boolean).join('\n')
}
