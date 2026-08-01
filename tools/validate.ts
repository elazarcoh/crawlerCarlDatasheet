import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { BooksIndex, Delta, Manifest, Snapshot } from "../src/schema/index.ts";

/**
 * Validates all statsheet data: schema conformance (via zod), delta
 * consistency — unique ids within each list, and every remove/update id must
 * exist in the state accumulated so far — and citations.
 *
 * Citation checks that need the book text read `data-src/<book>/chapters_txt/`,
 * which is git-ignored. Without it they are skipped and reported as unchecked,
 * so a fresh clone still validates. Errors exit non-zero; warnings do not.
 */

// fileURLToPath (not URL.pathname) — on Windows .pathname yields "/D:/repo",
// which join() turns into the invalid "\D:\repo".
const REPO = fileURLToPath(new URL("..", import.meta.url));
const DATA = join(REPO, "public", "data");
const TEXT = join(REPO, "data-src");

const LIST_FIELDS = ["equipment", "inventory", "skills", "effects", "achievements", "contacts"] as const;

/** `scene` and `appearance.stateId` name art files, not book facts. */
const UNCITED_FIELDS = new Set(["scene", "appearance"]);

const VERBOSE = process.argv.includes("--verbose");

const errors: string[] = [];
const warnings: string[] = [];
const coined: string[] = [];
const err = (m: string) => errors.push(m);
const warn = (m: string) => warnings.push(m);
const readJson = (p: string) => JSON.parse(readFileSync(p, "utf-8"));

let unchecked = 0;

/* ----------------------------- book text -------------------------------- */

const chapterText = new Map<string, string>();

/** Chapter prose, normalised, or undefined when the text isn't available. */
function bookText(book: string, chapter: number): string | undefined {
  const key = `${book}/${chapter}`;
  if (!chapterText.has(key)) {
    const p = join(TEXT, book, "chapters_txt", `ch${String(chapter).padStart(2, "0")}.txt`);
    chapterText.set(key, existsSync(p) ? norm(readFileSync(p, "utf-8")) : "");
  }
  return chapterText.get(key) || undefined;
}

/**
 * Fold away everything that differs between an epub and a hand-typed quote:
 * unicode punctuation, digit grouping, casing, whitespace and line breaks.
 */
function norm(s: string): string {
  return s
    .normalize("NFKC")
    .replace(/(\d),(\d)/g, "$1$2")
    .toLowerCase()
    .replace(/[^a-z0-9 ]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

// Quotes stitch distant sentences together with an ellipsis; each side has to
// be matched on its own. Split before norm(), which eats the marker itself.
const ELISION = /\s*(?:\[\s*(?:\u2026|\.\.\.)\s*\]|\u2026|\.\.\.)\s*/;

/** Is every fragment of `quote` present in the chapter? undefined = no text. */
function quoted(book: string, chapter: number, quote: string, minLen = 12): boolean | undefined {
  const text = bookText(book, chapter);
  if (!text) return undefined;
  // minLen drops the stubs an elision leaves behind, which would match noise.
  // If that leaves nothing, the whole string is short (a reward of "None.") —
  // check it as it stands rather than report it as unverifiable.
  const parts = quote.split(ELISION).map(norm).filter((p) => p.length > minLen);
  const whole = norm(quote);
  if (!parts.length) return whole ? text.includes(whole) : undefined;
  return parts.every((p) => text.includes(p));
}

/** As `quoted`, but satisfied by any one of several chapters. */
function quotedIn(book: string, chapters: number[], quote: string, minLen = 12): boolean | undefined {
  let known = false;
  for (const c of chapters) {
    const hit = quoted(book, c, quote, minLen);
    if (hit) return true;
    if (hit !== undefined) known = true;
  }
  return known ? false : undefined;
}

/** A name the book never gave, written so it reads as a gap: "(Unnamed …)". */
const isPlaceholder = (name: string) => name.startsWith("(");

const WORD_NUMBERS = ["zero", "one", "two", "three", "four", "five", "six", "seven", "eight",
  "nine", "ten", "eleven", "twelve", "thirteen", "fourteen", "fifteen", "sixteen",
  "seventeen", "eighteen", "nineteen", "twenty"];

/** The book writes small numbers as words as often as digits. */
function statesNumber(text: string, n: number): boolean {
  if (new RegExp(`\\b${n}\\b`).test(text)) return true;
  return n >= 0 && n < WORD_NUMBERS.length && new RegExp(`\\b${WORD_NUMBERS[n]}\\b`).test(text);
}

/* ------------------------------ references ------------------------------- */

/** Every dotted path the delta's `set` writes, plus each parent prefix. */
function setPaths(set: any, prefix = "", out = new Set<string>()): Set<string> {
  for (const [k, v] of Object.entries(set ?? {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    out.add(path);
    if (v && typeof v === "object" && !Array.isArray(v)) setPaths(v, path, out);
  }
  return out;
}

/** Numeric leaves of `set`, as [path, value]. */
function setNumbers(set: any, prefix = "", out: [string, number][] = []): [string, number][] {
  for (const [k, v] of Object.entries(set ?? {})) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (typeof v === "number") out.push([path, v]);
    else if (v && typeof v === "object" && !Array.isArray(v)) setNumbers(v, path, out);
  }
  return out;
}

/** Ids each list touches, by any op. */
function listTargets(d: any): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const f of LIST_FIELDS) {
    const op = d[f];
    if (!op) continue;
    const ids = new Set<string>();
    for (const it of op.add ?? []) ids.add(it.id);
    for (const it of op.update ?? []) ids.add(it.id);
    for (const id of op.remove ?? []) ids.add(id);
    m.set(f, ids);
  }
  return m;
}

function validateCharacter(book: string, charId: string, chapters: number[], names: Map<string, string>) {
  const dir = join(DATA, book, charId);
  const baseParsed = Snapshot.safeParse(readJson(join(dir, "base.json")));
  if (!baseParsed.success) {
    err(`${book}/${charId}/base.json: ${baseParsed.error.issues[0]?.message}`);
    return;
  }
  const base = baseParsed.data;

  // Track the id set per list as we fold deltas in chapter order.
  const ids: Record<string, Set<string>> = {};
  for (const f of LIST_FIELDS) ids[f] = new Set((base as any)[f].map((i: any) => i.id));

  for (const f of LIST_FIELDS) {
    for (const it of (base as any)[f] as any[]) if (it.name) names.set(it.id, it.name);
  }

  const deltaDir = join(dir, "deltas");
  const files = existsSync(deltaDir)
    ? readdirSync(deltaDir).filter((f) => f.endsWith(".json")).sort()
    : [];

  for (const file of files) {
    const parsed = Delta.safeParse(readJson(join(deltaDir, file)));
    if (!parsed.success) {
      err(`${book}/${charId}/deltas/${file}: ${parsed.error.issues[0]?.path}: ${parsed.error.issues[0]?.message}`);
      continue;
    }
    const d = parsed.data;
    const tag = `${book}/${charId}/deltas/${file}`;
    if (!chapters.includes(d.chapterIndex)) err(`${tag}: chapterIndex ${d.chapterIndex} not in manifest`);
    if (d.chapterIndex < base.chapterIndex) err(`${tag}: chapterIndex before intro chapter ${base.chapterIndex}`);

    for (const f of LIST_FIELDS) {
      const op = (d as any)[f] as { add?: any[]; remove?: string[]; update?: any[] } | undefined;
      if (!op) continue;
      for (const id of op.remove ?? []) {
        if (!ids[f].has(id)) err(`${tag}: ${f}.remove references missing id "${id}"`);
        ids[f].delete(id);
      }
      for (const u of op.update ?? []) {
        if (!ids[f].has(u.id)) err(`${tag}: ${f}.update references missing id "${u.id}"`);
      }
      for (const it of op.add ?? []) {
        // Re-adding an existing id is allowed for stackable (qty) items.
        if (ids[f].has(it.id) && it.qty === undefined) {
          err(`${tag}: ${f}.add duplicate id "${it.id}" (non-stackable)`);
        }
        ids[f].add(it.id);
      }
    }

    checkCitations(book, tag, d, names);
  }
}

/* ------------------------------ citations -------------------------------- */

function checkCitations(book: string, tag: string, d: any, names: Map<string, string>) {
  const paths = setPaths(d.set);
  const lists = listTargets(d);
  const sources: any[] = d.sources ?? [];

  /**
   * Chapters this delta's text may live in: its own, plus any a source for
   * that field cites. The book reveals things late — Carl gains Pugilism in
   * ch03 and reads its name in ch05 — and a citation already records where.
   */
  const citedChapters = (field: string, id?: string): number[] => {
    const out = new Set<number>([d.chapterIndex]);
    for (const s of sources) {
      if (s.chapter === undefined) continue;
      const [head, rid] = s.ref.split(":");
      if (head === field && (rid === undefined || rid === id)) out.add(s.chapter);
    }
    return [...out];
  };

  sources.forEach((s, i) => {
    const at = `${tag}: sources[${i}]`;
    const chapter = s.chapter ?? d.chapterIndex;

    // The ref has to name something this delta actually changes, or the
    // citation is attached to nothing and rots silently (as "equipment.accessory"
    // did when equipment stopped being slot-keyed).
    const [list, id] = s.ref.split(":");
    let known: boolean;
    if (id !== undefined) {
      known = lists.has(list) && lists.get(list)!.has(id);
      if (!known && lists.has(list)) {
        err(`${at}: ref "${s.ref}" — ${list} is not touched for id "${id}"`);
        return;
      }
    } else {
      known = s.ref === "notes" ? d.notes !== undefined : paths.has(s.ref) || lists.has(s.ref);
    }
    if (!known) {
      err(`${at}: ref "${s.ref}" names nothing this delta changes`);
      return;
    }

    if (chapter < 1) err(`${at}: chapter ${chapter} is not a chapter number`);
    // Forward citations are legitimate — Carl reaches level 2 in ch03 and only
    // reads the notification in ch05 — but they must be a deliberate choice,
    // so an unexplained one is worth flagging.
    if (chapter > d.chapterIndex && !s.note) {
      warn(`${at}: cites ch${chapter}, after this delta's own ch${d.chapterIndex} — add a note saying why`);
    }

    const ok = quoted(book, chapter, s.quote);
    if (ok === undefined) unchecked++;
    else if (!ok) err(`${at}: quote not found in ch${chapter} — "${s.quote.slice(0, 60)}…"`);
  });

  // An achievement's description and reward are the AI's own words, printed in
  // its box. Anything of ours about it belongs in `note`.
  for (const op of ["add", "update"] as const) {
    for (const a of (d.achievements?.[op] ?? []) as any[]) {
      const chapters = citedChapters("achievements", a.id);
      for (const field of ["description", "reward"] as const) {
        if (!a[field]) continue;
        const ok = quotedIn(book, chapters, a[field]);
        if (ok === undefined) unchecked++;
        else if (!ok) {
          err(`${tag}: achievements.${op} "${a.id}" — ${field} is not verbatim ${chapters.map((c) => "ch" + c).join(" / ")} text`);
        }
      }
    }
  }

  const quotes = sources.map((s) => norm(s.quote)).join(" ");

  // A number we assert should be printed in the book, or flagged as computed.
  for (const [path, value] of setNumbers(d.set)) {
    const head = path.split(".")[0];
    if (UNCITED_FIELDS.has(head)) continue;
    const covered = sources.some((s) => s.derived && (s.ref === path || path.startsWith(s.ref + ".") || s.ref.startsWith(path)));
    if (!covered && !statesNumber(quotes, value)) {
      warn(`${tag}: ${path} = ${value} appears in no quote — cite it, or mark the source derived`);
    }
  }

  // Names are checked when they are introduced or revealed, never on a re-add:
  // equipping moves an item from `inventory` to `equipment` and a stackable is
  // added again to bump `qty`, and neither chapter need mention it by name.
  for (const [f] of lists) {
    for (const op of ["add", "update"] as const) {
      for (const it of (d[f]?.[op] ?? []) as any[]) {
        if (!it.name) continue;
        const previous = names.get(it.id);
        if (previous === it.name) continue;

        // One id, one display name — the UI shows a single row for it across
        // every chapter. The sole exception is a placeholder being filled in.
        if (previous !== undefined && !isPlaceholder(previous)) {
          err(`${tag}: ${f} "${it.id}" renamed "${previous}" -> "${it.name}"; only a "(…)" placeholder may be renamed`);
        }
        names.set(it.id, it.name);

        const bare = it.name.replace(/\s*\([^)]*\)/g, "").trim();
        if (!bare || isPlaceholder(it.name)) continue;
        if (quotedIn(book, citedChapters(f, it.id), bare, 2) === false) {
          coined.push(`${tag}: ${f} "${it.name}" is not the book's wording`);
        }
      }
    }
  }

  // Anything changed and never cited at all.
  const heads = new Set(sources.map((s) => s.ref.split(":")[0].split(".")[0]));
  for (const field of [...Object.keys(d.set ?? {}), ...lists.keys()]) {
    if (!UNCITED_FIELDS.has(field) && !heads.has(field)) {
      warn(`${tag}: ${field} changed with no source backing it`);
    }
  }
}

function main() {
  const idxPath = join(DATA, "index.json");
  if (!existsSync(idxPath)) {
    console.error("Missing public/data/index.json");
    process.exit(1);
  }
  const index = BooksIndex.safeParse(readJson(idxPath));
  if (!index.success) {
    console.error("index.json invalid:", index.error.issues);
    process.exit(1);
  }

  for (const { id: book } of index.data.books) {
    const mParsed = Manifest.safeParse(readJson(join(DATA, book, "manifest.json")));
    if (!mParsed.success) {
      err(`${book}/manifest.json: ${mParsed.error.issues[0]?.message}`);
      continue;
    }
    const chapters = mParsed.data.chapters.map((c) => c.index);
    // Display name per id, shared across the book: the same system item shows
    // one name wherever it appears, and an item keeps it when it moves from
    // `inventory` to `equipment`.
    const names = new Map<string, string>();
    for (const c of mParsed.data.characters) validateCharacter(book, c.id, chapters, names);
  }

  if (warnings.length) {
    console.warn(`\n! ${warnings.length} warning(s):`);
    for (const w of warnings) console.warn("  - " + w);
  }
  if (coined.length) {
    console.warn(`\n${coined.length} name(s) are ours rather than the book's` +
      (VERBOSE ? ":" : " (--verbose to list)."));
    if (VERBOSE) for (const c of coined) console.warn("  - " + c);
  }
  if (unchecked) {
    console.warn(`\n${unchecked} quote(s) unchecked — no book text in data-src/ ` +
      "(run tools/extract_text.py to enable citation checking).");
  }
  if (errors.length) {
    console.error(`\n✗ ${errors.length} validation error(s):`);
    for (const e of errors) console.error("  - " + e);
    process.exit(1);
  }
  console.log("\n✓ All data valid.");
}

main();
