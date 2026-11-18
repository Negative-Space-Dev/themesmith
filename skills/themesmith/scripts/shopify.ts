// Runs the Shopify CLI on Bun (see lib/shopify.ts). Profile commands use it in place of `shopify`:
//   bun {skill}/scripts/shopify.ts theme check --fail-level error
//   bun {skill}/scripts/shopify.ts theme dev --store example.myshopify.com
import { mkdtempSync, rmdirSync, symlinkSync, unlinkSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve, sep } from 'node:path'
import { NOT_INSTALLED, shopifyCommand } from './lib/shopify.ts'

const command = shopifyCommand()
if (!command) {
  console.error(NOT_INSTALLED)
  process.exit(1)
}

const args = process.argv.slice(2)
let link: string | null = null

// Theme Check stops applying .theme-check.yml's ignore list when the theme's path has a folder starting with a
// dot (as in ~/.worktrees/...): on a large theme it inspected 2183 files instead of 753 and reported 578 offenses
// instead of 2. Checking through a link whose path has no such folder gives the right result.
const pathFlag = args.indexOf('--path')
const themePath = resolve(pathFlag === -1 ? process.cwd() : args[pathFlag + 1])
if (args[0] === 'theme' && args[1] === 'check' && themePath.split(sep).some((part) => part.startsWith('.'))) {
  link = join(mkdtempSync(join(tmpdir(), 'themesmith-check-')), 'theme')
  symlinkSync(themePath, link, 'junction')
  if (pathFlag === -1) args.push('--path', link)
  else args[pathFlag + 1] = link
}

const child = Bun.spawn([...command, ...args], { stdio: ['inherit', 'inherit', 'inherit'] })
// `theme dev` runs until stopped. Pass a stop on to the CLI so it doesn't outlive this script and keep its port.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => child.kill(signal))
const status = await child.exited

// Remove only the link itself, never anything it points to.
if (link) {
  unlinkSync(link)
  rmdirSync(join(link, '..'))
}
process.exit(status)
