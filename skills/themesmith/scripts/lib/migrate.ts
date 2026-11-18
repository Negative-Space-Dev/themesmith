// Themes set up before this skill was renamed from theme-dev to themesmith keep their files under the old names.
// This moves them to the new ones. Safe to run any number of times: a file moves only while the old name exists
// and the new one doesn't, and an ignore line is rewritten only while it still names the old folder.
import { existsSync, readFileSync, renameSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const LEGACY_PROFILE_PATH = '.agents/theme-dev.json'

const RENAMED: [string, string][] = [
  [LEGACY_PROFILE_PATH, '.agents/themesmith.json'],
  ['.agents/theme-dev.md', '.agents/themesmith.md'],
  ['.agents/theme-dev.lock.json', '.agents/themesmith.lock.json'],
  ['.theme-dev', '.themesmith'],
]

// `.theme-dev/`, `/.theme-dev`, `.theme-dev/**`, and so on, on a line of their own.
const LEGACY_IGNORE_LINE = /^(\/?)\.theme-dev(\/(?:\*\*)?)?(?=\r?$)/gm

export function migrateLegacyNames(root: string): string[] {
  const moved: string[] = []
  for (const [from, to] of RENAMED) {
    if (!existsSync(join(root, from)) || existsSync(join(root, to))) continue
    renameSync(join(root, from), join(root, to))
    moved.push(`${from} -> ${to}`)
  }
  for (const file of ['.gitignore', '.shopifyignore']) {
    const path = join(root, file)
    if (!existsSync(path)) continue
    const text = readFileSync(path, 'utf8')
    const next = text.replace(LEGACY_IGNORE_LINE, '$1.themesmith$2')
    if (next === text) continue
    writeFileSync(path, next)
    moved.push(`${file}: .theme-dev -> .themesmith`)
  }
  return moved
}
