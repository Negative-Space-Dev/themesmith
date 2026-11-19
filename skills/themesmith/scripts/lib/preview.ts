// GitHub mode's preview: a link anyone can open (https://<store>/?preview_theme_id=<id>) showing this branch's
// built theme. Found by name every time, so nothing needs remembering:
//
// 1. The theme Shopify's GitHub integration connected to the branch: unpublished, named "<repo>/<branch>"
//    (cut to 47 characters and "..." past 50). Shopify copies each push into it, so after a save this waits
//    for the changed files to arrive there.
// 2. Otherwise, or when they don't arrive within 90 seconds: a development theme named after the branch,
//    uploaded from the built folder with `theme push --development --development-context <branch>`. Each branch
//    gets its own, reused on every save, and development themes don't take theme library slots.
//
// Only `save.ts` updates the preview, after its build and checks, so it never holds dev-mode files.
import { createHash } from 'node:crypto'
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { isAbsolute, join, relative } from 'node:path'
import { exec } from './exec.ts'
import { globMatch, type Profile } from './profile.ts'
import { describeError, runShopifyJsonAsync } from './shopify.ts'
import { readIgnores, THEME_DIRS } from './snapshot.ts'

export type Theme = { id: string; name: string; role: string }
export type Failure = { ok: false; step: string; message: string; verifyUrl?: string; issues?: { file: string; message: string }[] }
export type Preview = {
  ok: true
  kind: 'connected' | 'development'
  id: string
  name: string
  preview: string
  editor: string
  // With a development theme: the note shown under the preview link, suggesting the GitHub connection.
  connectTip?: string
  // With a connected theme: the branch's development theme, deleted now that the connected one has taken over.
  removedDevelopment?: string
}

// Theme names can't be longer than 50 characters.
const MAX_NAME = 50

// The development theme's name, and the context that finds it again: the branch name, or for a branch name past
// 50 characters, its first 43 characters, "~" and a short fingerprint, so two long names never share a theme.
export function devContext(branch: string): string {
  if (branch.length <= MAX_NAME) return branch
  return `${branch.slice(0, 43)}~${createHash('sha256').update(branch).digest('hex').slice(0, 6)}`
}

// The name Shopify's GitHub integration gives the theme it connects to a branch.
export function connectedName(repo: string, branch: string): string {
  const full = `${repo}/${branch}`
  return full.length <= MAX_NAME ? full : `${full.slice(0, MAX_NAME - 3)}...`
}

// The repository's name, from the origin remote: git@github.com:acme/theme.git and https://github.com/acme/theme
// are both "theme".
export async function repoName(root: string): Promise<string | null> {
  const origin = (await exec(['git', 'remote', 'get-url', 'origin'], { cwd: root })).stdout.trim()
  return origin.match(/([^/:]+?)(?:\.git)?\/?$/)?.[1] ?? null
}

const links = (profile: Profile, theme: Theme, kind: Preview['kind']): Preview => ({
  ok: true,
  kind,
  id: theme.id,
  name: theme.name,
  preview: `https://${profile.store}/?preview_theme_id=${theme.id}`,
  editor: `https://${profile.store}/admin/themes/${theme.id}/editor`,
})

async function cli<T>(root: string, profile: Profile, ...args: string[]): Promise<{ ok: true; exitedOk: boolean; result: T } | Failure> {
  const r = await runShopifyJsonAsync<T>(['theme', ...args, '--store', profile.store, '--no-input', '--no-color'], { cwd: root, timeout: 15 * 60_000 })
  if (r.kind === 'result') return { ok: true, exitedOk: r.exitedOk, result: r.result }
  return r.verifyUrl
    ? { ok: false, step: 'preview', message: 'Shopify needs to confirm who you are before it continues.', verifyUrl: r.verifyUrl }
    : { ok: false, step: 'preview', message: describeError(r.error) }
}

export type Found = { ok: true; connected: Theme[]; development: Theme | null }

// The branch's themes, by name. Several themes can share a connected name once it is cut short; the sync check
// tells them apart.
export async function findThemes(root: string, profile: Profile, branch: string): Promise<Found | Failure> {
  const [repo, list] = await Promise.all([repoName(root), cli<{ themes: Theme[] }>(root, profile, 'list')])
  if (!list.ok) return list
  const connected = repo ? list.result.themes.filter((t) => t.role === 'unpublished' && t.name === connectedName(repo, branch)) : []
  const development = list.result.themes.find((t) => t.role === 'development' && t.name === devContext(branch)) ?? null
  return { ok: true, connected, development }
}

// The theme files a save changed, and what each holds in the commit (null: deleted). Null when Git can't say,
// so the preview doesn't trust a connected theme it can't check.
export async function changedThemeFiles(root: string, from: string | null): Promise<Map<string, string | null> | null> {
  if (!from) return null
  const diff = await exec(['git', '-c', 'core.quotepath=false', 'diff', '--name-only', '--no-renames', from, 'HEAD'], { cwd: root })
  if (!diff.ok) return null
  const ignores = readIgnores(root)
  const files = diff.stdout
    .split('\n')
    .filter((f) => f && THEME_DIRS.includes(f.split('/')[0]) && !ignores.some((p) => globMatch(p, f)))
  const out = new Map<string, string | null>()
  await Promise.all(
    files.map(async (f) => {
      const show = await exec(['git', 'show', `HEAD:${f}`], { cwd: root })
      out.set(f, show.ok ? show.stdout : null)
    })
  )
  return out
}

// JSON templates start with a generated comment, and Shopify drops settings it doesn't recognize, so JSON
// counts as arrived when what Shopify holds is the commit's content or a part of it.
function sameContent(file: string, expected: string, actual: string): boolean {
  if (expected === actual) return true
  if (!file.endsWith('.json')) return false
  const parse = (text: string) => {
    try {
      return JSON.parse(text.replace(/^\s*\/\*[\s\S]*?\*\//, ''))
    } catch {
      return undefined
    }
  }
  const within = (part: unknown, whole: unknown): boolean => {
    if (part === null || typeof part !== 'object') return part === whole
    if (whole === null || typeof whole !== 'object' || Array.isArray(part) !== Array.isArray(whole)) return false
    if (Array.isArray(part)) return part.length === (whole as unknown[]).length && part.every((v, i) => within(v, (whole as unknown[])[i]))
    return Object.entries(part).every(([k, v]) => within(v, (whole as Record<string, unknown>)[k]))
  }
  const [want, got] = [parse(expected), parse(actual)]
  return want !== undefined && got !== undefined && within(got, want)
}

async function arrived(root: string, profile: Profile, theme: Theme, files: Map<string, string | null>): Promise<boolean> {
  const dir = mkdtempSync(join(tmpdir(), 'themesmith-sync-'))
  try {
    const only = [...files.keys()].flatMap((f) => ['--only', f])
    const r = await cli<{ status: string }>(root, profile, 'pull', '--theme', theme.id, '--path', dir, ...only)
    if (!r.ok) return false
    return [...files].every(([f, expected]) => {
      const path = join(dir, f)
      if (expected === null) return !existsSync(path)
      return existsSync(path) && sameContent(f, expected, readFileSync(path, 'utf8'))
    })
  } finally {
    rmSync(dir, { recursive: true, force: true })
  }
}

// Waits for Shopify to copy the save into a connected theme, checking every few seconds. With several themes of
// the branch's name, the first to receive it is the one.
// THEMESMITH_SYNC_SECONDS changes how long it waits (90 seconds by default).
export async function waitForSync(root: string, profile: Profile, themes: Theme[], files: Map<string, string | null> | null): Promise<Theme | null> {
  if (themes.length === 0 || files === null) return null
  if (files.size === 0) return themes.length === 1 ? themes[0] : null
  const timeoutMs = Number(process.env.THEMESMITH_SYNC_SECONDS ?? 90) * 1000
  const end = Date.now() + timeoutMs
  while (true) {
    const results = await Promise.all(themes.map((t) => arrived(root, profile, t, files)))
    const synced = themes.find((_, i) => results[i])
    if (synced) return synced
    if (Date.now() >= end) return null
    await Bun.sleep(Math.min(5_000, timeoutMs / 3))
  }
}

// The note under a development theme's preview link. Shopify has no link to its "Connect from GitHub" dialog, so
// it links the themes page and names the clicks.
export function connectTip(profile: Profile, branch: string): string {
  return (
    'Tip: a GitHub-connected preview theme is better, because GitHub-connected themes sync changes in both directions. ' +
    `To set it up, go to your themes (https://${profile.store}/admin/themes), choose Add theme, then Connect from GitHub, and pick this repository and the branch \`${branch}\`. ` +
    'Once it is connected, themesmith finds it on the next save and gives you its link instead. ' +
    "Until then, ask me for changes rather than editing this preview in Shopify's theme editor: the next save replaces it, editor changes included."
  )
}

// Deletes the branch's development theme once a connected theme has the branch's changes: it would only go
// stale. Only a development theme with exactly this branch's name is ever deleted.
async function removeDevelopment(root: string, profile: Profile, branch: string, theme: Theme | null): Promise<string | undefined> {
  if (!theme || theme.role !== 'development' || theme.name !== devContext(branch)) return undefined
  const r = await cli(root, profile, 'delete', '--theme', theme.id, '--force')
  return r.ok ? theme.name : undefined
}

// Uploads the built folder to the branch's development theme, making it on the first save.
export async function pushDevelopment(root: string, profile: Profile, branch: string): Promise<Preview | Failure> {
  type Pushed = { status: string; theme: Theme; issues: { filePath: string; message: string }[] }
  const r = await cli<Pushed>(root, profile, 'push', '--development', '--development-context', devContext(branch), '--path', root)
  if (!r.ok) return r
  if (r.result.status !== 'success' && r.result.status !== 'partial') return { ok: false, step: 'preview', message: `The Shopify CLI didn't upload the preview (${r.result.status}).` }
  const issues = r.result.issues.map((i) => ({ file: isAbsolute(i.filePath) ? relative(root, i.filePath).replace(/\\/g, '/') : i.filePath, message: i.message }))
  if (!r.exitedOk || issues.length > 0) {
    return { ok: false, step: 'preview', message: `Some files didn't upload to the preview theme "${r.result.theme.name}". Fix them and save again.`, issues }
  }
  return { ...links(profile, r.result.theme, 'development'), connectTip: connectTip(profile, branch) }
}

// After a save: the connected theme once the save has reached it, otherwise the development theme.
export async function updatePreview(root: string, profile: Profile, branch: string, found: Found, files: Map<string, string | null> | null): Promise<Preview | Failure> {
  const synced = await waitForSync(root, profile, found.connected, files)
  if (!synced) return pushDevelopment(root, profile, branch)
  const removed = await removeDevelopment(root, profile, branch, found.development)
  return { ...links(profile, synced, 'connected'), ...(removed ? { removedDevelopment: removed } : {}) }
}

export function previewLinks(profile: Profile, theme: Theme, kind: Preview['kind']): Preview {
  return links(profile, theme, kind)
}
