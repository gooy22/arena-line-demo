# Vercel deployment

The Vercel deployment uses `Dockerfile.vercel` so the existing Node HTTP server and its routes remain intact.

## Storage

- Profile JSON is stored under `arena-line/profiles/` in a **private Vercel Blob** store. The runtime must have valid Vercel Blob credentials. Profile contents are not served through public Blob URLs.
- Live feed events and sync metadata are kept in the running Node process, not in Blob. Vercel Blob overwrites are eventually consistent (updates can take up to 60 seconds to propagate), so Blob is unsuitable for this application's high-frequency mutable event state without a separate transactional store. In-memory sync state can reset on cold starts and is not shared across multiple containers.
- Temporary media/logo lookup caches are also process-local.

## Feed authorization

The browser connects directly to the external Parik WebSocket feed. Automated browser checks observed HTTP 403 responses from both feed endpoints. The site can load, and the separate results-source health probe succeeds, but live feed data requires the provider to authorize the Vercel origin or a valid feed key/endpoint.

## Data migration

This deployment does not automatically copy profile files from Railway's `/data/profiles` volume. Any existing profile data must be exported from the old persistent volume and imported separately before users rely on the new deployment.

## Deployment

The Vercel project is currently deployed from the `vercel-deploy` branch using a container build that clones the public GitHub repository. Automatic GitHub-to-Vercel deployments are not connected yet; future code changes require a new deployment until that integration is configured.
