#!/usr/bin/env bash
# Commit config.json / discussions changes made by a workflow and push to main, retrying on a race.
# Usage: commit.sh "<message>" "<command that regenerates the changes>"
# If another push changed the same files meanwhile, the rebase is abandoned, the branch is reset to the
# latest main, and the changes are regenerated on top of it (both generators are safe to re-run).
set -euo pipefail
msg="$1"; regen="${2:-}"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -A discussions config.json
if git diff --cached --quiet; then echo "Nothing to commit."; exit 0; fi
git commit -q -m "$msg"
for i in 1 2 3 4; do
  if git pull -q --rebase origin main && git push -q origin HEAD:main; then echo "Pushed: $msg"; exit 0; fi
  git rebase --abort 2>/dev/null || true
  if [ -n "$regen" ]; then
    git fetch -q origin main && git reset -q --hard origin/main
    bash -c "$regen" || true
    git add -A discussions config.json
    if git diff --cached --quiet; then echo "Nothing left to commit after catching up with main."; exit 0; fi
    git commit -q -m "$msg"
  fi
  sleep $((i * 5))
done
echo "::error::Could not push after 4 tries"; exit 1
