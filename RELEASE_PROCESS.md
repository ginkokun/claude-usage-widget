# Release Process

This document describes the end-to-end process for cutting a release of claude-usage-widget.

---

## Branching Model

- All work goes to feature/fix branches off `develop`
- `develop` accumulates changes tracked in `STAGED_CHANGES.md`
- `main` only receives changes via formal release merges
- PRs targeting `main` are always closed and redirected to `develop`

---

## During Development

1. **Work in feature/fix branches** off `develop`
2. **Test locally** with `npm start` before pushing anything
3. **Merge to `develop`** when ready
4. **Update `STAGED_CHANGES.md`** — add the branch and a description to the table, and a full entry under Changes
5. **Do not write any files to a sub-fork until changes are agreed to work locally**

---

## Deciding to Release

When enough changes have accumulated in `develop`, review `STAGED_CHANGES.md` and decide:
- Is there enough for a release?
- What version increment is appropriate? (patch = fixes/minor improvements, minor = visible new features, major = significant overhaul)
- `package.json` on `develop` should be at `X.Y.Z-dev` between releases

---

## Release Steps

### 1. Prepare files on `develop`

- **Bump `package.json`** from `X.Y.Z-dev` to `X.Y.Z`
  - Write BOM-free: `[System.IO.File]::WriteAllText($path, $content, [System.Text.UTF8Encoding]::new($false))`
- **Add release entry to `RELEASE_NOTES_1.7.X.md`** at the top (above previous releases)
- **Clear `STAGED_CHANGES.md`** — reset the table and Changes section, keep the header
- Commit all three: `chore: release vX.Y.Z`
- Push `develop`

### 2. Merge to `main`

```bash
git checkout main
git merge --no-ff develop -m "release: merge develop into main for vX.Y.Z"
```

### 3. Push `main` first — verify CI passes

```bash
git push origin main
```

Watch GitHub Actions. All three platform builds (Windows, macOS, Linux) must pass before proceeding. If a build fails, fix on `develop`, push develop, then re-merge to main and push again.

### 4. Tag and push — only after main CI is green

```bash
git tag -a vX.Y.Z -m "Release vX.Y.Z"
git push origin vX.Y.Z
```

The tag push triggers the full release build and uploads artifacts to the GitHub Release.

### 5. Bump `develop` to next dev version

```bash
# Back on develop, bump package.json to X.Y.(Z+1)-dev
git checkout develop
# edit package.json
git commit -m "chore: mark develop as X.Y.(Z+1)-dev"
git push origin develop
```

### 6. Clean up merged branches

```bash
git push origin --delete fix/branch-name feature/branch-name
```

Only `main` and `develop` should remain on origin after a release.

---

## If a Build Fails After Tagging

1. Fix the issue on `develop`, push
2. Delete the tag locally and remotely:
   ```bash
   git tag -d vX.Y.Z
   git push origin :refs/tags/vX.Y.Z
   ```
3. Re-merge develop into main, push main, verify CI, then retag

---

## Important Notes

- **Never push to `main` without explicit confirmation**
- **`package.json` must be BOM-free** — electron-builder's JSON parser rejects UTF-8 BOM
- **Pre-release tags** (containing `-`) are auto-detected by CI workflows and marked as pre-release on GitHub
- **Stable tags** (no `-`) are marked as stable and notify users
- **Never use `Out-File -Encoding utf8`** in PowerShell for files that tools will parse — use `[System.IO.File]::WriteAllText` with `[System.Text.UTF8Encoding]::new($false)` instead
