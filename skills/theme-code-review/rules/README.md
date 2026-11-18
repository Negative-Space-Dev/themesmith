# Shopify theme review rules

Cursor rules (`.mdc`) with rationale, good/bad examples, and fix guidance. Each
rule has a **semantic filename** and an agent-readable **description** in
frontmatter so it is clear when the rule applies.

## Naming

| Layer | Example | Purpose |
|-------|---------|---------|
| Check ID | `LIQUID-06` | Stable — scripts, reports, checklist indexes |
| Rule file | `liquid-avoid-date-operations.mdc` | Human/agent-readable |
| Description | frontmatter `description:` | When to use, without reading the body |

Canonical ID ↔ slug mapping: `scripts/lib/rule-registry.ts`. After adding or
renaming rules, run:

```bash
bun scripts/sync-rule-registry.ts
```

## Frontmatter

```yaml
---
description: "Shopify Liquid performance: 'now' | date breaks page cache. Use when comparing against current time in Liquid."
id: LIQUID-06
alwaysApply: false
---
```

## How rules relate to the skill

| Layer | Location | When loaded |
|-------|----------|-------------|
| Orchestrator | `SKILL.md` | User invokes theme review |
| Checklist index | `checklist/<category>.md` | Category `applies-when` passes |
| Auto-check | `scripts/cli.ts` | During checks — emits check ID (e.g. `LIQUID-06`) |
| Rule | `rules/<slug>.mdc` | Check fails or manual item applies |

Rules are not auto-injected (`alwaysApply: false`, no `globs`).

## Sources

Performance rules adapted from
[ProtonAgency/liquid-llm-rules](https://github.com/ProtonAgency/liquid-llm-rules/tree/main/liquid).
