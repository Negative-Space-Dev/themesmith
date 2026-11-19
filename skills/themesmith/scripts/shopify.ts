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

const child = Bun.spawn([...command, ...args], { stdio: ['inherit', 'inherit', 'inherit'] })
// `theme dev` runs until stopped. Pass a stop on to the CLI so it doesn't outlive this script and keep its port.
for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP'] as const) process.on(signal, () => child.kill(signal))
const status = await child.exited

done()
process.exit(status)
