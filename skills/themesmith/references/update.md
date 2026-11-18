# Updating the skills

Find how the skills are installed: `<skill>` is a link into a themesmith checkout for a computer-wide install, or a folder under the theme's `.agents/skills/` for an in-theme copy.

## Computer-wide install

The doctor offers new versions by itself (see `SKILL.md`). To update now:

```bash
bun <skill>/scripts/doctor.ts --update
```

It fast-forwards the themesmith checkout to the newest version on GitHub and runs `install.ts`, which links skills added since the last update, removes links to deleted ones, and installs their packages. Then read `<skill>/SKILL.md` again: the new instructions apply from here on. It refuses when someone changed themesmith on this computer: tell the person, because those edits belong in a pull request to themesmith.

## In-theme copy

`.agents/themesmith.lock.json` records, per skill, the upstream (a Git URL, or a themesmith folder on the computer that set the theme up), the folder inside it, the version this copy was last taken at, and a fingerprint of each file. An update applies everything upstream changed since then on top of this repo's copy, keeping local edits. A version starting with `local:` came from a folder with uncommitted changes: files changed on only one side still update, and a file changed on both sides keeps this repo's version, with upstream's beside it as `<file>.upstream`. An upstream folder exists only on the computer that set the theme up; elsewhere, reinstall from the published themesmith repository.

1. Preview:
   ```bash
   bun <skill>/scripts/update.ts --dry-run
   ```
   Per skill: `updated`, `added`, `removed` (upstream changes to files nobody edited here), `merged` (edited on both sides, combined cleanly), `conflicts` (edited on both sides in the same place), and `keptLocal` (edited here only). If every list is empty, the skills are current; say so and stop.
2. Apply: run it again without `--dry-run`. Add `--skill <name>` for just one skill, or `--ref <tag or commit>` for a version other than the latest.
3. Resolve each conflict. The file holds both versions between `<<<<<<< this repo` and `>>>>>>> new upstream`. Keep the local customization's intent and upstream's fix; remove the markers. A file deleted on one side and changed on the other keeps this repo's version, with upstream's beside it as `<file>.upstream`: decide, then delete the `.upstream` file.
4. Run `bun install --frozen-lockfile` in each updated skill folder that has a `package.json` (and its `scripts/`), then `bun <skill>/scripts/agents.ts sync` so pointer skills pick up changed descriptions, then `bun test <skill>/tests/` and the doctor.
5. GitHub mode: save the update on its own branch and open a pull request whose description lists the upstream range (`from`..`to`) and how each conflict was resolved.

To run this across many theme repositories, do each repository on its own branch with its own pull request; local customizations differ, so conflicts are resolved per repository.
