// Runs Theme Check on only the given files, the way Shopify's VS Code extension does: each file is checked on
// its own, and whatever a check needs from the rest of the theme (snippets, section and block schemas,
// translations) is read from disk only when asked for. Results match a full `shopify theme check` for those
// files, in about a second instead of the half minute a large theme takes.
//
// theme-check.ts starts this file with `bun --tsconfig-override=tsconfig.isolated.json`: the published
// packages include their build tsconfig.json, whose `paths` would send Bun to their TypeScript sources.
//
//   bun --tsconfig-override=<this folder>/tsconfig.isolated.json theme-check-files.ts <theme root> <file>...
// Prints a JSON array of offenses: { check, file, line, column, severity: 'error' | 'warning' | 'info', message }.
import { isLiquidHtmlNode } from '@shopify/liquid-html-parser'
import { check, filePathSupportsLiquidDoc, extractDocDefinition, JSONValidator, toSchema } from '@shopify/theme-check-common'
import { ThemeLiquidDocsManager } from '@shopify/theme-check-docs-updater'
import { loadConfig, NodeFileSystem, toSourceCode } from '@shopify/theme-check-node'
import { existsSync } from 'node:fs'
import { join, resolve } from 'node:path'

const [rootArg, ...files] = process.argv.slice(2)
const root = resolve(rootArg)
const configPath = join(root, '.theme-check.yml')
// The config path is always passed: under Bun, the library's own lookup returns the wrong type.
const config = await loadConfig(existsSync(configPath) ? configPath : 'theme-check:recommended', root)
const docs = new ThemeLiquidDocsManager(() => {})
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

const theme = (await Promise.all(files.map(source))).filter((f) => f !== undefined)
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
