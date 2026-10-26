---
name: update-localization
description: Bring every language of the core add-on's localized tools up to date after text people read was added, changed or removed: regenerate the English catalogs, work out what changed with the localization toolkit, translate with the glossary and the review loop, run the checks, record the state and commit locally. Use when asked to "update localization", "update the translations", "translate the new strings" or "localize this change" in this repo.
---

# Update localization: core-addon

English is the source and the fallback; this skill brings the 9 other languages (`sv`, `pt-BR`, `fr-FR`, `fr-CA`,
`es-ES`, `es-419`, `ja`, `de`, `hi`) up to date with it. The procedure, rules and tools live in the localization
toolkit repo (`dataTimeSpace/localization`); this file holds only what is specific to core-addon. **If this file and the
toolkit's `LOCALIZATION_UPDATE_GUIDE.md` disagree, the guide wins.**

## 0. Before you start

1. Find the toolkit: `$LOCALIZATION_TOOLKIT` if set, else the `localization` clone next to this repo
   (`$(dirname "$(git rev-parse --show-toplevel)")/localization`). If its `LOCALIZATION_UPDATE_GUIDE.md` is missing,
   stop and ask the user to clone `dataTimeSpace/localization` next to this repo.
2. `git -C <toolkit> status -sb` should show a clean `main` that is not behind; otherwise ask the user before going on
   (its `state/` must not fork).
3. Read the guide, sections 1, 2, 4 and 7, and `<toolkit>/glossary/README.md`.
4. Agree the scope with the user (this branch against `main`, a commit range, or whatever the delta finds). Work on the
   branch that holds the text change; on `main`, create `localization-update-<yyyy-mm-dd>` first.
5. Shell state does not persist between commands: use absolute paths everywhere. Below, `<toolkit>` is the toolkit
   folder, `<repo>` the root of this clone, `<scratch>` a temporary folder outside both repos, `<locales>` is
   `sv,pt-BR,fr-FR,fr-CA,es-ES,es-419,ja,de,hi` and `<run>` one id for this run (`<yyyy-mm-dd>-core`).

Never push. No customer names or data anywhere (catalogs, commits, prompts to subagents). No em dashes. Stored data,
protocol messages, exports and logs stay English (guide section 2).

## 1. English catalogs

`npm run i18n:extract-tools` regenerates `tools/<tool>/locales/en/<tool>.json` for the tools that are localized (today `spatialDraw`; demo tools stay English). Then `npm run i18n:extract-tools -- --check` and `npm run lint`. Tools translate through `createToolI18n` from `objectDefaultFiles/i18n.js`, with the tool's folder name as namespace.

## 2. What changed

```bash
node <toolkit>/tools/delta.mjs --repo core-addon --repo-path <repo> --locales <locales> > <scratch>/delta.json
```

Catalogs: `tools/<tool>/locales/<code>/<tool>.json`. The stderr summary has one line per language. The work list is `toTranslate` per namespace and
language; `removed` and `orphans` are keys to delete (laying the catalog out like English drops them). Nothing to
translate in any language: say so and stop.

## 3. Translate and review

Per language and namespace, as in guide sections 4.3 and 4.4:

1. Context: how the code uses each key (`git grep '<key>'`), the glossary (`<toolkit>/glossary/<code>.json`), the UI
   label ledger (`ui-labels-<code>.json`) and the style decisions (`review-<code>.md`).
2. Write the translations as flat JSON in a scratch folder, merge them into the catalog and lay it out like English
   (`catalogs.mjs flatten` and `shape`, guide 4.3 step 4).
3. Review loop, each step a separate subagent (model opus) in the foreground: blind back-translation (translations
   only, opaque ids), comparison with the English, a critical linguist per language, a regional linguist for fr-CA
   and es-419, and a lawyer (accuracy only) for keys listed under `core-addon` in `<toolkit>/legal-keys.json`. At most 4
   rounds on the changed strings; log flags and resolutions with
   `node <toolkit>/tools/state.mjs review add|resolve --repo core-addon ...`.
4. A new product term goes into the glossary first (guide 4.3 step 5); one that could be a name needs the localization
   owner's decision.

Languages can run in parallel, one subagent each, as long as each writes only its own language's files. Translate
and record fr-FR before fr-CA and es-ES before es-419.

## 4. Checks and record

Per language, until it exits 0 with no open warning:

```bash
node <toolkit>/tools/checks.mjs --repo core-addon --repo-path <repo> --locale <code> --log-review --run-id <run>
```

Errors are fixed; a warning on a string the reviewers agree is right is accepted
(`state.mjs review resolve ... --check <c|d|e> --resolution "accepted: <reason>"`). Then this repo's own checks:
`npm run i18n:extract-tools -- --check` and `npm test`. When every language is clean:

```bash
node <toolkit>/tools/delta.mjs --repo core-addon --repo-path <repo> --locales <locales> --write-state --run-id <run>
```

Read `unchangedStale` on stderr (guide 4.6). Regenerate the pseudo-locale: `node <toolkit>/tools/pseudo.mjs --roots 'tools/*/locales' --repo-path <repo>`, then run the checks with `--locale en-XA`.

## 5. Other surfaces in this repo

- Nothing beyond the catalogs. Localizing another tool is a decision for the localization owner first.

## 6. Check it

Open each changed tool in the interface with `?lang=de`, `?lang=fr-FR`, `?lang=ja`, `?lang=hi` and `?lang=en-XA`; nothing clipped; switching the language updates the open tool.

## 7. Commit and report

- This repo: small commits on the current branch ("Translate the new drawing tool labels into all languages"). Do not push.
- Toolkit: commit the changed `state/`, `glossary/` and `legal-keys.json` on a branch `update-core-addon-<run>` of the toolkit
  repo. Do not push. Tell the user that the two PRs belong together.
- Report per language: what was translated, what the review loop and the checks flagged and how it was resolved,
  accepted warnings with reasons, open questions, and the commits in both repos.
