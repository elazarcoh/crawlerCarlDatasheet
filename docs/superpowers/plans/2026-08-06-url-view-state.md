# URL-Backed View State Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Put the selected chapter and character in the query string so a refresh keeps its place and a URL reproduces the same view for someone else.

**Architecture:** A new dependency-free module `src/urlState.ts` reads and writes `?ch=&char=` with no knowledge of what a valid value is. `src/App.tsx` owns validation, because validity is defined by the manifest and only `App` holds it: on load it resolves the URL params against `manifest.chapters` / `manifest.characters`, and an effect mirrors the resulting view back into the URL with `history.replaceState`.

**Tech Stack:** Vite 5 + React 18 + TypeScript 5, zod for data schemas. No router, no new dependencies.

**Spec:** `docs/superpowers/specs/2026-08-06-url-view-state-design.md`

## Global Constraints

- **No new dependencies.** A router was considered and rejected in the spec.
- **No test framework exists in this repo, and this plan does not add one.** `CLAUDE.md`: "There is no test framework and no linter. `npm run validate` is the test suite for data, and `tsc` (via `npm run build`) is the check for code." Verification here is `npm run build` plus the scripted manual checks in each task. Do not add vitest/jest.
- **`vite.config.ts` sets `base: "./"`** so the build runs from any static host and any subpath. Never introduce an absolute path or a path-based route; never hardcode `/`.
- **`replaceState`, never `pushState`.** The back button must still leave the site.
- **Out of scope:** `showChanges` in the URL, a `?book=` param. Both are argued in the spec; do not add them.
- **Comment style:** this codebase comments the *why*, not the *what*, in full sentences. Match it. Do not add narration like `// set the chapter`.

---

### Task 1: The `urlState` module

Creates the read/write pair in isolation. Nothing imports it yet, so this task's deliverable is a module that type-checks and whose behaviour you can exercise directly in a browser console.

**Files:**
- Create: `src/urlState.ts`

**Interfaces:**
- Consumes: nothing (browser globals only — `window.location`, `window.history`, `URLSearchParams`).
- Produces, relied on by Task 2:
  - `export interface ViewParams { chapter: number | null; charId: string | null }`
  - `export function readViewParams(): ViewParams`
  - `export function writeViewParams(v: { chapter: number; charId: string }): void`

- [ ] **Step 1: Create `src/urlState.ts`**

```ts
/**
 * The two view coordinates — selected chapter and selected character — live in
 * the query string, so a refresh keeps its place and a link reproduces the view.
 *
 * Query params rather than path segments because vite.config.ts sets
 * `base: "./"` so the build can be served from any static host and any subpath;
 * path routing would need a server rewrite. The fragment is left deliberately
 * free for deep-linking a panel or an item later.
 */

export interface ViewParams {
  chapter: number | null;
  charId: string | null;
}

const CHAPTER_PARAM = "ch";
const CHAR_PARAM = "char";

/**
 * Reads whatever the query string happens to hold. Deliberately does not
 * validate: what counts as a real chapter or character is defined by the
 * manifest, which only App holds. Absent or malformed values read as null so
 * the caller has exactly one fallback path.
 */
export function readViewParams(): ViewParams {
  const params = new URLSearchParams(window.location.search);

  const rawChapter = params.get(CHAPTER_PARAM);
  const chapter =
    rawChapter !== null && /^\d+$/.test(rawChapter) ? Number(rawChapter) : null;

  const rawChar = params.get(CHAR_PARAM);
  const charId = rawChar !== null && rawChar !== "" ? rawChar : null;

  return { chapter, charId };
}

/**
 * replaceState, not pushState: the back button should still leave the site. On
 * a phone that is the gesture people use to exit, and twenty chapter picks
 * should not become twenty back presses.
 *
 * Rebuilds from the live query string rather than from scratch so unrelated
 * params survive, and keeps pathname and hash so a subpath deployment stays put.
 */
export function writeViewParams(v: { chapter: number; charId: string }): void {
  const params = new URLSearchParams(window.location.search);
  params.set(CHAPTER_PARAM, String(v.chapter));
  params.set(CHAR_PARAM, v.charId);
  const url = `${window.location.pathname}?${params.toString()}${window.location.hash}`;
  window.history.replaceState(null, "", url);
}
```

Note the regex: `/^\d+$/` rejects `-1`, `1.5`, `5abc` and `""`, all of which would otherwise slip through `Number()` or `parseInt()` as a number. Chapter indices are positive integers.

- [ ] **Step 2: Type-check**

Run: `npm run build`

Expected: PASS, no output from `tsc`, then a Vite build summary. If `tsc` reports `'window' is not defined` or similar, stop — `tsconfig.json` is missing the DOM lib and that is a separate problem to raise, not to patch around.

- [ ] **Step 3: Commit**

```bash
git add src/urlState.ts
git commit -m "Add a module for reading and writing the view coordinates in the URL"
```

---

### Task 2: Wire it into `App.tsx`

**Files:**
- Modify: `src/App.tsx` — import (`:1-24` block), load effect (`:35-43`), derivations (`:48-54`), and a new effect between them.

**Interfaces:**
- Consumes from Task 1: `readViewParams()`, `writeViewParams({ chapter, charId })`.
- Produces: nothing new for later tasks. This is the last task.

**Background the implementer needs:**

`App.tsx` holds `chapterIndex` (`:31`) and `charId` (`:32`) as `useState`. There are two distinct notions of "selected character":

- `charId` — what the user last clicked. It can name a character the currently selected chapter hides, and it is deliberately kept so that stepping forward past their join chapter restores them.
- `activeId` (`:52`) — who is actually rendered: `charId` if visible at this chapter, else the first visible character.

The URL must carry **`activeId`**. Writing `charId` would let a shared link name someone the recipient cannot see.

That creates an ordering problem this task has to solve. `activeId` is currently computed at `:52`, which is *after* the early returns at `:45-46` — and a React hook cannot live after a conditional return. So the derivations move above the guards, computed defensively against a possibly-null `book`.

- [ ] **Step 1: Add the import**

Add to the import block at the top of `src/App.tsx`, after the `./data/derive` import on line 4:

```ts
import { readViewParams, writeViewParams } from "./urlState";
```

- [ ] **Step 2: Resolve the URL params in the load effect**

Replace the whole effect at `src/App.tsx:35-43`:

```ts
  useEffect(() => {
    loadBook(BOOK_ID)
      .then((b) => {
        setBook(b);
        setChapterIndex(b.manifest.chapters[0]?.index ?? 1);
        setCharId(b.manifest.characters[0]?.id ?? "carl");
      })
      .catch((e) => setError(String(e)));
  }, []);
```

with:

```ts
  useEffect(() => {
    loadBook(BOOK_ID)
      .then((b) => {
        const { chapter, charId: wantedChar } = readViewParams();

        // Honour the URL only where the manifest agrees, so a hand-edited or
        // stale link lands on a real view rather than a blank sheet.
        const resolvedChapter =
          chapter !== null && b.manifest.chapters.some((c) => c.index === chapter)
            ? chapter
            : (b.manifest.chapters[0]?.index ?? 1);

        // Checked against the resolved chapter, not the requested one, so a
        // junk ch= cannot smuggle in a character the fallback chapter hides.
        const inParty = b.manifest.characters.filter(
          (c) => c.joinsPartyAtChapter <= resolvedChapter,
        );
        const resolvedChar =
          wantedChar !== null && inParty.some((c) => c.id === wantedChar)
            ? wantedChar
            : (inParty[0]?.id ?? b.manifest.characters[0]?.id ?? "carl");

        setBook(b);
        setChapterIndex(resolvedChapter);
        setCharId(resolvedChar);
      })
      .catch((e) => setError(String(e)));
  }, []);
```

- [ ] **Step 3: Hoist the derivations above the early returns and add the write-back effect**

Immediately after the effect from Step 2, and **before** the two early returns, insert:

```ts
  // Derived above the early returns because the write-back effect below needs
  // activeId, and a hook cannot sit after a conditional return.
  const chapters = book?.manifest.chapters ?? [];
  const visible = (book?.manifest.characters ?? []).filter(
    (c) => c.joinsPartyAtChapter <= chapterIndex,
  );
  const activeId = visible.some((c) => c.id === charId)
    ? charId
    : (visible[0]?.id ?? charId);

  // Mirror the view into the URL so a refresh keeps its place and the link can
  // be shared. activeId rather than charId: charId can name a character this
  // chapter hides, so a shared link would show the recipient someone they
  // cannot see. Running on load too means an invalid incoming URL rewrites
  // itself to whatever is actually on screen.
  useEffect(() => {
    if (book) writeViewParams({ chapter: chapterIndex, charId: activeId });
  }, [book, chapterIndex, activeId]);
```

- [ ] **Step 4: Delete the now-duplicated derivations**

The original block at what was `src/App.tsx:48-54` is now dead — Step 3 defines all three names. Delete exactly these lines, which sit just after `if (!book) return <div className="loading">Loading the dungeon…</div>;`:

```ts
  const chapters = book.manifest.chapters;
  const visible = book.manifest.characters.filter(
    (c) => c.joinsPartyAtChapter <= chapterIndex,
  );
  const activeId = visible.some((c) => c.id === charId)
    ? charId
    : (visible[0]?.id ?? charId);
```

Leave the following `const charData = book.characters.get(activeId);` and everything after it untouched.

- [ ] **Step 5: Type-check**

Run: `npm run build`

Expected: PASS. A `Cannot redeclare block-scoped variable 'chapters'` error means Step 4 was skipped.

- [ ] **Step 6: Manual verification**

Run: `npm run dev`, then open `http://localhost:5173`.

Work through all six, and record the actual result of each — do not report this task complete on a subset:

1. **Baseline.** Load with no query string. The sheet shows chapter 1 / Carl exactly as before, and the URL immediately rewrites to `?ch=1&char=carl`.
2. **Refresh.** Pick chapter 6 and the Princess Donut tab. The URL reads `?ch=6&char=donut`. Press F5. The same chapter and character come back.
3. **Junk params.** Load `http://localhost:5173/?ch=99&char=nobody`. The sheet shows chapter 1 / Carl and the URL rewrites itself to `?ch=1&char=carl`.
4. **Character hidden by the chapter.** With Donut active at chapter 6, select chapter 2 from the dropdown. She joins at chapter 3 (`public/data/book1/manifest.json`), so the tab strip falls back to Carl and `char=` in the URL follows to `carl`.
5. **Spoiler safety across the boundary.** Load `http://localhost:5173/?ch=2&char=donut` directly. It must resolve to `char=carl` — the URL is not a way around `joinsPartyAtChapter`.
6. **Back button.** From the baseline load, change the chapter three times, then press the browser back button. It leaves the site (or goes to the previous page / a blank new tab) rather than stepping back through the chapters.

- [ ] **Step 7: Commit**

```bash
git add src/App.tsx
git commit -m "Keep the chapter and character in the URL across a refresh"
```

---

## Self-Review

**Spec coverage:**

| Spec requirement | Task |
|---|---|
| `src/urlState.ts` with `ViewParams`, `readViewParams`, `writeViewParams` | 1 |
| Query params `?ch=&char=`, no validation in the module | 1 |
| `replaceState`, preserving the path | 1 |
| Load effect resolves against `manifest.chapters` | 2 (Step 2) |
| Character validated against the *resolved* chapter | 2 (Step 2) |
| Write-back effect on `book`/`chapterIndex`/`activeId` | 2 (Step 3) |
| Writes `activeId`, not `charId` | 2 (Step 3) |
| No `popstate` handler | Not implemented, by design |
| `showChanges` and `?book=` excluded | Global Constraints |
| Verification checks, including spoiler safety | 2 (Step 6) |

**Type consistency:** `readViewParams` returns `ViewParams`; Task 2 destructures `chapter` and `charId` from it, matching the interface. `writeViewParams` takes `{ chapter: number; charId: string }`; Task 2 passes `chapterIndex` (`number`, `:31`) and `activeId` (`string`, since `charId` is `string` and `visible[0]?.id ?? charId` cannot be undefined). Param name constants `ch`/`char` are defined once in Task 1 and only referenced through the two functions.

**Not covered by the plan, by design:** the spec's note that adding `?book=` later stays backward-compatible is a claim about future work, not a requirement to implement.
