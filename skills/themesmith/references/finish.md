# Finishing a change ("looks good", "I'm done", "send it for approval", "ship it")

The code was already checked after each save (`references/review.md`). Finishing makes sure that check covers the latest changes, then hands the work off. Tell the person what you are doing in one line per step, not the commands. CLI mode runs step 1 only, then continues with "Finish and publish" in `references/cli.md`.

## 1. Make sure the review is current

```bash
bun <skill>/scripts/review-units.ts
```

If it lists no `units`, go on. If it lists some, review them now as in steps 2 and 3 of `references/review.md`. The person is waiting this time, so don't do it in the background.

## 2. Save

Saving formats every changed file whole (Prettier's Liquid support can't format part of a file), so the first save that touches an unformatted file also reformats the rest of it. Mention that in the pull request when it happens so the reviewer can tell formatting from the change. A file the formatter can't read (old HTML that was never well formed) is saved as it is, and the save's `format` step names it; mention that too.

```bash
bun <skill>/scripts/save.ts --message "<what changed, in plain words>"
```

If it fails, explain the failing step in plain words, fix it, and save again.

## 3. Open the pull request

If the branch has no pull request yet, open one against the default branch with `gh pr create`. The description has three parts:

- **What changed**: plain words a store owner would use ("The homepage banner now shows the fall sale headline").
- **Review**: what the code check fixed, and the findings left for the reviewer from `.themesmith/review-notes.md`, each with its rule ID and `path:line`. Findings that were already in the code before this change go under a separate "Already in the code" heading.
- **Preview**: the branch's `preview` link from the last save.

Tell the person the pull request link, that any review tools set up on the repository will comment on it, and that merging it publishes the change to the live store.
