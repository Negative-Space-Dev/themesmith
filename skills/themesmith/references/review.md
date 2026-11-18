# Reviewing work (after every save or push)

Do this after every save (GitHub mode) or push (CLI mode), without waiting to be asked. The person looks at the preview while the code gets a thorough check.

## 1. Report first

Right after the save or push, before any review, send one short message:

> [What changed, in the words a store owner would use: one to three bullets]
>
> **Preview:** [the link]
>
> *[the `connectTip`, as is, when the save printed one]*
>
> I'm double-checking the code in the background and will tell you what I find. Have a look, and tell me anything you'd like changed.

The link is the `preview` the save (GitHub mode) or push (CLI mode) printed: built, on the store, and open to anyone. Never a `127.0.0.1` or `localhost` link.

## 2. Review in the background

```bash
bun <skill>/scripts/review-units.ts
```

It lists the `units` changed since the last review round: each section with the changed snippets and blocks it renders, each page, layout, leftover snippet or block, the theme assets, and each `apps/` component. Every unit lists its files and `changedLines`, the line ranges this piece of work changed. In CLI mode there is no history to narrow it, so `changedLines` covers each whole file. If `units` is empty, skip to step 4 and say nothing about it.

If you can start a subagent that works while you keep talking with the person, start one now. Give it this brief, with the units filled in:

> Review these units with the theme-code-review skill. Read `<skill>/../theme-code-review/SKILL.md` and follow it, passing each unit's files as the target. Units: [the `units` JSON]. Only report: don't edit any file, because the theme may change while you work. Return one list. For each finding: the unit, `file:line`, the rule ID, its severity, whether it is `fix: auto`, and the fix in one line. Mark each finding "in this change" when its line is inside the unit's `changedLines`, otherwise "already in the code".

With many units, start one subagent per unit, at the same time. If you can't run subagents in the background, do the review yourself right after the step 1 message.

While it runs, keep helping the person. If they ask for more changes, make and save them as usual; the next round reviews them.

## 3. Act on the findings

Only findings "in this change" lead to edits. Leave "already in the code" alone.

- **fix: auto**: apply it.
- **blocker** or **high**: fix it yourself, then re-run that unit's checks.
- **medium** or **low**: fix it if the fix is small and obviously safe. Otherwise leave it for the pull request.

Don't ask the person to judge code. If a fix would change how the page looks, describe the visible change in plain words and ask whether that's fine first.

Add every finding you didn't fix to `.themesmith/review-notes.md` (one line each: rule ID, `path:line`, the finding; "already in the code" ones under their own heading). The pull request description is built from it.

If you fixed anything, save or push again. Then mark this round done, so the next one only checks what's new:

```bash
bun <skill>/scripts/review-units.ts --done
```

## 4. Report

One short message:

> ✅ Code check done. [I fixed two small things: the hero image now has a description for screen readers, and … / Nothing needed fixing.] The preview has the latest.
>
> When it looks right to you, say so and I'll [send it for approval | tell you how to publish it].

Use "send it for approval" in GitHub mode and "tell you how to publish it" in CLI mode. Then follow `references/finish.md` when they say it's ready.
