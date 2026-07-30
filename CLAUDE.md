# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

An interactive, spoiler-safe visual statsheet for the *Dungeon Crawler Carl* novels
(Vite + React + TypeScript, static SPA, no backend). Pick a chapter → see each party
member's state **as it was at the beginning of that chapter**, plus generated art.
Ships Book 1 chapters 1–8 (Carl, Princess Donut) as a demo.

The whole design goal is that **content is additive**: new chapters/characters/books are
data + art drops under `public/`, fetched at runtime, requiring no code change and no rebuild.
Prefer solutions that preserve that property.

## Commands

```bash
npm install
npm run dev          # http://localhost:5173
npm run build        # tsc (type-check, noEmit) + vite build → dist/
npm run preview      # serve the production build
npm run validate     # tools/validate.ts — schema + delta consistency over all data
```

There is **no test framework and no linter**. `npm run validate` is the test suite for data,
and `tsc` (via `npm run build`) is the check for code. To validate a subset, edit/copy
`tools/validate.ts` — it has no filter flags. All tool scripts run under `tsx`.

Data authoring:

```bash
python3 tools/extract_text.py books/<book>.epub <bookId>   # once per book → data-src/ (git-ignored)
npm run extract:delta -- book1 carl 9                      # writes a paste-into-Claude prompt
npm run extract:delta -- book1 carl 9 --api                # or call the Anthropic API directly
```

Art generation (`tools/artgen/`, all idempotent — only fills missing images):

```bash
npm run artgen:ref | artgen:characters | artgen:items | artgen:backgrounds
npm run artgen:prompts    # no API: export every prompt + save-path for manual generation
```

## Architecture

### Data model: base snapshot + per-chapter deltas

The single most important convention, and it is easy to get off by one:

- `public/data/<book>/<char>/base.json` = the character's state at the **START of their
  intro chapter B**; its `chapterIndex` is B.
- `public/data/<book>/<char>/deltas/chNN.json` = events that occur **DURING** chapter NN.
- The view for selected chapter N = `base + every delta with chapterIndex < N`.

So a sword looted during chapter 4 goes in `deltas/ch04.json` and first shows up when the
user selects chapter 5. That is intended, not a bug.

**Earned in one chapter, revealed in another → placeholder, then `update`.** When the
character gains something before learning what it says, the wording belongs in the delta for
the chapter where it is *read*, never the one where it is earned. Carl's inventory is
inactive until ch05, so eight achievements earned in ch02–03 are added there as
`"name": "(Unread notification)"` with an explanatory `note`, and `deltas/ch05.json` fills
in the real name/description/reward with an `achievements.update` on the same ids. The
composed view then tells the truth at every chapter, and since `diff.ts` reports list
updates, the reveal reads as its own event in the changes box. `validate.ts` rejects an
`update` for an id that was never added, so the two halves cannot silently drift apart.

`src/schema/index.ts` is the single source of truth: zod schemas produce both the runtime
validators and the TypeScript types (`z.infer`). `Delta` and `DeltaSet` are `.strict()`, so
an unknown key is a validation error, not a silent no-op.

**`equipment` is a flat list of worn items, each carrying a `slot`.** Not a slot-keyed
object — `EQUIPMENT_SLOTS` (head/body/underwear/hands/feet/weapon/offhand/accessory) are
**display groupings, not capacity limits**, because the books have no equipment-slot system
at all (`slot` in the prose only ever means inventory stacking or the hotlist). Several items
share a slot: Carl's `body` carries his leather jacket, trollskin shirt and nightgaunt cloak
as the layers they are, and his `accessory` holds every ring at once — two from book 1 ch19.
Jewellery goes in `accessory`, never on the body part it touches, so `feet` correctly stays
empty (he is barefoot from ch02 on).

Because it's a list, a delta mutates it with ordinary `add`/`remove`/`update` ops **at the
top level, not inside `set`** — so nothing needs restating, `validate.ts` id-checks it like
any other list, and `diff.ts` surfaces equipment changes in the changes box.

Pipeline:

1. `src/data/loader.ts` — fetches `data/index.json` → `<book>/manifest.json` → each
   character's `base.json` and every `deltas/chNN.json` for chapters in the manifest.
   Missing deltas are expected and skipped; `getJsonOptional` deliberately treats a
   non-JSON 200 as absent because the Vite dev server's SPA fallback serves `index.html`
   for missing paths.
2. `src/data/reducer.ts` — `compose()` folds base + ordered deltas into a
   `Map<chapterIndex, Snapshot>`. `set` deep-merges (`null` overwrites); list fields
   (`inventory`/`skills`/`effects`/`achievements`/`contacts`) take `add`/`remove`/`update`
   ops keyed by `id`. Re-`add`ing an existing id bumps `qty` for stackables.
3. `src/data/derive.ts` — `effectiveStats()` / `derivedSkills()`: item bonuses live **on
   the item** (`statBonuses`, `grants`), never baked into the character's `stats`/`skills`.
   The app computes totals and tooltip breakdowns from equipped items, so equip/unequip is
   the single source of truth. Only items in `equipment` count — anything in `inventory`
   contributes nothing. `deriveViewSnapshot()` produces the snapshot that gets diffed.
4. `src/data/diff.ts` — `compareSnapshots(prev, cur)` drives the changes box and per-field
   highlighting. `App.tsx` diffs **derived** views, so equipping a ring registers as a STR change.

### Spoiler safety

Two mechanisms, both data-driven: the chapter dropdown lists only chapters present in the
manifest, and a character's tab appears only when `joinsPartyAtChapter <= chapterIndex`
(`App.tsx`). Never surface data from a later chapter in an earlier chapter's view.

### Art resolution by convention

Nothing references art files explicitly; paths are derived, and every image component falls
back to a styled placeholder on `onError`. Dropping a correctly named PNG in makes it appear.

- character: `public/art/<book>/<char>/<appearance.stateId>.png`
- item icon: `public/art/<book>/items/<item.id>.png` (or an explicit `item.icon` path)
- scene background: `public/art/<book>/scenes/<snapshot.scene>.png`

`tools/artgen/plan.ts` builds the job list by **scanning the data** for distinct
`appearance.stateId`s, `scene`s, and items — so art jobs stay in sync with the data
automatically. Prompt inputs come from `art-src/<book>/<char>/bible.json` (canonical
character description + `referencePrompt`), `states.json` (per-outfit descriptions),
`art-src/<book>/scenes.json`, and the style token in `tools/artgen/style.md` / `style.ts`.
`gen_characters.ts --ref-only` makes the reference portrait first; character jobs pass it as
a reference image so the same person survives re-dressing.

Providers (`tools/artgen/provider.ts`) are pluggable via `ARTGEN_PROVIDER` =
`gemini` | `openai` | `flux`, each reading its own key from `.env` (git-ignored).
`getProvider()` returns `null` with no credentials so the harness no-ops and the app shows
placeholders — the demo must always run with zero setup. Adapters throw `QuotaError` on
429/RESOURCE_EXHAUSTED and `run.ts` stops gracefully, so a re-run resumes.

### Delta extraction

`tools/extract_deltas.ts` composes the prior state itself and builds a prompt containing
only that snapshot plus **one** chapter's text — never earlier prose — to keep calls cheap.
Print mode writes the prompt to `data-src/<book>/prompts/`; `--api` calls the Messages API
directly (no SDK dependency, deliberately — so `npm run build` never needs an extra install),
zod-validates the reply, and writes `deltas/chNN.json`. Model via `EXTRACT_MODEL`.
The authoritative field reference and conventions live in `tools/extraction_prompt.md` —
read it before authoring any data.

## Rules to follow

**Extension protocol.** If a chapter introduces a genuinely new *kind* of state the schema
doesn't model (e.g. a later book's multi-room personal space with crafting tables and
leveled upgrades), **stop and ask the user** how to model and display it. Do not force-fit
it into `misc` and do not silently drop it. Small one-off facts (gold, a crawler id) are
fine in `misc`. A generated delta whose `notes` start with `REVIEW NEEDED:` is the
machine-authored version of this signal.

**Never invent book facts.** Use `null` for anything the text hasn't revealed, and attach a
verbatim `sources` quote for every non-trivial change. `null` stats propagate: an unknown
base stat yields an unknown total rather than a bonus-only number.

**Copyright.** `books/*.epub` and `data-src/` (anything derived from the full book text) are
git-ignored and must stay uncommitted. `.env` too. `public/art/**/*.png` is tracked via
Git LFS (`.gitattributes`). See `docs/git-guide.md`.

**Ids** are stable kebab-case slugs; `appearance.stateId` follows `<char>-NN-<slug>` and
scene ids `scene-<slug>`. Changing an id breaks delta `remove`/`update` references and art
filenames — `npm run validate` catches the former.

## Other docs

`docs/background-tuning.md` — the two `:root` CSS vars in `src/styles/theme.css`
(`--scene-opacity`, `--scene-veil-alpha`) that control the scene backdrop.
`docs/manual-art-generation.md` — generating art by hand in a browser UI (more free quota).
`docs/git-guide.md` — what to exclude, and Git LFS setup for the art.
