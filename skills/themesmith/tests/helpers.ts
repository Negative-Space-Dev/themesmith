// Fakes for the programs the scripts run, built so they work on Mac, Linux and Windows alike.
import { chmodSync, mkdirSync, symlinkSync, writeFileSync } from 'node:fs'
import { delimiter, dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'

export const windows = process.platform === 'win32'

// PATH with these folders in front.
export const pathWith = (...dirs: string[]) => [...dirs, process.env.PATH].join(delimiter)

// A command named `name` in `bin` that runs `source` (TypeScript) on Bun: an executable script on Mac and Linux, a
// .cmd file on Windows, where a file needs an extension to run as a command.
export function installCommand(bin: string, name: string, source: string) {
  const script = join(bin, 'scripts', `${name}.ts`)
  mkdirSync(dirname(script), { recursive: true })
  writeFileSync(script, source)
  if (windows) {
    writeFileSync(join(bin, `${name}.cmd`), `@"${process.execPath}" "${script}" %*\r\n`)
  } else {
    writeFileSync(join(bin, name), `#!/bin/sh\nexec "${process.execPath}" "${script}" "$@"\n`)
    chmodSync(join(bin, name), 0o755)
  }
}

// A fake Shopify CLI in `bin`, installed the way the CLI's own installs lay it out, so lib/shopify.ts must find
// its entry script and run it on Bun. Mac and Linux: `shopify` links straight to the script, which has no
// shebang, so running it as a plain command would fail (Bun.which, like a shell, needs the execute bit). Windows: npm's `shopify.cmd` beside
// node_modules/@shopify/cli/bin/run.js. `source` is the CLI.
export function installFakeShopify(bin: string, source: string) {
  const cli = join(bin, 'cli', 'run.ts')
  mkdirSync(dirname(cli), { recursive: true })
  writeFileSync(cli, source)
  if (!windows) {
    chmodSync(cli, 0o755)
    symlinkSync(cli, join(bin, 'shopify'))
    return
  }
  writeFileSync(join(bin, 'shopify.cmd'), '@exit /b 1\r\n')
  const entry = join(bin, 'node_modules', '@shopify', 'cli', 'bin', 'run.js')
  mkdirSync(dirname(entry), { recursive: true })
  writeFileSync(entry, `await import(${JSON.stringify(pathToFileURL(cli).href)})\n`)
}
