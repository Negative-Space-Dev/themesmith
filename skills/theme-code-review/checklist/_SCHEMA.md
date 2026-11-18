# Checklist item schema

Two-tier structure: **checklist indexes** (conditions + routing) and **rules**
(examples + fix guidance). The skill runs checks first; rules load only when an
item applies or fails.

## Directory layout

```
theme-code-review/
├── SKILL.md
├── checklist/
│   ├── README.md              # category registry
│   ├── images.md              # index — conditions only
│   └── liquid-performance.md
└── rules/
    ├── README.md
    ├── image-explicit-width-height.mdc
    └── liquid-avoid-date-operations.mdc
```

## Category index file

Each category has one **index** at `checklist/<category>.md`. Loaded only when
the category's `applies-when` is true.

````markdown
# <Category name>

- **id:** images
- **applies-when:** <plain-language condition>
- **detect-signal:** <regex hints for `scripts/cli.ts detect`>

---

#### IMG-01 — <short imperative title>

- **applies-when:** <item-level condition>
- **check:** auto | manual
- **fix:** auto | propose | manual
- **severity:** blocker | high | medium | low
- **rule**: `rules/<semantic-slug>.mdc`
````

**Index files must NOT contain:** rationale, how-to-fix steps, or good/bad examples.

## Rule file (`.mdc`)

Each item has one Cursor rule at `rules/<semantic-slug>.mdc` (relative to
`<skill-dir>`). **Filenames are descriptive** (e.g.
`liquid-avoid-date-operations.mdc`), not opaque IDs. The stable check ID
(`LIQUID-06`) lives in frontmatter and checklist indexes for scripts and reports.

Rules use `alwaysApply: false` and no `globs` — they are **not** auto-injected.
The review skill reads them only when the item applies or a check fails.

````markdown
---
description: "Shopify Liquid performance: 'now' | date breaks page cache. Use when comparing against current time in Liquid."
id: LIQUID-06
alwaysApply: false
---

# LIQUID-06 — Avoid cache-breaking date operations
...
````

Write `description` so an agent can tell **when** the rule applies without
reading the body. Keep the canonical slug list in `scripts/lib/rule-registry.ts`.

## Field rules

- **id** (checklist + rule frontmatter): `CATEGORY-NN` — stable for scripts,
  reports, and auto-check output. Never renumber.
- **rule** (checklist index): path like `rules/liquid-avoid-date-operations.mdc`.
- **check: auto** — runnable via `scripts/cli.ts` (documented in the rule).
- **fix: auto** — safe, deterministic; exact edit in the rule body.

## Orchestrator loading order

1. Category `applies-when` false → skip index and all rules for that category.
2. Category applies → read the category **index** only.
3. Run applicable checks (auto scripts + manual evaluation from index metadata).
4. Item `applies-when` false → skip that rule entirely.
5. Item applies or **check fails** → read `rules/<semantic-slug>.mdc`, then fix/propose/report.

## Routing summary

| check  | fix     | On failure, read rule then…                    |
|--------|---------|------------------------------------------------|
| auto   | auto    | apply fix from rule, re-check                  |
| auto   | propose | draft diff using rule examples                 |
| auto   | manual  | add to manual checklist with rule guidance     |
| manual | auto    | apply fix from rule                            |
| manual | propose | draft diff using rule examples                 |
| manual | manual  | add to manual checklist with rule guidance     |
