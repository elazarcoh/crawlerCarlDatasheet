# `ci` — preview infrastructure only

This branch is **not** the project. It holds one workflow that builds a static
preview of every open pull request from this fork and publishes it to
[GitHub Pages](https://elazarcoh.github.io/crawlerCarlDatasheet/).

The code lives on [`main`](../../tree/main), which tracks the upstream
repository exactly.

## Why it is a separate orphan branch, and the default one

- Actions resolves a `push`-triggered workflow **from the branch that was
  pushed**, so a push-triggered version of this would have to exist on every
  feature branch — and would end up in every pull request sent upstream.
- `schedule` (cron) only ever runs the copy on the repository's **default
  branch**. Making this orphan branch the default is what buys hands-off
  previews without a workflow file anywhere near the code.
- Nothing descends from `ci` — feature branches are cut from upstream `main` —
  so this file cannot reach a pull request.

The workflow checks out its targets **by name**, which is why they never need to
contain it.

## Branches

| branch | what it is |
| --- | --- |
| `ci` | this: the preview workflow (default branch) |
| `main` | the project, identical to upstream `main` |
| `gh-pages` | the published site — generated, do not hand-edit |
| everything else | feature branches, each open as a PR upstream |

## Running it

Automatic every 10 minutes; a run where no branch has moved exits in seconds
without checking out the source. To force one immediately:

```bash
gh workflow run preview.yml --repo elazarcoh/crawlerCarlDatasheet
gh workflow run preview.yml --repo elazarcoh/crawlerCarlDatasheet -f force=true  # rebuild all
```

## Notes

- The art is Git LFS on `main`. Pages cannot serve LFS pointers, so the build
  smudges them to real PNGs and the workflow fails loudly if any pointer file
  reaches `dist/`. Objects are cached on their pointer hashes, so repeat runs
  download nothing.
- `gh-pages` deliberately has no `.gitattributes`, for the same reason.
- Previews work from a subdirectory because `vite.config.ts` sets `base: "./"`
  and the loader fetches through `import.meta.env.BASE_URL`.
- GitHub disables scheduled workflows after 60 days without repository
  activity; a manual run re-enables them.
