# Arena Line — isolated Fetch/D1 migration prototype

**This is not a published ChatGPT Site and has not been validated inside the ChatGPT Sites runtime.** The tests run the Fetch handler in Node and use a mock D1 implementation; they do not prove that ChatGPT Sites exposes a D1 binding or accepts a Worker entrypoint.

This branch is isolated from the Railway entrypoint `server.mjs`. The existing `main` branch and Railway deployment have not been changed.

## What this prototype contains

- `sites/worker.mjs`: Fetch API wrapper around the existing compiled application and its routes.
- `sites/profile_store.mjs`: D1-oriented profile storage implementation.
- `sites/schema.sql`: tables for profiles, synchronized events, and sync metadata.
- `sites/smoke-test.mjs`: Node-level route and mock-D1 smoke tests.
- `.openai/hosting.json`: an experimental binding declaration only; it is not evidence that ChatGPT Sites accepts this configuration.

## Actual completion gate

Do not treat this as deployable to ChatGPT Sites until the Sites UI/runtime confirms that it can use this entrypoint and a real persistent database binding. Official Sites workflows are created, previewed, saved, and published from ChatGPT Work/Sites; this repository branch does not publish a Site by itself.

The required next step is a native Sites build/preview from Work using the GitHub repository as source material, then end-to-end checks for profile create/login/sync/password change, persistence after reload, live feed sync, results settlement, team/tournament media, and the full betting flow.

Railway's original server and profile volume are not modified by this branch. Profiles in Railway's volume are not automatically copied into any new database; preserving them requires a separate export/import.
