# Staged Changes

Changes accumulating here have already been merged into `develop`.
We keep track of these changes/fixes/features and when we have enough for a new release we decide on the next version number.

This file is tracked in the repo and visible to everyone.

---

## Branches Staged

| Branch | Description |
|--------|-------------|
| `fix/ci-actions-node20` | Bump actions/checkout and actions/setup-node to v5; Node.js matrix 18→20 |
| `feature/profile-flag` | Add `--profile=<name>` flag for isolated multi-account sessions |

---

## Changes

- **Multi-account support (power-user flag):** Launching with `--profile=<name>` isolates the instance to its own userData subfolder, giving it a completely separate Electron session, cookies, and settings. Enables two accounts to run side-by-side without interfering. Works for both installed and portable builds.

*Add new entries above this line as additional branches are staged.*
