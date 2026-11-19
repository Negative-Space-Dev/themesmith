import { afterEach, beforeEach, expect, test } from 'bun:test'
import { spawnSync } from 'node:child_process'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'

const CLI = resolve(import.meta.dir, '../scripts/cli.ts')
let dir: string

function write(file: string, content: string) {
  mkdirSync(join(dir, dirname(file)), { recursive: true })
  writeFileSync(join(dir, file), content)
}

// Each finding as "<rule ID> <file>:<line>".
function check(category: string, ...files: string[]): string[] {
  const r = spawnSync('bun', [CLI, 'check', category, ...files], { cwd: dir, encoding: 'utf8' })
  return r.stdout
    .split('\n')
    .filter(Boolean)
    .map((line) => line.split('\t').slice(0, 2).join(' '))
}

function detect(...files: string[]): string[] {
  return spawnSync('bun', [CLI, 'detect', ...files], { cwd: dir, encoding: 'utf8' }).stdout.split('\n').filter(Boolean)
}

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'theme-code-review-'))
  spawnSync('git', ['init', '-q'], { cwd: dir })
})

afterEach(() => rmSync(dir, { recursive: true, force: true }))

test('MODAL-01 flags the modal container, not the parts inside it', () => {
  write(
    'snippets/cart-drawer.liquid',
    [
      '<div class="cart-drawer">',
      '  <div class="cart-drawer__header">',
      '    <button class="modal-close drawer-toggle">Close</button>',
      '  </div>',
      '  <div class="modal-backdrop"></div>',
      '</div>',
    ].join('\n')
  )
  expect(check('modals-dialogs', 'snippets/cart-drawer.liquid')).toEqual(['MODAL-01 snippets/cart-drawer.liquid:1'])
})

test('LIQUID-01 leaves nested loops over small lists alone and flags those over products', () => {
  write(
    'sections/product.liquid',
    [
      '{% for option in product.options_with_values %}',
      '  {% for value in option.values %}{{ value }}{% endfor %}',
      '{% endfor %}',
      '{% for block in section.blocks %}',
      '  {% for item in block.settings.collection.products limit: 4 %}{{ item.title }}{% endfor %}',
      '{% endfor %}',
    ].join('\n')
  )
  expect(check('liquid-performance', 'sections/product.liquid').filter((f) => f.startsWith('LIQUID-01'))).toEqual(['LIQUID-01 sections/product.liquid:5'])
})

test('LIQUID-01 sees loops written inside a {% liquid %} tag', () => {
  write(
    'snippets/list.liquid',
    ['{%- liquid', '  for collection in collections', '    for product in collection.products', '      echo product.title', '    endfor', '  endfor', '-%}'].join('\n')
  )
  expect(check('liquid-performance', 'snippets/list.liquid').filter((f) => f.startsWith('LIQUID-01'))).toEqual(['LIQUID-01 snippets/list.liquid:3'])
})

test('Liquid checks skip JavaScript files', () => {
  write('assets/filters.js', 'const names = collections.map((c) => c.title)\n')
  expect(check('liquid-performance', 'assets/filters.js')).toEqual([])
})

test('a > inside Liquid in an <img> tag does not cut the tag short', () => {
  write(
    'snippets/card.liquid',
    '<img src="{{ image | image_url: width: 600 }}" {% if forloop.index > 2 %}loading="lazy"{% endif %} width="600" height="400" alt="{{ image.alt | escape }}" srcset="{{ image | image_url: width: 300 }} 300w">\n'
  )
  expect(check('images', 'snippets/card.liquid').filter((f) => !f.startsWith('IMG-05'))).toEqual([])
})

test('IMG-03 reads an image_tag call wrapped across lines as one call', () => {
  write(
    'snippets/hero.liquid',
    [
      '{{',
      '  section.settings.image',
      '  | image_url: width: 1600',
      '  | image_tag:',
      "    widths: '400, 800, 1600',",
      "    sizes: '100vw'",
      '}}',
      '{{ section.settings.logo | image_url: width: 200 | image_tag }}',
    ].join('\n')
  )
  expect(check('images', 'snippets/hero.liquid')).toEqual(['IMG-03 snippets/hero.liquid:8'])
})

test('Tailwind checks apply only to themes that use Tailwind, and see arbitrary values behind variants', () => {
  write('snippets/plain.liquid', '<div class="page-width">Hi</div>\n')
  expect(detect('snippets/plain.liquid')).not.toContain('tailwind')

  write('package.json', JSON.stringify({ devDependencies: { tailwindcss: '4.0.0' } }))
  write('snippets/banner.liquid', '<div class="md:w-[347px] hover:bg-[#ff0000]">Sale</div>\n')
  expect(detect('snippets/banner.liquid')).toContain('tailwind')
  expect(check('tailwind', 'snippets/banner.liquid')).toEqual(['TW-01 snippets/banner.liquid:1', 'TW-03 snippets/banner.liquid:1'])
})
