# Chapter Extraction Prompt & Data-Authoring Spec

This is the repeatable procedure for turning a chapter of *Dungeon Crawler Carl*
into structured statsheet data. Follow it exactly for every character × chapter.

## Source of truth

- Plain chapter text: `data-src/<book>/chapters_txt/chNN.txt` (TOC chapter numbering).
- Schema (the contract): `src/schema/index.ts` — read it before authoring.
- Output data: `public/data/<book>/<char>/base.json` and `.../deltas/chNN.json`.

## Composition convention (critical — do not deviate)

- `base.json` = the character's state at the **START of their intro chapter B**
  (Carl B=1; Donut B=3). Its `chapterIndex` = B. Fill every field; use `null`
  for anything not yet known on the page (e.g. stats before they're revealed).
- `deltas/chNN.json` = the events that occur **DURING chapter NN**, expressed as
  changes to the previous state. Author the delta where the event happens.
- The app shows, for a selected chapter N, `base + every delta with chapterIndex < N`
  — i.e. the state at the **beginning of chapter N**. So something revealed during
  chapter 4 lives in `deltas/ch04.json` and first appears when the user selects
  chapter 5. This is intended.

## Delta format

Only include fields that changed. Shape (see `Delta` in the schema):

```json
{
  "schemaVersion": 1,
  "chapterIndex": 4,
  "notes": "Short human summary of what changed this chapter.",
  "set": { "level": 2, "floor": 1, "location": "…", "stats": { "strength": 6 } },
  "inventory": { "add": [ { "id": "…", "name": "…", "rarity": "…", "qty": 1,
                            "effects": "…", "description": "…" } ],
                 "remove": ["item-id"], "update": [ { "id": "…", "qty": 2 } ] },
  "skills":       { "add": [ { "id": "…", "name": "…", "level": 1, "description": "…" } ] },
  "effects":      { "add": [ { "id": "…", "name": "…", "kind": "buff|debuff|neutral", "description": "…" } ] },
  "achievements": { "add": [ { "id": "…", "name": "…", "description": "…", "reward": "…", "note": "…" } ] },
  "contacts":     { "add": [ { "id": "…", "name": "…", "relation": "…", "note": "…" } ] },
  "sources": [ { "ref": "stats", "chapter": 4, "derived": false, "note": "…",
                 "quote": "Strength: 6  Intelligence: 3  …" } ]
}
```

Rules:
- `set` deep-merges: `"stats": { "strength": 6 }` changes only strength.
- List ops: `add` new entries, `remove` by id, `update` by id (partial). Stackable
  items (with `qty`) added by an existing id bump the quantity.
- **`equipment` is a top-level list op, NOT part of `set`.** It is a flat list of
  worn items, each an Item plus a `slot` field. Use it exactly like `inventory`:
  ```json
  "equipment": { "add": [ { "id": "…", "name": "…", "rarity": "…", "slot": "accessory",
                            "statBonuses": { "constitution": 1 } } ],
                 "remove": ["pink-crocs"], "update": [ { "id": "…", "effects": "…" } ] }
  ```
  Put something on with `add`, take it off with `remove`, and never restate items
  that are still worn.
- `slot` ∈ head, body, **underwear**, hands, feet, weapon, offhand, accessory.
  **Slots are display groupings, not capacity limits** — several items may share
  one, because the books have no equipment-slot system at all. Carl's `body`
  holds his leather jacket, trollskin shirt and nightgaunt cloak together as the
  layers they are, and his `accessory` holds every ring at once (two from ch19).
  Put jewellery in `accessory`, not on the body part it touches: a toe ring is
  not footwear, and `feet` must stay empty because he is barefoot all book.
- Anything in `equipment` contributes its `statBonuses`/`grants`; items merely
  carried belong in `inventory` and contribute nothing.
- **Add a `sources` entry for every non-trivial change** so data is auditable.

### Citations: the quote is book text and nothing else (IMPORTANT)

`npm run validate` searches the chapter for every quote, so a quote that has
been tidied up, joined across a paragraph break, or annotated will fail. Keep
the four other fields doing their jobs instead:

- **`quote`** — copied from the page, character for character. Where you skip
  text, write `…`; each side of the ellipsis is matched separately, so you can
  stitch a status box together across the prose between its lines. Never put
  your own words inside it, not even in brackets.
- **`ref`** — what the entry backs, and it must be something this delta actually
  changes: a path into `set` (`stats.strength`, `misc.crawlerId`), a whole list
  (`achievements`), or one item in a list (`inventory:torch`). Every field you
  change should have at least one entry pointing at it.
- **`chapter`** — only when the text is printed somewhere other than this
  chapter, which happens more than you would think. Carl reaches level 2 in
  ch03, but the notification is only printed in ch05 when his inventory comes
  online; Mordecai's infobox is read in ch03, a chapter after he appears; the
  rule that mana equals Intelligence is stated once, in ch08, and governs every
  chapter after it. Cite where the words are, and add a `note` saying why.
- **`derived`** — set it when the number is computed from a rule rather than
  printed. Donut's Strength at level 2 comes from Enhanced Growth, not from any
  sentence, so it is `derived` with the rule quoted and the arithmetic in
  `note`. Validation asks for a quote containing the number otherwise.
- **`note`** — your reasoning, the arithmetic, why the chapter differs.
  Everything that is not the book talking.

### Achievements: quote the AI, don't summarise it (IMPORTANT)

The book prints an achievement as three parts, and all three are content:

```
New achievement! Podophilia!
You’ve used your bare feet to crush and kill an opponent! Hey! That’s my
fetish! Seriously. Keep doing it, and you’ll be rewarded. This will help.
Reward : You’ve received a Gold Shoe Box!
```

- `name`, `description` and `reward` are the system's **verbatim** words —
  including the profanity (`bare fucking hands`) and the AI's casing (`Empty
  pockets`, not `Empty Pockets`). The snark is the achievement; a paraphrase
  throws away the only voice the dungeon has. It is also sometimes load-bearing:
  "keep doing it, and you'll be rewarded" is the system steering Carl into the
  barefoot build.
- **Never flatten a reward to "None."** The reward line is where the joke often
  lives — *"None! Haha. You are so dead."*, *"That sense of fulfillment you
  feel? That's reward enough."*, *"It's probably going to hit back."*
- A few boxes have **no commentary line** (`Fall into an obvious trap` goes
  straight from name to reward). Then omit `description`; don't invent one.
- `note` is the one field that is **ours**, not the book's: the surrounding fact
  the AI leaves out (which mob, which trap, what it triggered). Use it freely,
  and never put book text in it.
- When the prose only *mentions* an achievement without showing the box (Donut's
  are all reported second-hand through Carl), **omit `description` entirely**
  and put the summary in `note`, saying the wording is unknown. `description`
  must only ever hold text the book actually displayed.

### Delayed reveals: add a placeholder, then `update` it

Sometimes the character earns something in chapter A but only *learns what it
says* in a later chapter B. Carl's inventory is inactive until chapter 5, so
eight notifications earned in chapters 2–3 sit queued unread until Mordecai says
*"now that inventory is active, you can pop up your missed notifications."*

Do **not** write chapter B's wording into chapter A's delta: the view for a
chapter must never contain text the character hasn't seen yet. Model the reveal
in two steps instead, which is exactly what list `update` ops are for:

```json
// deltas/ch03.json — earned here, unreadable
"achievements": { "add": [
  { "id": "podophilia", "name": "(Unread notification)",
    "note": "Earned by leaping onto the Goblin Engineer and crushing him barefoot. Queued unread: his inventory is not yet active, so he cannot open the notification." } ] }

// deltas/ch05.json — read here, so the real text lands here
"achievements": { "update": [
  { "id": "podophilia", "name": "Podophilia!", "description": "You’ve used your bare feet…", "reward": "You’ve received a Gold Shoe Box!", "note": "Leapt onto the Goblin Engineer…" } ] }
```

The composed view then tells the truth at every chapter — an unread notification
at chapter 4, the full box at chapter 6 — and because `diff.ts` reports list
updates, the reveal shows up in the changes box as its own event. Keep the `id`
stable across both steps; that is what ties them together, and `validate.ts`
fails the build if an `update` names an id that was never added.

The same shape fits any withheld-then-revealed fact, not just achievements.

⚠️ Consequence for extraction: **a chapter's own text may not contain the
wording for the achievements it awards.** If a chapter grants one without
showing the box, write the placeholder — and when a later chapter dumps a
backlog of notifications, author it as an `update` on the earlier ids rather
than as new achievements, or you will end up with duplicates.
- Never invent numbers. If the book doesn't state it, leave it `null`/omit it.
- `rarity` ∈ common, uncommon, rare, epic, legendary, unknown.

### Item stat/skill bonuses (IMPORTANT — model on the item, don't bake in)

If an item grants stat points or skill levels **while equipped**, put them ON the
item, don't fold them into the character's `stats`/`skills`. The app derives the
effective total and the tooltip breakdown from the equipped item:

- `statBonuses`: `{ "strength": 3 }` — flat stat bonuses while equipped.
- `grants`: `[ { "skill": "powerful-strike", "name": "Powerful Strike", "level": 3 } ]`
  — skills the item grants/adds levels to while equipped. These appear in the
  Skills panel automatically, tagged with their source.

So Carl's base `stats.strength` stays 6; the Toe Ring carries
`"statBonuses": { "strength": 3 }`, and the app shows STR 9 with "base 6, +3 Toe
Ring" on hover. Only put a value directly in `stats` when the book states a
permanent, item-independent change (e.g. a level-up point spend).

### Appearance & scene

- `appearance.stateId`: set in a delta only when the character's visible look
  changes (new outfit/major gear). Add a matching entry to
  `art-src/<book>/<char>/states.json` with a one-line `outfit` description.
- `scene`: set in a delta when the party's location changes to a new place worth
  depicting (drives the chapter background image). Add a matching entry to
  `art-src/<book>/scenes.json` with a one-line `description`. Keep the number of
  scenes reasonable (one per distinct location, not per chapter).

## Appearance / outfit states

Set `appearance.stateId` in `base.json`, and in a delta **only when the
character's visible look meaningfully changes** (new outfit, major gear). Use ids
like `carl-01-boxers`, `carl-02-coat`. In that delta's `notes`, describe the new
outfit in one sentence (used later to generate the art). Report the full list of
states you defined (id, label, firstChapter, one-line outfit description).

## EXTENSION PROTOCOL (read carefully)

Routine changes — new item, stat change, new skill/effect/achievement, party
join, outfit change — just author them per above.

**But if a chapter introduces a genuinely NEW KIND of state that the schema does
not model** (a structure with no home in identity/level/floor/location/stats/
resources/equipment/inventory/skills/effects/achievements/contacts/appearance/
misc — e.g. Book 3's multi-room personal-space "house" with crafting tables and
leveled upgrades), **STOP and ask the user** how to model and display it. Do not
force it into `misc`, and do not silently drop it. Small one-off facts (gold
count, a personal-space availability note) are fine in `misc`.
