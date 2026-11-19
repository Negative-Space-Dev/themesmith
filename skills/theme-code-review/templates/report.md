# Shopify Theme Code Review — <target>

Always emit every section. Use `_None_` when a section is empty so the format is
stable across runs. Order findings by severity: blocker → high → medium → low.

## Overview

**Target:** <files / diff range reviewed>  
**Checked:** <applicable categories, e.g. `images`, `video`, `liquid-performance`>  
**Skipped:** <categories filtered out by applies-when, or `_None_`>  

🪄 <N> automatic fixes  
🛠️ <M> fixes proposed  
👀 <K> manual review  
✅ <J> passed

<!-- Each count line ends with two spaces for a line break. Keep all four lines, with 0 where a count is zero. -->

## 🪄 Automatic Fixes

Already applied because the edit was deterministic. Re-checked after applying.

- `[IMG-01]` **<title>** — `path:line` — <what changed>
- ...

If empty, write `_None_`.

## 🛠️ Proposed Fixes

Review these before applying. Keep each proposal focused on one rule and one
small code change.

### `[LIQUID-01]` <title>

**Severity:** blocker  
**Location:** `path:line`  
**Why it matters:** <one concise sentence>

```diff
--- a/path/to/file.liquid
+++ b/path/to/file.liquid
@@
- <before>
+ <after>
```

If empty, write `_None_`.

## 👀 Manual Checks

Things only a person can verify, decide, or approve.

- [ ] `[IMG-04]` **<title>** — `path:line` — severity: low — <what to verify>
- [ ] `[MODAL-03]` **<title>** — `path:line` — severity: high — <what to verify>

If empty, write `_None_`.

## ✅ Passed Checks

Applicable checks that passed, collapsed for readability.

<details>
<summary>N checks passed</summary>

- `[IMG-02]` <item> — `path:line`
- ...

</details>
