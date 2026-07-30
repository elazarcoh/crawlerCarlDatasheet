"""Reconcile the published previews with the current set of targets.

Usage: update_previews.py <site-dir> <targets-json>

Records each target's head SHA (that is what lets the next run skip unchanged
branches) and deletes previews whose PR has been closed or merged.
"""
import datetime
import io
import json
import os
import shutil
import sys

site, targets_json = sys.argv[1], sys.argv[2]
targets = {t["name"]: t for t in json.loads(targets_json)}

meta_path = os.path.join(site, "previews.json")
meta = json.load(io.open(meta_path, encoding="utf-8")) if os.path.exists(meta_path) else {}
today = datetime.date.today().isoformat()

previews_dir = os.path.join(site, "previews")
present = {
    d for d in os.listdir(previews_dir)
    if os.path.isdir(os.path.join(previews_dir, d))
} if os.path.isdir(previews_dir) else set()

for name, t in targets.items():
    if name not in present:
        continue  # target exists but was never built (shouldn't happen)
    entry = meta.get(name, {})
    # Only stamp a new build date when the content actually changed.
    built = entry.get("built", today) if entry.get("sha") == t["sha"] else today
    meta[name] = {
        "title": t["title"],
        "ref": "%s @ %s" % (t["ref"], t["sha"][:7]),
        "sha": t["sha"],
        "draft": bool(t.get("draft")),
        "built": built,
    }

for name in sorted(present - set(targets)):
    shutil.rmtree(os.path.join(previews_dir, name))
    meta.pop(name, None)
    print("pruned %s (no longer an open PR)" % name)

for name in sorted(set(meta) - present):
    meta.pop(name)

io.open(meta_path, "w", encoding="utf-8", newline="\n").write(
    json.dumps(meta, indent=2, ensure_ascii=False, sort_keys=True) + "\n"
)
print("previews now: %s" % ", ".join(sorted(meta)))
