---
name: theme-code-review
description: >-
  Master Shopify theme code review. Scans changed Liquid/JS/CSS, detects which
  best-practice categories apply (images, video, modals, Liquid performance,
  Tailwind CSS, accessibility, etc.), runs automatic checks, proposes targeted
  fixes, and
  outputs a consistent report of manual checks and proposed changes. Use when
  reviewing Shopify theme code, a section/snippet, or a theme PR, or when the
  user asks for a theme code review or best-practice audit.
---

# Shopify Theme Code Review

A single review entry point that filters a best-practice checklist down to what
is relevant, runs checks, and loads **rules** only when an item applies or fails.

## Core model

Three layers with progressive disclosure:

1. **Checklist index** (`checklist/<category>.md`) — `applies-when`, check/fix
   routing, severity, and a `rule:` path. No examples. Loaded when the category
   applies.
2. **Checks** (`scripts/cli.ts`) — mechanical auto-checks; run against target
   files without loading rule content.
3. **Rules** (`rules/<semantic-slug>.mdc`) — rationale, good/bad examples, fix
   guidance. Each rule's frontmatter has a plain-language `description` (when to
   use it) and stable `id` (e.g. `LIQUID-06`) matching auto-check output. Loaded
   **only** when an item applies or a check fails.

Never read rules for categories or items that did not apply. Never read rules
up front — run detection and checks first, then pull in the specific rule.

Each index item is tagged:

- **check**: `auto` | `manual`
- **fix**: `auto` | `propose` | `manual` (`auto` only for exact deterministic edits)
- **severity**: `blocker` | `high` | `medium` | `low`
- **rule**: `rules/<semantic-slug>.mdc` (see `scripts/lib/rule-registry.ts` for
  ID ↔ slug map)

See `checklist/_SCHEMA.md` and `rules/README.md`.

## Prerequisites

Mechanical checks run via **Bun**. Requires [Bun](https://bun.sh) installed. For
maintenance commands (`typecheck`, `sync-rules`), run `bun install` in
`scripts/` first.

## Workflow

```
Review progress:
- [ ] 1. Determine target files
- [ ] 2. Detect applicable categories
- [ ] 3. Load applicable checklist indexes
- [ ] 4. Run checks (auto scripts + manual) — do NOT load rules yet
- [ ] 5. For failures/applicable manual items → read the rule file
- [ ] 6. Apply only clearly deterministic edits; otherwise draft proposals / manual checklist
- [ ] 7. Emit report
```

### 1. Determine target files

Default to the current branch diff from the theme root:

```bash
git diff --name-only --diff-filter=d $(git merge-base HEAD origin/main 2>/dev/null || echo HEAD~1)..HEAD
```

If no meaningful diff, ask the user for paths. Focus on changed files/regions.

### 2. Detect applicable categories

```bash
bun "<skill-dir>/scripts/cli.ts" detect <file> [<file> ...]
```

Confirm each hit against `applies-when` in `checklist/README.md`. Skip categories
that do not apply — do not read their indexes or rules.

### 3. Load applicable checklist indexes

Read only matched index files (e.g. `checklist/images.md`). These contain
conditions and routing only.

### 4. Run checks (rules stay unloaded)

For each applicable item, verify item-level `applies-when`. Then:

- **check: auto** — run `scripts/cli.ts check <category>`. Output:
  `<ITEM-ID>\t<path:line>\t<message>`.
- **check: manual** — evaluate from the code using the item title and index
  metadata (still no rule file yet unless you need the "How to check" section).

Auto-checks emit failures only. Track pass / fail / skipped per item ID from
the applicable checklist plus the command output. Exit codes: `0` no findings,
`1` findings emitted, `2` invalid input/usage.

### 5. Load rules for failures and manual items

**Only now** read rule files — and only for items that failed or need manual
review:

```text
<skill-dir>/rules/liquid-avoid-date-operations.mdc   # id: LIQUID-06 in frontmatter
```

Use the rule's examples and "How to fix" to:

- **fix: auto** — apply the deterministic edit, re-run the auto-check
- **fix: propose** — draft a diff using the Good example as guidance
- **fix: manual** — add to the report checklist citing the rule

Do not read rules for passing items or items whose `applies-when` was false.

### 6. Auto-check commands

```bash
bun "<skill-dir>/scripts/cli.ts" check images <file> [<file> ...]
bun "<skill-dir>/scripts/cli.ts" check video <file> [<file> ...]
bun "<skill-dir>/scripts/cli.ts" check liquid-performance <file> [<file> ...]
bun "<skill-dir>/scripts/cli.ts" check modals-dialogs <file> [<file> ...]
bun "<skill-dir>/scripts/cli.ts" check tailwind <file> [<file> ...]
bun "<skill-dir>/scripts/cli.ts" check all <file> [<file> ...]
```

### 7. Emit report

Use `templates/report.md`. Cite the rule ID (e.g. `[LIQUID-06]`) for each finding.

## Adding best practices

1. Add a row to the category **index** with stable `#### ID` and
   `rule: rules/<semantic-slug>.mdc`.
2. Add an entry to `scripts/lib/rule-registry.ts`, create the **rule** file, run
   `bun scripts/sync-rule-registry.ts`.
3. Add script coverage in `scripts/checks/` when `check: auto`.

Put all good/bad examples in `rules/`, never in the checklist index.
