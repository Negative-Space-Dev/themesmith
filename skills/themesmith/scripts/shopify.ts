// Runs the Shopify CLI on Bun (see lib/shopify.ts). Profile commands use it in place of `shopify`:
//   bun {skill}/scripts/shopify.ts theme check --fail-level error
//   bun {skill}/scripts/shopify.ts theme dev --store example.myshopify.com
import { checkablePath, NOT_INSTALLED, shopifyCommand } from './lib/shopify.ts'

const command = shopifyCommand()
if (!command) {
  console.error(NOT_INSTALLED)
  process.exit(1)
}

const { args, done } = checkablePath(process.argv.slice(2), process.cwd())

// In a terminal the CLI gets it directly. Otherwise (a background preview writing to a log file) its output is read
// and passed on here: on Windows, output a child inherits that way never reached the file.
const terminal = process.stdout.isTTY === true
const child = Bun.spawn([...command, ...args], { stdin: 'inherit', stdout: terminal ? 'inherit' : 'pipe', stderr: terminal ? 'inherit' : 'pipe' })
const forward = (from: ReadableStream<Uint8Array> | number | undefined, to: NodeJS.WriteStream) =>
  from instanceof ReadableStream ? from.pipeTo(new WritableStream({ write: (chunk) => void to.write(chunk) })) : Promise.resolve()
const forwarded = Promise.all([forward(child.stdout, process.stdout), forward(child.stderr, process.stderr)])
// `theme dev` runs until stopped. Pass a stop on to the CLI so it doesn't outlive this script and keep its port.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => child.kill(signal))
const status = await child.exited
await forwarded

done()
process.exit(status)
