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
