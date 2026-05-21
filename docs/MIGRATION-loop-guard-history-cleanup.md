# Git history cleanup: loop-guard model blobs

The removed `public/models/loop-guard/` tree included ONNX weights over GitHub's 100MB file limit. After merging the tool-guardrails pivot, rewrite history to purge those blobs from all refs collaborators may fetch.

## Preflight

1. Coordinate with anyone who has cloned or forked the repo.
2. Create a backup tag on the current default branch: `git tag backup/pre-loop-guard-purge-$(date +%Y%m%d)`.
3. Ensure working tree is clean and loop-guard assets are deleted from the current tree.

## Rewrite (git-filter-repo)

Install [git-filter-repo](https://github.com/newren/git-filter-repo) if needed, then from the repo root:

```bash
git filter-repo --force --invert-paths \
  --path public/models/loop-guard/ \
  --path-glob 'public/models/loop-guard/**'
```

Alternative path-only purge:

```bash
git filter-repo --force --path public/models/loop-guard --invert-paths
```

## After rewrite

1. Verify no large blobs remain: `git rev-list --objects --all | git cat-file --batch-check='%(objecttype) %(objectname) %(objectsize) %(rest)' | awk '/^blob/ {if($3>100000000) print}'`
2. Force-push rewritten branches: `git push --force-with-lease origin main` (and any other shared branches).
3. Ask collaborators to re-clone or run:
   ```bash
   git fetch origin
   git reset --hard origin/main
   ```
4. Confirm `.gitignore` includes `public/models/loop-guard/` so the tree is not re-committed.

## Notes

- Rewriting history invalidates existing PR branches that contain the old blobs; rebase or recreate them against the rewritten main.
- Do not re-add loop-guard model weights to the repository; the classifier approach was removed in favor of Hermes-style deterministic guardrails.
