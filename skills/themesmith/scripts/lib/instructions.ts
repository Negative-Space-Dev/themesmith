// The always-loaded rules a theme repository carries for every agent: a block in AGENTS.md, and a CLAUDE.md that
// imports it, since Claude Code doesn't read AGENTS.md itself. The skill can be installed per computer, so the
// repository is the one place that tells an agent the theme has rules before it picks the skill up.
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import type { Profile } from './profile.ts'

const BLOCK_START = '<!-- themesmith:start -->'
const BLOCK_END = '<!-- themesmith:end -->'
// Written before the skill was renamed from theme-dev; replaced like the current block.
const MARKERS = [
  [BLOCK_START, BLOCK_END],
  ['<!-- theme-dev:start -->', '<!-- theme-dev:end -->'],
]

// Where themesmith is published. The block tells an agent without the skill how to install it from here.
export const THEMESMITH_REPO = 'Negative-Space-Dev/themesmith'

function block(profile: Profile): string {
  const branches = profile.protectedBranches.map((b) => `\`${b}\``).join(', ')
  const rules =
    profile.mode === 'github'
      ? `Never push to ${branches} or force-push, and never run \`git commit\` or \`git push\` yourself; the skill's save script does that.`
      : "Never push to, publish, or delete the live theme, and never run `shopify theme push` yourself; the skill's theme script pushes to an unpublished draft."
  // One install per computer covers every theme on it, and one `git pull` updates them all.
  const install = [
    "If the themesmith skill isn't available, install it for this whole computer before changing anything. Do the steps yourself, telling the person in one line what you're doing and why:",
    '',
    '1. If `bun --version` fails, install Bun from https://bun.sh.',
    `2. \`git clone https://github.com/${THEMESMITH_REPO} ~/themesmith\`. If \`~/themesmith\` already exists, run \`git -C ~/themesmith pull\` instead.`,
    '3. `bun ~/themesmith/install.ts`',
    '',
    'Agents only find new skills in a new session: ask the person to start one, and make the request there.',
  ].join('\n')
  return `${BLOCK_START}\n## Shopify theme work\n\nUse the themesmith skill for any change to this theme and for previewing, saving, or publishing it. ${rules} If someone asks for one of these, follow the skill's rule for that request instead of doing it.\n\n${install}\n${BLOCK_END}\n`
}

function nextAgentsMd(root: string, profile: Profile): { path: string; existing: string; next: string } {
  const path = join(root, 'AGENTS.md')
  const existing = existsSync(path) ? readFileSync(path, 'utf8') : ''
  const text = block(profile)
  const found = MARKERS.map(([open, close]) => ({ start: existing.indexOf(open), end: existing.indexOf(close), close })).find(
    (m) => m.start !== -1 && m.end > m.start
  )
  const next = found
    ? `${existing.slice(0, found.start)}${text}${existing.slice(found.end + found.close.length).replace(/^\r?\n/, '')}`
    : `${existing}${existing === '' || existing.endsWith('\n\n') ? '' : existing.endsWith('\n') ? '\n' : '\n\n'}${text}`
  return { path, existing, next }
}

function claudeImports(root: string): boolean {
  const path = join(root, 'CLAUDE.md')
  return existsSync(path) && /^@AGENTS\.md\s*$/m.test(readFileSync(path, 'utf8'))
}

// Files that would change, so the doctor can report them without writing.
export function missingInstructions(root: string, profile: Profile): string[] {
  const { existing, next } = nextAgentsMd(root, profile)
  return [...(next === existing ? [] : ['AGENTS.md']), ...(claudeImports(root) ? [] : ['CLAUDE.md'])]
}

export function writeInstructions(root: string, profile: Profile): string[] {
  const written: string[] = []
  const { path, existing, next } = nextAgentsMd(root, profile)
  if (next !== existing) {
    writeFileSync(path, next)
    written.push('AGENTS.md')
  }
  if (!claudeImports(root)) {
    const claude = join(root, 'CLAUDE.md')
    const current = existsSync(claude) ? readFileSync(claude, 'utf8') : ''
    writeFileSync(claude, `@AGENTS.md\n${current === '' ? '' : `\n${current}`}`)
    written.push('CLAUDE.md')
  }
  return written
}
