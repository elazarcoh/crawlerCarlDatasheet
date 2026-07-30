"""Generate the gh-pages landing page from previews.json.

Usage: make_index.py <site-dir>
"""
import io
import json
import os
import sys

root = sys.argv[1]
meta_path = os.path.join(root, "previews.json")
meta = json.load(io.open(meta_path, encoding="utf-8")) if os.path.exists(meta_path) else {}


def sort_key(name):
    if name == "main":
        return (0, 0)
    tail = name.split("-", 1)[1] if "-" in name else ""
    return (1, -int(tail)) if tail.isdigit() else (2, 0)


rows = []
for name in sorted(meta, key=sort_key):
    m = meta[name]
    badge = "baseline" if name == "main" else name.replace("pr-", "PR #")
    draft = '<span class="draft">draft</span>' if m.get("draft") else ""
    rows.append(
        """      <a class="card" href="previews/{n}/">
        <span class="badge">{b}</span>
        <span class="title">{t}{d}</span>
        <span class="meta">{r} · built {u}</span>
      </a>""".format(
            n=name,
            b=badge,
            t=m.get("title", name),
            d=draft,
            r=m.get("ref", ""),
            u=m.get("built", ""),
        )
    )

if not rows:
    rows = ['      <p class="sub">No previews published yet.</p>']

html = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Crawler Carl Statsheet — previews</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body {
    margin: 0; padding: 32px 20px 64px;
    font: 16px/1.55 ui-sans-serif, system-ui, -apple-system, "Segoe UI", sans-serif;
    background: #14110d; color: #efe6d2;
    display: flex; flex-direction: column; align-items: center;
  }
  main { width: 100%; max-width: 720px; }
  h1 { font-size: 22px; margin: 0 0 4px; letter-spacing: .2px; }
  p.sub { margin: 0 0 28px; color: #a89e88; font-size: 14px; }
  .card {
    display: grid; grid-template-columns: auto 1fr; gap: 3px 14px;
    align-items: baseline; text-decoration: none; color: inherit;
    border: 1px solid #3a3226; border-left: 3px solid #c8a44a; border-radius: 8px;
    background: #1d1913; padding: 14px 16px; margin-bottom: 12px;
  }
  .card:hover { background: #251f17; border-color: #5a4d38; border-left-color: #e8be55; }
  .badge {
    grid-row: span 2; font-size: 12px; font-weight: 700; letter-spacing: .4px;
    color: #14110d; background: #c8a44a; border-radius: 4px; padding: 3px 8px;
    white-space: nowrap; align-self: center;
  }
  .title { font-weight: 600; }
  .draft {
    font-size: 11px; font-weight: 700; text-transform: uppercase;
    letter-spacing: .5px; color: #14110d; background: #8d8676;
    border-radius: 3px; padding: 1px 6px; margin-left: 8px; vertical-align: 1px;
  }
  .meta {
    font-size: 12.5px; color: #9a9080;
    font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
    overflow-wrap: anywhere;
  }
  footer { margin-top: 26px; font-size: 12.5px; color: #7d7466; }
  @media (prefers-color-scheme: light) {
    body { background: #f6f1e4; color: #241f16; }
    .card { background: #fffdf7; border-color: #ddd2b8; }
    .card:hover { background: #fffaee; }
    p.sub, .meta, footer { color: #6d6454; }
  }
</style>
</head>
<body>
  <main>
    <h1>Dungeon Crawler Carl — statsheet previews</h1>
    <p class="sub">One static build per open pull request, for reviewing it before it is merged. Rebuilt automatically when a branch moves; previews for closed pull requests are removed.</p>
__ROWS__
    <footer>Pick a chapter, then a character tab. Compare against the baseline to see what a PR changes.</footer>
  </main>
</body>
</html>
""".replace("__ROWS__", "\n".join(rows))

io.open(os.path.join(root, "index.html"), "w", encoding="utf-8", newline="\n").write(html)
print("index.html lists: %s" % ", ".join(sorted(meta, key=sort_key)))
