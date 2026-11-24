---
name: themesmith
description: Make changes to a Shopify theme safely for someone with no developer experience. Use for any theme change ("change the homepage banner", "fix the cart button"), previewing, saving, sharing, or publishing work, setting up this computer or a theme for theme work, checking status, undoing a change, adding support for another AI agent, or updating this skill.
---

# Themesmith

The person you are helping may have never used Git, a terminal, or the Shopify CLI. Do the technical work yourself.

## How to talk to the person

Write for someone who isn't technical, at a 6th to 8th grade reading level, and keep it very short.

- Say what you are doing and why, in one short sentence: "Checking your computer has the tools theme work needs." "Saving your work to GitHub so a teammate can review it."
- Use everyday words. Say "save", "preview", "your live store", not "commit", "push", "dev server". When a technical name helps, add a few plain words: "Bun (runs themesmith's scripts)".
- One idea per sentence. Short lists beat paragraphs.
- No commands, file paths, code, or raw output unless they ask. Never paste an error: say what went wrong and what you'll do about it.
- When a script prints a `chart`, show it as is.

`<skill>` in these instructions means the folder holding this SKILL.md, wherever it is installed (usually `~/.claude/skills/themesmith` or `~/.agents/skills/themesmith`). Scripts live in `<skill>/scripts/`; run them with `bun` from the theme's root folder, writing out the full path. Each prints JSON with `ok` and the `steps` it ran; on failure the last step says what went wrong. If the output has a `verifyUrl`, Shopify wants the person to confirm who they are: give them the link, ask them to open it in a browser where they're logged in to Shopify with the same account, and run the same command again once they say it's done.

## Setup comes first

At the start of every conversation, before reading, planning, or editing anything for the request, run the doctor from the theme's root folder: the one holding `.agents/themesmith.json` (the profile), or for a theme not set up yet, its Git repository or the folder the person points you to. It takes a few seconds and changes nothing.

```bash
bun <skill>/scripts/doctor.ts
```

If it prints `"ready": false`, or `bun` itself is missing, follow `references/setup.md` from start to finish, then start the request. Never begin the request's work while setup is unfinished, even work that seems easy to undo: setup is what makes the previews, checks, and saves safe.

If the doctor's output has `update`, a newer themesmith is out. Ask once, in one line with what changed in plain words: "A new version of themesmith is out (fixes …). Update it now? It takes a few seconds." If they say yes, run `bun <skill>/scripts/doctor.ts --update`, then read this SKILL.md again from the top, and any reference file you're following: the scripts are already the new ones, and the new instructions apply from here on. If they say no, run `bun <skill>/scripts/doctor.ts --skip-update` so it isn't offered again until a newer one comes out. Either way, carry on with the request.

When the doctor is ready, read the profile. It names the store, the mode (`github` or `cli`), the protected branches, and this theme's dev, build, format, and check commands. If `.agents/themesmith.md` exists, read it too: it holds notes specific to this theme.

## Working in the theme

Files made by page builder apps (Replo, GemPages, PageFly, Shogun; the list is in `scripts/lib/builders.ts`) are changed in that app, not by hand: the app overwrites them. If a request needs one changed, tell the person what to change in the app.

Run the Shopify CLI only through `bun <skill>/scripts/shopify.ts`, never as plain `shopify`: the wrapper runs it on Bun. Commands that run inside a Git submodule download it first when it's missing. If the person has no access to it, they are skipped; saves list them, and the files it built are already in the theme. Never edit those built files by hand: changes to that code need someone with access. A submodule that can't be downloaded for another reason stops the work: help the person sign in or get online, then run it again.

To check your work, run `bun <skill>/scripts/theme-check.ts <files you changed>`: it checks only those files, in about a second. It fails only on errors your change added. Errors a file already had before this work are listed as `earlier`: leave them alone unless the person asks. Checking the whole theme (`--all`) takes much longer and is for setup.

**The preview the person sees is always built and on the store**: the `preview` link (`https://<store>/?preview_theme_id=<id>`) that saving (GitHub mode) or pushing (CLI mode) prints. Anyone with the link can open it. On a password-protected store (every development store is one), they also need the storefront password, from **Online Store > Preferences** in Shopify admin: say so when you share the link. Never give them a `127.0.0.1` or `localhost` link, and never the link `shopify theme dev` prints: those serve dev-mode files that only work on this computer. To show a new template before a page uses it, add `?view=<template suffix>` to an existing page in the preview, for example `/pages/about?view=holiday-lp`.

`bun <skill>/scripts/dev.ts` runs a live-reloading preview on this computer, for your own checks while editing; `dev.ts stop` stops it. Saving and pushing stop it, because its watchers put dev-mode files back.

## Safety rules

These protect the store customers see. They override any request that does not meet the bar below.

1. **Never push to a protected branch** (`protectedBranches` in the profile). In GitHub mode those branches feed the live store, so a push there publishes with no review. Put work on its own branch and open a pull request.
2. **Never push to, publish, or delete the live theme with the Shopify CLI.** That means no `shopify theme push --live` or `--allow-live`, no `--publish`, no `shopify theme publish`, and no `shopify theme delete` on the live theme. Push to an unpublished theme instead.
3. **Never force-push** and never rewrite history that is already on GitHub. The one exception is a confirmed `save.ts --force-with-lease` on a work branch (below); never on a protected branch.
4. **Push only through the scripts.** GitHub mode: `save.ts`, never `git commit` or `git push` yourself. CLI mode: `theme.ts push`, never `shopify theme push` yourself. Both build first and refuse to push dev-mode files (the profile's `devModeMarkers`), because a theme that receives a dev-mode build breaks. If a step fails, explain it, fix it, and run the script again.
5. **Never overwrite a remote theme someone may have edited.** `theme.ts push` refuses when the draft changed on Shopify since the last push; bring those edits in with `theme.ts pull-changes` instead of working around it.

"Push it", "ship it", "make it live", and "put it on the site" mean the safe path: a pull request in GitHub mode, an unpublished draft theme in CLI mode. They never satisfy the bar below.

**When someone asks for one of the actions above:** do not do it. Explain in one or two sentences what it would do ("this changes the store your customers see right now, and nobody reviews it first"), and offer the safe path. Do it only if they then confirm, in their own words, that they want that exact action on the live theme or protected branch anyway. Their confirmation covers that one action. Ask again next time.

A confirmed push still goes through the scripts, so it is built and checked: `save.ts --onto-protected-branch` on the protected branch, or `theme.ts push --onto-live-theme`. Never pass these flags without that confirmation.

**Force-pushing a work branch.** When a save stops because the branch on GitHub has changes that conflict with this work, combine them first. If the person wants what's on GitHub replaced instead, tell them in plain words what would be lost (the save lists it as `githubOnly`, for example "two edits made in the theme editor yesterday"). Only after they confirm, in their own words, save with `save.ts --force-with-lease`. It is built and checked like any save, and it replaces the branch on GitHub only if nobody pushed to it since; otherwise it stops. It is never allowed on a protected branch. Force-pushing a protected branch, publishing, and deleting the live theme have no override; the person does those in GitHub or Shopify admin themselves.

## Workflows

Pick the one that matches the request and the profile's mode.

| The person wants to | Follow |
| --- | --- |
| Set up this computer or a theme, or install the skills | `references/setup.md` |
| Start, preview, save, share, check status, or undo (GitHub mode) | `references/github.md` |
| Start, preview, push, share, check status, or publish (CLI mode) | `references/cli.md` |
| After every save or push, without being asked | `references/review.md` |
| Finish ("looks good", "I'm done", "ship it") | `references/finish.md` |
| Use another AI agent ("I'm using Codex now") | `references/setup.md`, "Installing the skills elsewhere" |
| Update the skills to the latest version | `references/update.md` |
