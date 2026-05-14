# Public release: audit-then-push runbook

> Operator runbook for repos that have two remotes by design — a full internal source-of-truth and a curated public scaffold. Use this when the two remotes have different histories on purpose (e.g. internal strategy IP that does not ship publicly).
>
> Cost of getting this wrong: leaking internal artifacts to the public mirror, where anyone can clone before rollback. Even after a force-push rollback, GitHub retains orphaned commits in dangling-objects for ~90 days. Brief leaks survive in the reflog.

## The two-remote model

```
                       local main
                            │
              ┌─────────────┴─────────────┐
              ▼                           ▼
        internal/main                 public/main
       full history                  stripped of
       all internal docs             internal artifacts;
       strategy specs                linear public-release
       research / backtests          history with stable
       handoff documents             SHAs
```

The public mirror does NOT fast-forward from the internal mirror. Its history was rebuilt with new SHAs to drop private content. **Pushing local `main` (internal-aligned) directly to the public remote is non-fast-forward** and will either be rejected or, if forced, overwrite the curated history.

## Allowlist principle

Default-deny. Anything not on an explicit allowlist stays internal.

Maintain two lists per repo (in operator-local notes, not in the public doc):

- **Allowlist** — files/paths that have been audited and approved for the public mirror.
- **Stop-list** — files/paths that are explicitly internal and must never go public.

When a new file is created, add it to one of the two lists during the same commit. Files in neither list default to internal.

## Three-axis audit BEFORE every public push

Run all three. Each must pass independently. If any fails, do not push.

### Axis 1 — diff-stat audit
List every file the proposed push touches.

```bash
git diff --stat public/main..<your-proposed-branch> | tee /tmp/proposed-diff.txt

# Cross-reference against your local stop-list patterns:
for pat in <internal-pattern-1> <internal-pattern-2> ... ; do
  if grep -qE "$pat" /tmp/proposed-diff.txt; then
    echo "STOP: '$pat' appears in proposed diff — review or remove"
  fi
done
```

If any STOP line prints, do NOT proceed without an explicit per-file decision.

### Axis 2 — import-graph audit
For every new source file you propose to publish, ensure its imports already exist on `public/main`.

For TypeScript:
```bash
grep -E '^import|^from' <new-file.ts> \
  | grep -oE '"[./][^"]+"' | tr -d '"' \
  | while read mod; do
      case "$mod" in
        ./*) path="$(dirname <new-file.ts>)/${mod#./}.ts" ;;
        *)   path="$mod" ;;
      esac
      if ! git cat-file -e "public/main:${path}" 2>/dev/null \
         && ! git cat-file -e "public/main:${path%.ts}.ts" 2>/dev/null; then
        echo "MISSING DEP: ${path} imported by <new-file.ts> not on public/main"
      fi
    done
```

Each MISSING DEP must be either (a) added to the same publish, or (b) the importing file is removed from the publish. No half-publishes.

### Axis 3 — link audit on docs
For every markdown file you propose to publish, grep for links to files that won't exist on the public mirror:

```bash
for f in $(git diff --name-only public/main..<branch> -- '*.md'); do
  grep -oE '\[.*\]\([^)]+\.md\)' "$f" | grep -oE '\([^)]+\.md\)' | tr -d '()' \
    | while read link; do
        case "$link" in http*|*://*) continue;; esac
        target="${link#./}"
        if ! git cat-file -e "public/main:${target}" 2>/dev/null \
           && ! grep -q "$target" /tmp/proposed-diff.txt; then
          echo "BROKEN LINK: $f → $link"
        fi
      done
done
```

Each BROKEN LINK must be (a) added to the publish, (b) stripped from the doc, or (c) the doc removed from the publish.

## The push workflow (after all three audits pass)

### Step 1 — build the curated branch off public/main
```bash
git fetch public
git switch -c release-YYYY-MM-DD public/main
```

### Step 2 — bring files in selectively
Do NOT use `git checkout main -- .` — that brings everything including internal files. Instead, enumerate every file:

```bash
git checkout main -- \
  path/to/file1 \
  path/to/file2 \
  path/to/file3
```

### Step 3 — strip references in any docs that ship
If a doc references internal-only paths, strip those references with `sed` before publishing:

```bash
sed -i.bak \
  -e 's|`<internal/path>`|(see internal docs)|g' \
  -e '/<internal-keyword>/d' \
  path/to/doc.md
rm path/to/doc.md.bak
```

Then re-run Axis 3 to confirm no broken links remain.

### Step 4 — re-run all three audits on the staged branch

```bash
git diff --stat public/main..HEAD | head -50
# Re-run STOP grep, import-graph, link audit
```

### Step 5 — commit as one squashed release commit
```bash
git add -A
git -c commit.gpgsign=false commit -m "feat(public): <short description>

NO internal handoffs / strategy docs / research included.
See internal mirror for full design history."
```

### Step 6 — push fast-forward
This MUST be a fast-forward (`public/main` → new commit). Never `--force`.

```bash
git push public HEAD:main
```

If rejected as non-fast-forward, something on public moved underneath you. Fetch + rebase, do NOT force-push.

### Step 7 — clean up
```bash
git switch main
git branch -d release-YYYY-MM-DD
```

## Recovery: if you leaked something

1. **Immediate**: force-push public/main back to the last known-good SHA:
   ```bash
   git push public +<last-good-sha>:main
   ```
2. **Document**: the orphaned commit lives in the host's reflog for ~90 days. Cloners during the leak window keep local copies forever.
3. **Decide**: contact the hosting provider's support to purge dangling-objects if leak content is severely sensitive (rare; usually overkill).
4. **Post-mortem**: append a row to an operator-local leak log with date, window, content category, recovery action, lesson.

## TL;DR

- Two remotes by design: full internal + curated public.
- Default-deny on public. Maintain explicit allowlist + stop-list.
- Three-axis audit before every public push: diff-stat (file list), import-graph (deps exist), link-audit (md links resolve).
- File-by-file staging on a branch off `public/main`. Never `git checkout . -- .` from internal-aligned `main`.
- Fast-forward push only. Force-push reserved for leak rollback.
- Strip doc references that point at internal-only paths before publishing.
- Every public release commit gets one squashed message, no internal history.
