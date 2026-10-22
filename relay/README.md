# JD private relay

The installed version uses `hosted/worker.js` to serve the public page and this relay together on one Cloudflare Workers Free address. See the root README for the accepted computer-dependent architecture and startup behavior. `tools/Prepare-FreeSite.ps1` generates the deployment configuration under ignored `.preview/`; `tools/Deploy-FreeTracker.ps1` deploys directly without a Git commit or push.

The relay accepts only five fixed game identifiers. Viewing and publishing use different random bearer keys stored as Cloudflare Worker secrets. A private phone bookmark supplies the viewing key; publishing is restricted to the computer helper. The relay cannot execute commands or access Ticketmaster, Windows files, or accounts.

Opening the page queues fresh jobs with unique request IDs. The Windows helper polls outbound HTTPS, validates the game, reads the normal public Ticketmaster event, and returns the new observation. Failed reads do not reuse old quotes. Long reads stay pending between publisher heartbeats; jobs expire after seven minutes and the frontend times out after six minutes.

The standalone `wrangler.toml` and older `Run-RemoteHelper.ps1` remain development components, not the installed startup path. Do not deploy those separately for this installation. Never place real keys, private bookmarks, profiles, logs, or configuration in this public repository.

The regression page `relay-tests.html` covers authentication, wrong-game isolation, freshness, expiration, persistence, CORS, and slow-reader behavior. It uses synthetic keys only and is excluded from the hosted public-file package.
