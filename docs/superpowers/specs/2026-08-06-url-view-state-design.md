# Chapter/character selection in the URL

**Date:** 2026-08-06
**Status:** approved, not yet implemented

## Problem

Refreshing the page drops the reader back at chapter 1 with the first character
selected. `chapterIndex` and `charId` are plain `useState` in `App.tsx` (`:31`,
`:32`) and the load effect (`:35`) unconditionally resets them to
`manifest.chapters[0]` / `manifest.characters[0]`.

## Goals

1. Refresh preserves the current chapter and character.
2. A pasted URL reproduces the same view for someone else.

Explicitly **not** a goal: resuming the last-read position from a bare URL
(bookmark or home-screen icon). That is what browser storage would buy, and it
was considered and declined — so no storage mechanism is used.

## Decision

Encode the two view coordinates as query parameters: `?ch=5&char=donut`.

Rejected alternatives:

- **Hash (`#ch5/donut`)** — equivalent in capability, but it consumes the
  fragment, which is the natural place to later deep-link a panel or an item,
  and it reads like routing in an app that has no routes.
- **Path segments (`/ch5/donut`)** — needs a server rewrite. `vite.config.ts`
  sets `base: "./"` precisely so the build can be served from any static host
  and any subpath; path routing would forfeit that.
- **`react-router`** — a dependency and a provider tree for two scalars.

`replaceState`, not `pushState`: the URL updates silently and the back button
still leaves the site. On a phone, back is the gesture people use to exit, and
twenty chapter picks should not become twenty back presses.

## Architecture

### `src/urlState.ts` (new)

```ts
export type ViewParams = { chapter: number | null; charId: string | null };

export function readViewParams(): ViewParams;
export function writeViewParams(v: { chapter: number; charId: string }): void;
```

`readViewParams` parses `location.search` and returns what it finds, with `null`
for absent or unparseable values. It performs **no** validation: valid values
are defined by the manifest, which only `App` holds. Keeping the manifest out
of this module leaves it dependency-free and its two functions independently
understandable.

`writeViewParams` rewrites the query string via `history.replaceState`,
preserving the current path so it stays correct under a subpath deployment.

### `src/App.tsx` (two touch points)

**Resolve on load.** The load effect (`:35`) stops hardcoding the first chapter
and first character. It reads the URL params and accepts each only if valid:

- `chapter` must appear in `manifest.chapters`; otherwise `chapters[0].index`.
- `charId` must appear in `manifest.characters` **and** satisfy
  `joinsPartyAtChapter <= resolvedChapter`; otherwise the first character
  meeting that condition.

The character check runs against the *resolved* chapter, not the requested one,
so a junk `ch` cannot smuggle in a character the fallback chapter hides.

**Write back on change.** An effect keyed on `book`, `chapterIndex` and
`activeId` calls `writeViewParams`.

It writes **`activeId` (`:52`), not `charId` (`:32`)**. `charId` can hold a
character the current chapter hides — `activeId` is the existing derived value
for who is actually on screen. Two consequences: a shared link can never carry
a character the recipient will not see, and because the effect also runs once
on load, an invalid incoming URL normalizes itself to what is being displayed
rather than sitting there wrong.

### No `popstate` handler

With `replaceState` alone there are no in-site history entries to navigate back
to, so there is nothing to listen for. Should `pushState` ever be wanted, adding
the listener is a contained change to these same two files.

## Out of scope

- **`showChanges`** — a display preference, not a view coordinate. In the URL it
  would clutter every shared link.
- **`?book=`** — `BOOK_ID` is a module constant with no switcher UI. Because an
  absent parameter already falls back, adding it later stays compatible with
  links shared before then.

## Spoiler safety

Unchanged. The URL can only select a chapter present in the manifest and a
character whose `joinsPartyAtChapter` allows it; both constraints are the same
ones the dropdown and the tab strip already enforce. A URL naming a later
chapter is the recipient's own choice, the same as picking it from the dropdown.

## Verification

The repo has no test framework, so verification is `tsc` plus manual checks.

1. `npm run build` — type-checks.
2. Pick chapter 5 and Donut, refresh: the same view returns.
3. Load `?ch=99&char=nobody`: lands on chapter 1 / Carl, and the URL rewrites
   itself to the resolved values.
4. With Donut active, select a chapter before she joins: the tab falls back to
   Carl and `char=` in the URL follows.
5. Load with no query string at all: behaves exactly as today.
