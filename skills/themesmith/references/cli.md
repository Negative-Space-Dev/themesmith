# CLI mode

The theme isn't connected to GitHub. Work happens in this folder and goes to an unpublished draft theme; the person publishes the draft from Shopify admin when they are happy with it. `scripts/theme.ts` does every transfer and records in `.themesmith/state.json` what this folder, the draft, and the live theme looked like when they last agreed, so nobody's edits get overwritten.

## Start a change

```bash
bun <skill>/scripts/theme.ts start
```

It copies the live theme into this folder and starts the preview in the background. Give the person the `preview` link it prints; it is visible only on this computer. If the folder holds changes that were never pushed, it stops and lists them. Ask the person: push them first, keep them as the start of this work (`--keep-local`, only on a first start), or throw them away (`--replace-local`, say what will be lost and get a yes first).

## Push to the draft

```bash
bun <skill>/scripts/theme.ts push --name "<short description of the work>"
```

After every push, follow `references/review.md`: tell the person what changed with the draft's preview link, and check the code in the background.

`--name` is needed only on the first push, which creates the draft theme. Every push formats, builds, checks, and confirms nobody edited the draft on Shopify since the last push. The output has a `preview` link the person can share and an `editor` link for the theme editor.

If the drift check fails, someone (often the person, in the theme editor) changed the draft. Run:

```bash
bun <skill>/scripts/theme.ts pull-changes --from draft
```

It copies their edits into this folder. A file changed both here and on Shopify is a conflict: their version is in `.themesmith/conflicts/draft/<file>`. Merge it into this folder's file so both changes survive, delete the copy, and push again.

If the push fails with `issues`, Shopify rejected those files (usually a Liquid error) and accepted the rest, so the draft holds part of the work. Fix each file named in `issues` and push again without `--name`; it goes to the same draft.

## Finish and publish

1. Follow step 1 of `references/finish.md` to make sure the code check covers the latest changes.
2. Bring in anything changed on the live theme since `start`, such as theme editor edits or app settings, so publishing the draft doesn't undo them:
   ```bash
   bun <skill>/scripts/theme.ts pull-changes --from live
   bun <skill>/scripts/theme.ts push
   ```
3. Tell the person how to publish: in Shopify admin, **Online Store > Themes**, the draft's **...** menu, **Publish**. Publishing replaces what customers see, so it is their click.
4. After they publish, run `start` before the next piece of work.

## Status

```bash
bun <skill>/scripts/theme.ts status
```

It reports files changed here and not yet pushed, unresolved conflicts, and what changed on the draft and on the live theme since the last sync. `draft.published: true` means the person published it. `live.sameThemeAsStart: false` means a different theme was published since `start`; run `pull-changes --from live` before pushing more.

## Undo

- **Not pushed yet:** change it back by hand. To throw away every unpushed change at once, `start --replace-local` (say what will be lost and ask first).
- **Pushed to the draft:** change it back here and push again.
- **Published:** the previous live theme is still in the theme library; the person can publish it again. Then run `start`.
