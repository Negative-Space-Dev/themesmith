// Runs Theme Check on only the given files, the way Shopify's VS Code extension does: each file is checked on
// its own, and whatever a check needs from the rest of the theme (snippets, section and block schemas,
// translations) is read from disk only when asked for. Results match a full `shopify theme check` for those
// files, in about a second instead of the half minute a large theme takes.
//
// theme-check.ts starts this file with `bun --tsconfig-override=tsconfig.isolated.json`: the published
// packages include their build tsconfig.json, whose `paths` would send Bun to their TypeScript sources.
//
//   bun --tsconfig-override=<this folder>/tsconfig.isolated.json theme-check-files.ts <theme root> [--baseline <dir>] <file>...
// With --baseline, each checked file's text is read from <dir>/<file> instead (an earlier version of it), while
// everything it refers to is still read from the theme: what the file's earlier version got reported.
// Prints a JSON array of offenses: { check, file, line, column, severity: 'error' | 'warning' | 'info', message }.
import { isLiquidHtmlNode } from '@shopify/liquid-html-parser'
import { check, filePathSupportsLiquidDoc, extractDocDefinition, JSONValidator, memo, toSchema, toSourceCode as parseSource } from '@shopify/theme-check-common'
import { ThemeLiquidDocsManager } from '@shopify/theme-check-docs-updater'
import { loadConfig, NodeFileSystem, toSourceCode } from '@shopify/theme-check-node'
import { existsSync, readFileSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [rootArg, ...rest] = process.argv.slice(2)
const baselineFlag = rest.indexOf('--baseline')
const baseline = baselineFlag === -1 ? null : rest[baselineFlag + 1]
const files = baselineFlag === -1 ? rest : rest.filter((_, i) => i !== baselineFlag && i !== baselineFlag + 1)
const root = resolve(rootArg)
const configPath = join(root, '.theme-check.yml')
// The config path is always passed: under Bun, the library's own lookup returns the wrong type.
const config = await loadConfig(existsSync(configPath) ? configPath : 'theme-check:recommended', root)
const docs = new ThemeLiquidDocsManager(() => {})
// Its setup downloads the latest Liquid docs from GitHub on every run, with no timeout, which made a check take
// anywhere from a fraction of a second to several. Skipping it uses the docs downloaded earlier, or else the ones
// bundled with the package.
docs.setup = memo(async () => {})
const isValidSchema = (await JSONValidator.create(docs, config))?.isValid

const sources = new Map<string, ReturnType<typeof toSourceCode>>()
function source(relativePath: string) {
  if (!sources.has(relativePath)) sources.set(relativePath, toSourceCode(join(root, relativePath)))
  return sources.get(relativePath)!
}
const schemaIn = (dir: string) => async (name: string) => {
  const file = await source(`${dir}/${name}.liquid`)
  return file ? toSchema(config.context, file.uri, file, isValidSchema) : undefined
}

async function checked(relativePath: string) {
  const current = await source(relativePath)
  if (!baseline || !current) return current
  return parseSource(current.uri, readFileSync(join(baseline, relativePath), 'utf8'))
}

const theme = (await Promise.all(files.map(checked))).filter((f) => f !== undefined)
const offenses = await check(theme, config, {
  fs: NodeFileSystem,
  themeDocset: docs,
  jsonValidationSet: docs,
  getSectionSchema: schemaIn('sections') as never,
  getBlockSchema: schemaIn('blocks') as never,
  getAppBlockSchema: schemaIn('blocks') as never,
  getDocDefinition: async (relativePath: string) => {
    const file = await source(relativePath)
    if (!file || !isLiquidHtmlNode(file.ast) || !filePathSupportsLiquidDoc(file.uri)) return undefined
    return extractDocDefinition(file.uri, file.ast)
  },
})

const SEVERITY = ['error', 'warning', 'info'] as const
const prefix = config.rootUri.replace(/\/?$/, '/')
console.log(
  JSON.stringify(
    offenses.map((o) => ({
      check: o.check,
      file: decodeURIComponent(o.uri.startsWith(prefix) ? o.uri.slice(prefix.length) : o.uri),
      line: o.start.line + 1,
      column: o.start.character + 1,
      severity: SEVERITY[o.severity] ?? 'info',
      message: o.message,
    }))
  )
)
