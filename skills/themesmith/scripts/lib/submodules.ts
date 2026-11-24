// Private code a theme includes as a Git submodule. Someone without access to its repository has an empty folder
// there, and the files it builds are already in the theme, so the commands that run inside it are skipped for them.
import { spawnSync } from 'node:child_process'
import { existsSync, readdirSync } from 'node:fs'
import { join, posix } from 'node:path'
import type { Command } from './profile.ts'

// Only a path listed in .gitmodules counts: any other missing or empty folder is a mistake in the profile, and its
// command still runs and fails.
function missingSubmodules(root: string): string[] {
  const listed = spawnSync('git', ['config', '-z', '--file', '.gitmodules', '--get-regexp', '^submodule\\..*\\.path$'], { cwd: root, encoding: 'utf8' })
  if (listed.status !== 0) return []
  const paths = listed.stdout.split('\0').filter(Boolean).map((entry) => entry.slice(entry.indexOf('\n') + 1))
  return paths.filter((path) => !existsSync(join(root, path)) || readdirSync(join(root, path)).length === 0)
}

export function splitByDownloaded(root: string, commands: Command[]): { runnable: Command[]; skipped: Command[] } {
  const missing = missingSubmodules(root)
  const inMissing = (command: Command) => {
    const cwd = posix.normalize(command.cwd).replace(/\/$/, '')
    return missing.some((path) => cwd === path || cwd.startsWith(`${path}/`))
  }
  return { runnable: commands.filter((c) => !inMissing(c)), skipped: commands.filter(inMissing) }
}
