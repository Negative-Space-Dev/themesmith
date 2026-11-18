// Installs every skill in skills/ for this computer's user, so it works in any theme folder. Each skill is a link
// back to this checkout, so `git pull` here updates every agent at once. Running it again is safe: it adds
// skills that are new, removes links to skills that were deleted, and leaves everything else alone.
//
//   bun install.ts                  Claude Code (~/.claude/skills) and Codex, Cursor, and others (~/.agents/skills)
//   bun install.ts --dir <path>     also link into another agent's user skills folder
//   bun install.ts --uninstall      remove the links this checkout made
import { existsSync, lstatSync, mkdirSync, readdirSync, readlinkSync, symlinkSync, unlinkSync } from 'node:fs'
import { homedir } from 'node:os'
import { dirname, join, resolve, sep } from 'node:path'

const SKILLS = join(import.meta.dir, 'skills')
const args = process.argv.slice(2)
const uninstall = args.includes('--uninstall')
const extra = args.flatMap((a, i) => (args[i - 1] === '--dir' ? [resolve(a)] : []))
const targets = [join(homedir(), '.claude', 'skills'), join(homedir(), '.agents', 'skills'), ...extra]

const skills = readdirSync(SKILLS, { withFileTypes: true })
  .filter((d) => d.isDirectory() && existsSync(join(SKILLS, d.name, 'SKILL.md')))
  .map((d) => d.name)

// A link this checkout made: it points inside skills/, whether or not that skill still exists.
function ours(path: string): boolean {
  if (!lstatSync(path, { throwIfNoEntry: false })?.isSymbolicLink()) return false
  return resolve(dirname(path), readlinkSync(path)).startsWith(SKILLS + sep)
}

const result = { linked: [] as string[], unchanged: [] as string[], removed: [] as string[], skipped: [] as { path: string; reason: string }[] }

for (const dir of targets) {
  if (!uninstall) mkdirSync(dir, { recursive: true })
  if (!existsSync(dir)) continue
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (ours(path) && (uninstall || !skills.includes(name))) {
      unlinkSync(path)
      result.removed.push(path)
    }
  }
  if (uninstall) continue
  for (const name of skills) {
    const path = join(dir, name)
    const source = join(SKILLS, name)
    if (lstatSync(path, { throwIfNoEntry: false })) {
      if (ours(path) && resolve(dirname(path), readlinkSync(path)) === source) result.unchanged.push(path)
      else result.skipped.push({ path, reason: 'something else is already installed under this name; move it away and run again' })
      continue
    }
    // A junction needs no admin rights on Windows; elsewhere the type is ignored.
    symlinkSync(source, path, 'junction')
    result.linked.push(path)
  }
}

// Skills with their own package.json (themesmith loads Theme Check from it) get their libraries, all at once.
const installs = uninstall
  ? []
  : await Promise.all(
      skills
        .filter((name) => existsSync(join(SKILLS, name, 'package.json')))
        .map(async (name) => {
          const proc = Bun.spawn(['bun', 'install', '--frozen-lockfile'], { cwd: join(SKILLS, name), stdout: 'pipe', stderr: 'pipe' })
          const [code, err] = await Promise.all([proc.exited, new Response(proc.stderr).text()])
          return { skill: name, ok: code === 0, ...(code === 0 ? {} : { error: err.trim().split('\n').slice(-5).join('\n') }) }
        })
    )
const ok = result.skipped.length === 0 && installs.every((i) => i.ok)
console.log(JSON.stringify({ ok, skills, ...result, libraries: installs }, null, 2))
process.exitCode = ok ? 0 : 1
