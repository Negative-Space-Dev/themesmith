// Stands in for Shopify CLI 5's `shopify theme list|pull|push --json` in tests. Themes live under
// $FAKE_SHOPIFY/themes/<id>/, their list in $FAKE_SHOPIFY/themes.json, and every call is appended to
// $FAKE_SHOPIFY/calls.log. Creating $FAKE_SHOPIFY/verify makes every command stop for identity verification, as
// the real CLI does without a terminal. A theme file containing FAIL_UPLOAD makes a push partial.
// `push --development --development-context <name>` uploads to the development theme of that name, making it
// on first use; `pull --only <file>` (repeatable) pulls just those files.
import { appendFileSync, cpSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

type Theme = { id: number; name: string; role: string }

const home = process.env.FAKE_SHOPIFY!
const args = process.argv.slice(2)
appendFileSync(join(home, 'calls.log'), `${args.join(' ')}\n`)
const flag = (name: string) => (args.includes(name) ? args[args.indexOf(name) + 1] : undefined)
const result = (doc: unknown, exitCode = 0) => {
  console.log(JSON.stringify(doc))
  process.exit(exitCode)
}
const fail = (message: string, extra: Record<string, unknown> = {}) => result({ error: { type: 'abort', message, ...extra } }, 1)
if (!args.includes('--json')) fail('fake shopify: theme commands are called with --json')
if (existsSync(join(home, 'verify'))) {
  fail('Shopify needs to verify your identity before it can continue.', {
    nextSteps: ["Open https://accounts.shopify.com/verify/abc123 in a browser where you're logged in to Shopify, complete the verification, then run the command again."],
  })
}
const listPath = join(home, 'themes.json')
const list = JSON.parse(readFileSync(listPath, 'utf8')) as Theme[]
const THEME_DIRS = ['assets', 'config', 'layout', 'locales', 'sections', 'snippets', 'templates', 'blocks']

function target(): Theme {
  const theme = args.includes('--live') ? list.find((t) => t.role === 'live') : list.find((t) => String(t.id) === flag('--theme') || t.name === flag('--theme'))
  if (!theme) fail('theme not found')
  return theme!
}

function files(dir: string, rel = ''): string[] {
  return readdirSync(join(dir, rel)).flatMap((name) => {
    const path = rel ? `${rel}/${name}` : name
    return statSync(join(dir, path)).isDirectory() ? files(dir, path) : [path]
  })
}

function ignored(root: string, path: string): boolean {
  const ignore = join(root, '.shopifyignore')
  if (!existsSync(ignore)) return false
  return readFileSync(ignore, 'utf8')
    .split('\n')
    .filter(Boolean)
    .some((p) => (p.endsWith('/**') ? path.startsWith(p.slice(0, -2)) : p === path))
}

// CLI 5 output: string IDs, and URLs on the theme a push or pull names.
const out = (t: Theme) => ({ id: String(t.id), name: t.name, role: t.role })
const withUrls = (t: Theme) => ({ ...out(t), storeDomain: flag('--store') ?? null, previewUrl: `https://${flag('--store')}?preview_theme_id=${t.id}`, editorUrl: `https://${flag('--store')}/admin/themes/${t.id}/editor` })

const [, command] = args
if (command === 'list') {
  result({ themes: list.map((t) => ({ ...out(t), processing: false })) })
} else if (command === 'pull' && args.includes('--only')) {
  const theme = target()
  const from = join(home, 'themes', String(theme.id))
  const only = args.flatMap((a, i) => (args[i - 1] === '--only' ? [a] : []))
  for (const f of only) {
    if (!existsSync(join(from, f))) continue
    mkdirSync(join(flag('--path')!, f, '..'), { recursive: true })
    cpSync(join(from, f), join(flag('--path')!, f))
  }
  result({ status: 'success', changed: true, directory: flag('--path'), theme: { ...withUrls(theme), processing: false, sourceUrl: null } })
} else if (command === 'pull') {
  // Like the real CLI without --nodelete, the folder ends up matching the theme exactly.
  const theme = target()
  const from = join(home, 'themes', String(theme.id))
  for (const top of THEME_DIRS) rmSync(join(flag('--path')!, top), { recursive: true, force: true })
  cpSync(from, flag('--path')!, { recursive: true })
  result({ status: 'success', changed: true, directory: flag('--path'), theme: { ...withUrls(theme), processing: false, sourceUrl: null } })
} else if (command === 'delete') {
  const ids = args.flatMap((a, i) => (args[i - 1] === '--theme' ? [a] : []))
  const remaining = list.filter((t) => !ids.includes(String(t.id)))
  writeFileSync(listPath, JSON.stringify(remaining))
  for (const id of ids) rmSync(join(home, 'themes', id), { recursive: true, force: true })
  result({ themes: list.filter((t) => ids.includes(String(t.id))).map((t) => out(t)) })
} else if (command === 'push') {
  if (args.includes('--live') || args.includes('--publish')) process.exit(99)
  let theme: Theme
  if (args.includes('--development')) {
    const context = flag('--development-context')!
    if (context.length > 50) fail('Name is too long (maximum is 50 characters)')
    theme = list.find((t) => t.role === 'development' && t.name === context) ?? { id: Math.max(...list.map((t) => Number(t.id))) + 1, name: context, role: 'development' }
    if (!list.includes(theme)) {
      list.push(theme)
      writeFileSync(listPath, JSON.stringify(list))
    }
  } else if (args.includes('--unpublished')) {
    theme = { id: Math.max(...list.map((t) => Number(t.id))) + 1, name: flag('--theme')!, role: 'unpublished' }
    list.push(theme)
    writeFileSync(listPath, JSON.stringify(list))
  } else theme = target()
  // The real CLI asks before pushing to the live theme, which fails without a terminal.
  if (theme.role === 'live' && !args.includes('--allow-live')) process.exit(98)
  const root = flag('--path')!
  const dest = join(home, 'themes', String(theme.id))
  const issues: { filePath: string; message: string }[] = []
  // Like the real CLI without --nodelete, the theme ends up matching the folder, except that a file that fails
  // to upload keeps its previous version.
  const previous = new Map(existsSync(dest) ? files(dest).map((f) => [f, readFileSync(join(dest, f))] as const) : [])
  rmSync(dest, { recursive: true, force: true })
  for (const top of THEME_DIRS) {
    if (!existsSync(join(root, top))) continue
    for (const f of files(root, top)) {
      if (ignored(root, f)) continue
      const content = readFileSync(join(root, f), 'utf8')
      if (content.includes('FAIL_UPLOAD')) {
        issues.push({ filePath: f, message: 'Liquid syntax error' })
        const kept = previous.get(f)
        if (kept) {
          mkdirSync(join(dest, f, '..'), { recursive: true })
          writeFileSync(join(dest, f), kept)
        }
        continue
      }
      mkdirSync(join(dest, f, '..'), { recursive: true })
      // Like Shopify, drop settings the theme doesn't know about from pushed JSON.
      writeFileSync(join(dest, f), f.endsWith('.json') ? content.split('\n').filter((l) => !l.includes('unknown_setting')).join('\n') : content)
    }
  }
  result({ status: issues.length > 0 ? 'partial' : 'success', changed: true, theme: withUrls(theme), issues }, issues.length > 0 ? 1 : 0)
} else {
  fail(`fake shopify: unsupported ${args.join(' ')}`)
}
