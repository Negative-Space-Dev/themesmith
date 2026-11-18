// For skills installed inside one theme (in .agents/skills) rather than for the whole computer: makes them
// visible to agents that don't read that folder, by writing small pointer skills into the agent's own folder.
//
//   bun agents.ts add <agent>        e.g. claude; prints what each agent needs
//   bun agents.ts add --dir <path>   any other agent's skills folder, e.g. .gemini/skills
//   bun agents.ts sync               rewrite every pointer from the current skills
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { findRoot } from './lib/profile.ts'

// null skillsDir: the agent reads .agents/skills itself.
const AGENTS: Record<string, { skillsDir: string | null }> = {
  claude: { skillsDir: '.claude/skills' },
  codex: { skillsDir: null },
  cursor: { skillsDir: null },
}

const SOURCE = '.agents/skills'
const POINTER_MARK = '<!-- themesmith:pointer -->'
// Pointers written before the skill was renamed from theme-dev; `sync` rewrites or removes them like current ones.
const LEGACY_POINTER_MARK = '<!-- theme-dev:pointer -->'

const root = findRoot()

function skills(): string[] {
  return readdirSync(join(root, SOURCE), { withFileTypes: true })
    .filter((d) => d.isDirectory() && existsSync(join(root, SOURCE, d.name, 'SKILL.md')))
    .map((d) => d.name)
    .sort()
}

function pointer(name: string): string {
  const source = readFileSync(join(root, SOURCE, name, 'SKILL.md'), 'utf8')
  const frontmatter = source.match(/^---\r?\n[\s\S]*?\r?\n---\r?\n/)
  if (!frontmatter) throw new Error(`${SOURCE}/${name}/SKILL.md has no frontmatter`)
  return `${frontmatter[0]}${POINTER_MARK}\nRead \`${SOURCE}/${name}/SKILL.md\` and follow it. \`<skill>\` in it means \`${SOURCE}/${name}\`. Edit that file, not this one; \`bun ${SOURCE}/themesmith/scripts/agents.ts sync\` rewrites this pointer.\n`
}

function isPointer(path: string): boolean {
  if (!existsSync(path)) return false
  const text = readFileSync(path, 'utf8')
  return text.includes(POINTER_MARK) || text.includes(LEGACY_POINTER_MARK)
}

// Every skills folder that already holds a pointer, so `sync` needs no record of which agents were added.
function pointerDirs(): string[] {
  return readdirSync(root, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name.startsWith('.') && d.name !== '.agents' && d.name !== '.git')
    .map((d) => `${d.name}/skills`)
    .filter((dir) => existsSync(join(root, dir)) && readdirSync(join(root, dir)).some((s) => isPointer(join(root, dir, s, 'SKILL.md'))))
}

function writePointers(dir: string): string[] {
  const written: string[] = []
  const current = skills()
  for (const name of current) {
    const target = join(root, dir, name, 'SKILL.md')
    if (existsSync(target) && !isPointer(target)) continue
    const content = pointer(name)
    if (existsSync(target) && readFileSync(target, 'utf8') === content) continue
    mkdirSync(join(root, dir, name), { recursive: true })
    writeFileSync(target, content)
    written.push(`${dir}/${name}/SKILL.md`)
  }
  for (const name of readdirSync(join(root, dir))) {
    if (!current.includes(name) && isPointer(join(root, dir, name, 'SKILL.md'))) rmSync(join(root, dir, name), { recursive: true })
  }
  return written
}

const [command, ...rest] = process.argv.slice(2)
const changed: string[] = []

if (command === 'add') {
  const dirFlag = rest.indexOf('--dir')
  const agent = dirFlag === -1 ? AGENTS[rest[0] ?? ''] : { skillsDir: rest[dirFlag + 1].replace(/\/$/, '') }
  if (!agent) {
    console.error(`Unknown agent "${rest[0] ?? ''}". Known: ${Object.keys(AGENTS).join(', ')}. For any other agent pass --dir <its skills folder>.`)
    process.exit(2)
  }
  if (agent.skillsDir) changed.push(...writePointers(agent.skillsDir))
} else if (command === 'sync') {
  for (const dir of pointerDirs()) changed.push(...writePointers(dir))
} else {
  console.error('Usage: bun agents.ts add <agent> | add --dir <skills folder> | sync')
  process.exit(2)
}
console.log(JSON.stringify({ ok: true, pointerDirs: pointerDirs(), written: changed }, null, 2))
