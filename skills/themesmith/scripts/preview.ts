// GitHub mode: this branch's preview (see lib/preview.ts), found by name. `save.ts` updates it. Prints JSON.
//   bun preview.ts           the preview links for this branch
//   bun preview.ts remove    after the work is merged: delete this branch's development theme. A theme
//                            connected to the branch is the person's to remove, in Shopify admin.
import { exec } from './lib/exec.ts'
import { devContext, findThemes, previewLinks } from './lib/preview.ts'
import { findRoot, loadProfile } from './lib/profile.ts'
import { runShopifyJsonAsync } from './lib/shopify.ts'

const root = findRoot()
const profile = loadProfile(root)
const branch = (await exec(['git', 'branch', '--show-current'], { cwd: root })).stdout.trim()
const command = process.argv[2] ?? 'status'
const print: (value: unknown, ok?: boolean) => never = (value, ok = true) => {
  console.log(JSON.stringify(value, null, 2))
  process.exit(ok ? 0 : 1)
}

const found = await findThemes(root, profile, branch)
if (!found.ok) print(found, false)

if (command === 'status') {
  if (found.connected.length === 1) print(previewLinks(profile, found.connected[0], 'connected'))
  if (found.development) print(previewLinks(profile, found.development, 'development'))
  print({ ok: true, preview: null, message: `No preview for "${branch}" yet. The next save makes one.` })
}

if (command === 'remove') {
  if (!found.development) print({ ok: true, removed: null, message: `"${branch}" has no development theme.` })
  // The name must still be this branch's, and the theme a development one, before anything is deleted.
  if (found.development.name !== devContext(branch) || found.development.role !== 'development') print({ ok: false, message: 'Refusing to delete a theme that is not this branch\'s development theme.' }, false)
  const r = await runShopifyJsonAsync(['theme', 'delete', '--theme', found.development.id, '--force', '--store', profile.store, '--no-input'], { cwd: root })
  if (r.kind === 'error') print({ ok: false, message: r.error.message }, false)
  print({ ok: true, removed: found.development.name, ...(found.connected.length ? { connected: found.connected.map((t) => t.name) } : {}) })
}

print({ ok: false, message: 'Usage: bun preview.ts [status|remove]' }, false)
