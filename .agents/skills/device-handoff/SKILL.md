---
name: device-handoff
description: Safely hand the Weapon Forger repository from one computer to another. Use before switching devices, ending a session with unfinished work, or resuming work after a clone.
---

# Device Handoff

## Before Leaving The Current Device

1. Read `AGENTS.md` and `CURRENT_TASK.md`.
2. Confirm the active branch is not `main` when work is unfinished.
3. Ask the author to close Cocos Creator so scene and `.meta` writes are flushed.
4. Run `git status --short --branch`; inspect every changed and untracked file.
5. Run the available `doctor`, type, test, data, and H5 build checks. Record anything unavailable or failing; do not claim it passed.
6. Update `CURRENT_TASK.md` with branch, Issue, Draft PR, HEAD, completed work, failures, exact next action, and device owner.
7. Stage files by purpose. Never use an unreviewed `git add .`.
8. Create a descriptive checkpoint commit. Use `[WIP]` when author acceptance is still pending.
9. Push the active branch and verify the remote branch points at the same commit.
10. Confirm the working tree is clean. Return a plain-language handoff summary and the exact first prompt for the receiving device.

## On The Receiving Device

1. Read `AGENTS.md` and `CURRENT_TASK.md` before editing.
2. Fetch remote state, switch to the named branch, and pull with fast-forward only.
3. Verify local HEAD equals the handoff HEAD.
4. Fetch Git LFS objects, install locked dependencies, and run `doctor`.
5. Open the project with Cocos Creator 3.8.8, wait for import, and inspect unexpected `.meta` changes.
6. Run tests and the Web Desktop build. Append the receiving-device evidence to the Draft PR.
7. Do not implement new functionality until reproduction succeeds or the mismatch is documented and resolved.

## Safety

- Never use `git reset --hard`, force push, or delete a remote branch during handoff.
- If local work conflicts with remote state, create a `rescue/<date>-<summary>` branch and commit the local state before reconciliation.
- Do not hide failed checks. A precise failure is valid handoff evidence.
