# GitHub mode

The live theme is connected to a protected branch (usually `main`): whatever lands there is published. Each piece of work gets its own branch, a preview theme connected to that branch, and a pull request that someone merges to publish it.

## Start a change

```bash
bun <skill>/scripts/start.ts <short-name-for-the-work>   # e.g. fall-sale-banner
```

It makes a new branch from the latest `main` and commits any files setup just changed. The first save makes the preview.

If it stops because the current branch already has work of its own, ask whether this request continues that work. Then run it again with `--continue` (keep working there) or `--new` (start a new branch anyway).

If it stops because of other unsaved changes (it lists their `files`), ask the person in plain words whether those changes belong to this new work. Then run it again with `--carry` (bring them along) or `--leave` (set them aside; `git stash pop` brings them back later). Never guess: whatever comes along is saved with this work.

## Make the change

Edit the theme, then save. Check the result in the preview before telling the person it is done. Describe changes the way they see them, not as file names.

## Save and share

Save whenever a piece works, and always before the person steps away:

```bash
bun <skill>/scripts/save.ts --message "<what changed, in plain words>"
```

A save commits every unsaved change in the theme, and its output lists them as `committed`. Check that each one is a file you changed for this request; if any isn't, tell the person what it is before going on.

After every save, follow `references/review.md`: tell the person what changed with the preview link, and check the code in the background.

Every save also updates the branch's preview on the store and prints its `preview` link, which anyone can open:

- **A theme connected to this branch** in Shopify (named `<repo>/<branch>`), once Shopify has copied the save into it. Edits made in that theme's editor come back to the branch as commits, and the next save brings them in.
- **Otherwise, a development theme named after the branch.** Each branch has its own, made on the first save and reused by every later one. Edits made in its editor aren't kept: the next save replaces them. The save prints a `connectTip` to show under the link, suggesting the person connect the branch (an agent can't do that part). Once they have, the next save finds the connected theme, gives its link instead, and deletes the branch's development theme, which would only go stale.

`bun <skill>/scripts/preview.ts` prints the branch's preview links again.

## Finish

Follow `references/finish.md`. Merging the pull request publishes the change, so leave the merge to the person or their reviewer unless they explicitly ask you to merge.

## After it is merged

1. Remove the branch's development theme (`bun <skill>/scripts/preview.ts remove`), switch back to the default branch, and pull. A theme connected to the branch stays; the person can delete it in Shopify admin.
2. Delete the merged branch locally with `git branch -d <branch>`.
3. Tell the person they can delete the branch's preview theme in **Online Store > Themes** (it no longer updates).

## Status

`git status`, `git log --oneline <default branch>..HEAD`, and `gh pr view` say what is saved, what is waiting for review, and what the reviewer said. Summarize in plain words: "Two changes are saved and waiting for review; CodeRabbit asked about the button color."

## Undo

- **Not saved yet:** `git restore <file>` puts a file back to the last save; `git restore .` does it for everything. Both throw work away, so say what will be lost and ask first.
- **Saved:** `git revert --no-commit <commit>`, then save. Never reset or rewrite saved history.
- **Already published:** make the undo its own change on a new branch, through review like any other.
