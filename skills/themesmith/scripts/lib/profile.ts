import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { LEGACY_PROFILE_PATH, migrateLegacyNames } from './migrate.ts'

export type Command = { cwd: string; run: string }

export type Mode = 'github' | 'cli'

// A file that must not contain `contains` when pushed, e.g. a Vite tag still pointing at the dev server.
export type DevModeMarker = { file: string; contains: string }

export type Profile = {
  store: string
  mode: Mode
  protectedBranches: string[]
  dev: Command[]
  build: Command[]
  format: Command[]
  checks: Command[]
  devModeMarkers: DevModeMarker[]
  generated: string[]
}

export const PROFILE_PATH = '.agents/themesmith.json'

export class ProfileError extends Error {}

// The folder holding the profile, found by walking up from `start`. Works without Git, for CLI-mode themes.
export function findRoot(start = process.cwd()): string {
  for (let dir = start; ; dir = dirname(dir)) {
    if (existsSync(join(dir, LEGACY_PROFILE_PATH))) migrateLegacyNames(dir)
    if (existsSync(join(dir, PROFILE_PATH))) return dir
    if (dirname(dir) === dir) throw new ProfileError(`No profile at ${PROFILE_PATH} in this folder or any folder above it. Run setup first.`)
  }
}

export function loadProfile(repoRoot: string): Profile {
  migrateLegacyNames(repoRoot)
  const path = join(repoRoot, PROFILE_PATH)
  if (!existsSync(path)) throw new ProfileError(`No profile at ${PROFILE_PATH}. Run setup first.`)
  let raw: unknown
  try {
    raw = JSON.parse(readFileSync(path, 'utf8'))
  } catch (error) {
    throw new ProfileError(`${PROFILE_PATH} is not valid JSON: ${(error as Error).message}`)
  }
  return parseProfile(raw)
}

export function parseProfile(raw: unknown): Profile {
  const o = record(raw, 'profile')
  const mode = o.mode
  if (mode !== 'github' && mode !== 'cli') throw new ProfileError(`mode must be "github" or "cli", got ${JSON.stringify(mode)}`)
  const store = string(o.store, 'store')
  if (!/^[a-z0-9][a-z0-9-]*\.myshopify\.com$/.test(store)) {
    throw new ProfileError(`store must be the *.myshopify.com domain, got ${JSON.stringify(store)}`)
  }
  return {
    store,
    mode,
    protectedBranches: optionalArray(o.protectedBranches, 'protectedBranches', string, ['main']),
    dev: optionalArray(o.dev, 'dev', command, []),
    build: optionalArray(o.build, 'build', command, []),
    format: optionalArray(o.format, 'format', command, []),
    checks: optionalArray(o.checks, 'checks', command, []),
    devModeMarkers: optionalArray(o.devModeMarkers, 'devModeMarkers', marker, []),
    generated: optionalArray(o.generated, 'generated', string, []),
  }
}

// `*` matches any run of characters, including `/`.
export function globMatch(pattern: string, value: string): boolean {
  const source = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*+/g, '.*').replace(/\?/g, '.')
  return new RegExp(`^${source}$`).test(value)
}

export function isProtectedBranch(profile: Profile, branch: string): boolean {
  return profile.protectedBranches.some((pattern) => globMatch(pattern, branch))
}

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) throw new ProfileError(`${field} must be an object`)
  return value as Record<string, unknown>
}

function string(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) throw new ProfileError(`${field} must be a non-empty string`)
  return value
}

function command(value: unknown, field: string): Command {
  const o = record(value, field)
  return { cwd: string(o.cwd ?? '.', `${field}.cwd`), run: string(o.run, `${field}.run`) }
}

function marker(value: unknown, field: string): DevModeMarker {
  const o = record(value, field)
  return { file: string(o.file, `${field}.file`), contains: string(o.contains, `${field}.contains`) }
}

function optionalArray<T>(value: unknown, field: string, item: (v: unknown, f: string) => T, fallback: T[]): T[] {
  if (value === undefined) return fallback
  if (!Array.isArray(value)) throw new ProfileError(`${field} must be an array`)
  return value.map((v, i) => item(v, `${field}[${i}]`))
}
