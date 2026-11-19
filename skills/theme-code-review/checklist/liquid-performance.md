# Liquid performance & maintainability

- **id:** liquid-performance
- **applies-when:** The Liquid contains loops, pagination, global lookups, JSON
  serialization, date operations, snippet renders, hardcoded references, repeated
  blocks, or other non-trivial processing.
- **detect-signal:** `{% for`, `paginate`, `all_products`, `| json`, `'now' | date`,
  `{% render`, `{% include`, `collections`, `linklists`, `{% liquid`, `{% assign`

---

#### LIQUID-01 — No nested loops over large collections

- **applies-when:** a `{% for %}` appears inside another `{% for %}`, and one of
  them goes over a list that can be large (products, variants, collections,
  search results, articles). Nested loops over small fixed lists, such as a
  product's options and their values, are fine.
- **check:** auto
- **fix:** propose
- **severity:** blocker
- **rule:** rules/liquid-no-nested-loops.mdc

#### LIQUID-02 — Limit loops with `limit:` or pagination

- **applies-when:** a `{% for %}` iterates a collection without `limit:` and
  outside `{% paginate %}`
- **check:** auto
- **fix:** propose
- **severity:** high
- **rule:** rules/liquid-limit-collection-loops.mdc

#### LIQUID-03 — Avoid unscoped global collection lookups

- **applies-when:** `all_products`, bare `collections`, or `linklists` is accessed
- **check:** auto
- **fix:** propose
- **severity:** high
- **rule:** rules/liquid-avoid-global-lookups.mdc

#### LIQUID-04 — Use `{% render %}` instead of deprecated `{% include %}`

- **applies-when:** the template uses `{% include %}`
- **check:** auto
- **fix:** propose
- **severity:** medium
- **rule:** rules/liquid-use-render-not-include.mdc

#### LIQUID-05 — Hoist invariant work out of loops

- **applies-when:** a `{% for %}` body contains assignments/filters that do not
  depend on the loop variable
- **check:** manual
- **fix:** propose
- **severity:** medium
- **rule:** rules/liquid-hoist-invariant-out-of-loops.mdc

#### LIQUID-06 — Avoid cache-breaking date operations

- **applies-when:** `'now' | date` or time comparisons against the current moment
- **check:** auto
- **fix:** propose
- **severity:** high
- **rule:** rules/liquid-avoid-date-operations.mdc

#### LIQUID-07 — Avoid passing whole objects to snippets

- **applies-when:** `{% render %}` passes an object (`variant:`, `product:`,
  `collection:`, etc.) instead of primitive values
- **check:** auto
- **fix:** propose
- **severity:** medium
- **rule:** rules/liquid-avoid-passing-objects-to-snippets.mdc

#### LIQUID-08 — Avoid unnecessary JSON serialization

- **applies-when:** the `json` filter serializes a large object (product,
  collection, cart) when only a subset is needed client-side
- **check:** auto
- **fix:** propose
- **severity:** high
- **rule:** rules/liquid-avoid-unnecessary-json.mdc

#### LIQUID-09 — Break loops early when a match is found

- **applies-when:** a `{% for %}` assigns a value inside `{% if %}` on first match
  but does not `break`
- **check:** manual
- **fix:** propose
- **severity:** medium
- **rule:** rules/liquid-break-loops-early.mdc

#### LIQUID-10 — Prefer section settings over hardcoded global references

- **applies-when:** metafields, settings, or collection handles are hardcoded
  instead of exposed via section/block settings
- **check:** manual
- **fix:** propose
- **severity:** medium
- **rule:** rules/liquid-prefer-section-settings-over-hardcoded-refs.mdc

#### LIQUID-11 — Prefer Liquid array filters over manual loops

- **applies-when:** a `{% for %}` searches an array for one item by property
  (could use `find`, `where`, `map`, etc.)
- **check:** manual
- **fix:** propose
- **severity:** medium
- **rule:** rules/liquid-prefer-array-filters-over-loops.mdc

#### LIQUID-12 — Abstract repeated logic to snippets

- **applies-when:** the same Liquid logic or markup block appears more than once
  in the file/section, or a section/snippet has large duplicated conditional blocks
- **check:** manual
- **fix:** propose
- **severity:** medium
- **rule:** rules/liquid-abstract-repeated-logic-to-snippets.mdc
