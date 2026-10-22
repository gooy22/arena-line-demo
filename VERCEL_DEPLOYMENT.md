# Vercel deployment

The Vercel deployment uses `Dockerfile.vercel` so the existing Node HTTP server and its routes remain intact.

## Required setup

- Attach a **private Vercel Blob** store to the Vercel project. The project needs `BLOB_READ_WRITE_TOKEN` in its runtime environment.
- Profile JSON is stored under `arena-line/profiles/` in private Blob storage; credentials and profile contents are not exposed through public Blob URLs.
- The front-end self-test is skipped in the Vercel container to avoid repeating external media probes during cold starts.

## Data migration

This deployment does not automatically copy profile files from Railway's `/data/profiles` volume. Any existing profile data must be exported from the old persistent volume and imported separately before users rely on the new deployment.

## Runtime note

The server's live-feed sync maps are still process-local. The browser connects to the external feed directly; server-side sync status/results can be instance-local when Vercel scales to multiple containers. Profile storage is durable through private Blob.
