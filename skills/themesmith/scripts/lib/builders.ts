// Files page builder apps write into the theme. They are live page content, so they are pushed like any other
// file, but Theme Check and code review skip them: the app regenerates them, and edits belong in the app.
// Every pattern starts with the builder's own name or prefix so it can't catch a merchant's files, and setup
// adds a pattern only when it matches files in the theme.
export type PageBuilder = { name: string; patterns: string[] }

export const PAGE_BUILDERS: PageBuilder[] = [
  // Seen in a store's theme: snippets/replo-head.liquid, snippets/reploChunk.<uuid>.<n>.liquid, templates/page.replo.<uuid>.liquid
  { name: 'Replo', patterns: ['snippets/replo*', 'sections/replo*', 'templates/*.replo.*'] },
  // gp-section-<id> snippets and the theme.gem-layout-none layout, from GemPages' help center and error reports.
  { name: 'GemPages', patterns: ['snippets/gp-section-*', 'layout/theme.gem-*', 'templates/*.gem-*'] },
  // theme.pagefly.liquid and snippets/pagefly-header.liquid, from PageFly's help center and Shopify community.
  { name: 'PageFly', patterns: ['layout/theme.pagefly*', 'snippets/pagefly-*', 'templates/*.pf-*'] },
  // The files Shogun's removal guide lists.
  { name: 'Shogun', patterns: ['layout/theme.shogun.*', 'templates/*.shogun.*', 'sections/shogun-*', 'snippets/shogun-*'] },
]

// Theme Check's glob style: `**` crosses folders, `*` and `?` stay inside one.
export function pathGlob(pattern: string, path: string): boolean {
  const source = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replace(/\*\*/g, '\u0000')
    .replace(/\*/g, '[^/]*')
    .replace(/\?/g, '[^/]')
    .replace(/\u0000/g, '.*')
  return new RegExp(`^${source}$`).test(path)
}

export function builderOf(path: string): string | null {
  return PAGE_BUILDERS.find((b) => b.patterns.some((p) => pathGlob(p, path)))?.name ?? null
}
