# CURRENT TASK

> This file is the repository handoff note. Update it before switching devices or ending a work session with unfinished changes.

- **Task**: S0 portable collaboration and engineering foundation
- **Branch**: `chore/S0-portable-workflow`
- **Issue**: `#1` - S0 portable engineering foundation
- **Draft PR**: `#2` - `[S0] 建立可迁移协作与 Cocos 工程地基`
- **Base commit**: `36bbe2f`
- **Device owner**: current macOS device
- **State**: in progress

## Completed

- Project goals, six-week scope, collaboration model, and cross-device policy agreed with the author.
- Work branch created from clean, synchronized `main`.
- Durable Codex guidance, plain-language workflow, GitHub templates, review checklist, and `$device-handoff` added.
- Product, architecture, progress, and decision documents aligned to the 2026-07-20 six-week plan.
- GitHub Issue #1 and Draft PR #2 created from the first pushed checkpoint.
- Active `Protect main` ruleset requires PRs, linear history, squash-only merging, and blocks deletion/force pushes.
- Git LFS tracking rules added for PSD, WAV, and BLEND source assets; local LFS installation remains pending.
- Exact Node/Cocos installation and temporary-project acceptance steps documented for macOS and Windows.
- macOS Node.js verified locally: `node v24.18.0`, `npm 11.16.0`.
- S3a minimal-physics interface draft prepared; implementation remains blocked behind S0 Cocos/Node validation.
- GitHub Issue #3 now records the S3a player outcome, scope, exclusions, and acceptance criteria; it is prepared but not yet active.

## Current Work

- Wait for the author to create and validate the temporary Cocos project, then import its generated project structure.

## Next Actions

1. Author installs Cocos Dashboard and Cocos Creator 3.8.8.
2. Author creates and opens a temporary blank 2D Cocos project with Creator 3.8.8.
3. Integrate the generated project files, initialize locked dependencies, and add doctor/tests/CI/H5 build wrappers.
4. After the first successful CI run, require that status check in the `Protect main` ruleset.

## Known Blockers

- Cocos Creator is not installed on this Mac.
- GitHub CLI, Homebrew, and Git LFS are not currently available in `PATH`.

## Last Verification

- `git status`: clean before branch creation; all current changes belong to the S0 checkpoint.
- `main` and `origin/main`: both at `36bbe2f` before branch work.
- `git diff --check`: passed.
- Legacy `s1_check.mjs`: passed with local Node; confirms old data remains readable, not that the new simulation contract exists.
- Cocos/H5 checks: unavailable until the author installs Cocos Creator 3.8.8 and initializes the temporary 2D project.
- GitHub: Issue #1 and Issue #3 open; Draft PR #2 open; `Protect main` ruleset active. Required status checks remain intentionally unset until CI exists.
