# Arena Line — ChatGPT Sites port

This folder is an isolated Sites-runtime adapter generated from the current GitHub source. It is separate from the Railway entrypoint `server.mjs`; the existing `main` branch is unchanged.

## Runtime shape

- Entry point: `sites/worker.mjs` (Fetch API handler, not a Node HTTP server).
- Durable profiles: Sites D1 binding named `DB`, table `arena_profiles`.
- Synced event cache and sync metadata: D1 tables `arena_synced_events` and `arena_runtime_state`.
- UI modules, styles, service worker, manifest, and icon are embedded from the exact source files on this branch so runtime code does not need filesystem reads.
- The original compiled app bundle and result bridge are reused from the repository.

## Before deploying

1. Import this branch as a compatible local source project in ChatGPT Sites / Work and select the `sites/worker.mjs` entry point.
2. Provision a new Sites D1 database binding named `DB`; `.openai/hosting.json` declares this binding.
3. Save a private preview version first.
4. Test profile create/login/sync/password change, refresh persistence, feed sync, result settlement, team/tournament media, and the full betting flow.
5. Do not deploy publicly until these checks pass.

The worker is a migration candidate, not a claim that the Site has already been published. Railway's original server and profile volume are not modified by this branch. Profiles in Railway's volume are not automatically copied into the new D1 database; a separate data export/import is required if those records must be retained.
