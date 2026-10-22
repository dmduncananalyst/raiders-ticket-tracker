# Browser helper

The installed background reader runs from its protected local installation, outside the repository and sync folders. It does not depend on a preview server:

1. `Run-BackgroundTracker.vbs` supervises the quiet reader. The scheduled recovery trigger keeps that reader healthy; it does not launch Chrome for an empty queue.
2. `Run-BackgroundTracker.ps1` polls the authenticated hosted relay, validates each fixed-game job, checks that it remains active, then opens or recovers the dedicated Chrome/Edge profile as needed. Debugging is loopback-only on port 9227. The profile is separate from personal browsing. `Read-TicketmasterTest.ps1 -ReadMarket -Game GAME` navigates to the configured public event and returns fresh normalized offers. Timeouts stop loading; abandoned jobs and retries remain bounded.
3. `market-reader.js` reads only that event's public offer array. The source observation time is its full-navigation time, never a newly invented timestamp for reading an old open page. It matches exact own seats, verifies base/fee arithmetic and removes ineligible offers. The frontend independently validates identity, prices, eligibility, duplicates and freshness.

This is not an official Ticketmaster integration. A data-structure change or security challenge can interrupt it. No access block is bypassed. No account credentials, cookies, bank details or barcodes are read or sent to the tracker. Public listing identifiers are used internally for deduplication; they are not displayed on the page. An unreadable observation never implies a sale; the documented successful-read Sold rule is separate.

`Run-RemoteHelper.ps1` is an optional development publisher, not the installed startup path. It accepts a workers.dev HTTPS root URL and a separate publishing key, not a Ticketmaster password. See [the relay instructions](../relay/README.md).

The other modes of `Read-TicketmasterTest.ps1` are development diagnostics: scoped DOM labels, map focus, seat hover, public listing details, filter controls, response schemas and screenshots. The network observer only examines pricing responses the current public event page requested normally; it does not replay endpoints or read authentication/request headers. `browser-probe.js` only reports diagnostic candidates and metadata; those candidates never feed recommendations. `market-reader.js` is the separate, validated production reader.

`Serve-Tracker.ps1` and `Test-LiveTracker.ps1` are development-preview tools, not runtime dependencies. The preview serves an exact public-file allowlist and validates the Host header. Development test profiles and reports remain under ignored `.preview/`; installed production profiles, logs and credentials remain in the protected installation. Never add either set of private artifacts to Git or the hosted public asset package.
