#!/usr/bin/env bash
# Commit config.json / discussions changes made by a workflow and push to main, retrying on a race.
set -euo pipefail
msg="$1"
git config user.name "github-actions[bot]"
git config user.email "41898282+github-actions[bot]@users.noreply.github.com"
git add -A discussions config.json
if git diff --cached --quiet; then echo "Nothing to commit."; exit 0; fi
git commit -q -m "$msg"
for i in 1 2 3 4; do
  if git pull -q --rebase origin main && git push -q origin HEAD:main; then echo "Pushed: $msg"; exit 0; fi
  sleep $((i * 5))
done
echo "::error::Could not push after 4 tries"; exit 1
