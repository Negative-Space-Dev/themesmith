import { createHash } from 'node:crypto'
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { globMatch } from './profile.ts'

// Theme file path -> SHA-256 of its bytes.
export type Snapshot = Record<string, string>

// The last time this folder and a remote theme agreed, as each side's files. They differ because Shopify
// rewrites some pushed JSON (it drops settings and app blocks the theme doesn't know).
export type Agreement = { local: Snapshot; remote: Snapshot }

export const THEME_DIRS = ['assets', 'blocks', 'config', 'layout', 'locales', 'sections', 'snippets', 'templates']
const ALWAYS_IGNORED = ['*.DS_Store', '*Thumbs.db', '*desktop.ini']

export function readIgnores(root: string): string[] {
  const path = join(root, '.shopifyignore')
  if (!existsSync(path)) return ALWAYS_IGNORED
  const lines = readFileSync(path, 'utf8').split(/\r?\n/).map((l) => l.trim())
  return [...ALWAYS_IGNORED, ...lines.filter((l) => l !== '' && !l.startsWith('#'))]
}

export function snapshot(dir: string, ignores: string[]): Snapshot {
  const out: Snapshot = {}
  const walk = (rel: string) => {
    for (const name of readdirSync(join(dir, rel))) {
      const path = `${rel}/${name}`
      if (statSync(join(dir, path)).isDirectory()) walk(path)
      else if (!ignores.some((pattern) => globMatch(pattern, path))) {
        out[path] = createHash('sha256').update(readFileSync(join(dir, path))).digest('hex')
      }
    }
  }
  for (const top of THEME_DIRS) if (existsSync(join(dir, top))) walk(top)
  return out
}

export function differing(a: Snapshot, b: Snapshot): string[] {
  return [...new Set([...Object.keys(a), ...Object.keys(b)])].filter((f) => a[f] !== b[f]).sort()
}

export type Merge = {
  // Changed on the remote since `base`.
  changedRemote: string[]
  // Changed only on the remote: copy the remote file in, or delete the local one.
  take: string[]
  remove: string[]
  // Changed differently on both sides.
  conflicts: string[]
}

export function threeWay(base: Agreement, local: Snapshot, remote: Snapshot): Merge {
  const merge: Merge = { changedRemote: [], take: [], remove: [], conflicts: [] }
  for (const f of differing(base.remote, remote)) {
    merge.changedRemote.push(f)
    if (local[f] === remote[f]) continue
    if (local[f] === base.local[f]) (remote[f] === undefined ? merge.remove : merge.take).push(f)
    else merge.conflicts.push(f)
  }
  return merge
}
