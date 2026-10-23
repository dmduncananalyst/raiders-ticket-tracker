# JD Ticket Tracker

A read-only Raiders ticket page for a phone. All five games stay visible. The three unsold games show fresh asking prices, comparable Section 221 listings with row labels, and a supported pricing decision. Rams and Seahawks are marked sold as confirmed by the owner.

## Installed free setup

The owner accepted a computer-dependent setup: Windows stays on, awake, online, and signed into the owner's Windows account. Codex, VS Code, and ordinary browser windows may be closed. When enabled, a windowless Windows Scheduled Task named **JD Ticket Tracker** owns the background reader. It starts at Windows sign-in and recovers if its child reader exits. The dedicated minimized Chrome browser opens only for a valid active price-check job. After 30 seconds without another queued job, the reader closes only the dedicated browser window. Closing it with an empty queue does not reopen it. The reader prevents automatic sleep while running; manually shutting down or sleeping the computer interrupts pricing.

The hosted frontend and private job relay run together on Cloudflare Workers Free. The private bookmark is stored as `phone-url.txt` inside the protected installation's private state folder; never paste it into this public repository. Opening, returning to the tab, or restoring the page requests new observations. The website cannot run arbitrary commands on the computer. It can request only one of the five fixed games; the helper validates the job and uses its fixed local reader script. No incoming tunnel or public local browser-debugging port is used.

The dedicated browser reads public Ticketmaster listings only. The reader never edits tickets, buys tickets, accesses account/checkout data, or reads the user's regular browser profile. A site change or security challenge can still interrupt collection. One normal reload is retried automatically. Failed checks withhold prices and advice; they do not display stored observations as current or infer a sale from an unreadable page.

## Public repository and credentials

No real credentials belong in source, frontend assets, documentation, screenshots committed to Git, or command arguments. The installed runtime, private files, and dedicated browser profiles live in a protected local application-data folder outside the repository and sync folders. Access is restricted to the owner, SYSTEM, and Administrators. Development artifacts under `.preview/` and `.wrangler/` are ignored by Git and excluded from hosted assets. Publishing and viewing keys are separate Worker secrets; encrypted local key records use Windows user encryption (DPAPI). The private bookmark contains only its limited viewing key, which cannot publish results or manage Cloudflare. The helper decrypts its publishing key only under the owner's Windows account. Local programs running as that user remain within the trust boundary.

Only five frontend files and six team SVGs are packaged by `tools/Prepare-FreeSite.ps1`. The upload excludes the repository, tools, tests, logs, profiles, local configuration, and credentials. There is no commit or push in the installation workflow.

## Owner maintenance

- `tools/Install-BackgroundTracker.ps1` installs or updates the protected runtime and task. Installation requires the task to be disabled and leaves it disabled. Enable it separately only when normal operation is wanted.
- `tools/Run-BackgroundTracker.vbs` is the windowless watchdog; `tools/Run-BackgroundTracker.ps1` collects requested prices and reports them to the relay.
- `tools/Deploy-FreeTracker.ps1` prepares and directly deploys the whitelisted site to the existing Worker. It preserves existing secrets and never restores saved credentials. Cloudflare authorization is needed for deployments, not ordinary operation.
- To disable the installation, stop and disable the **JD Ticket Tracker** task in Windows Task Scheduler. Close only its dedicated Ticketmaster browser afterward.
- `background.log` inside the protected installation records startup, retries, and completion status without keys or account information.

The developer preview is `http://localhost:4174/` while `tools/Serve-Tracker.ps1` runs. It is not the phone address. Opening the local HTML file redirects to that preview. Use the hosted private bookmark for normal use.

## Price verification

Preconfigured seats are Section 221, Row 1, Seats 11–14. The other-seller display includes verified resale listings throughout Section 221, across numeric rows and available consecutive ticket quantities. Separate listing IDs retain their individual prices even in the same row. Recommendation eligibility remains narrower: comparisons require the same event, Section 221, Rows 1–4, two or four consecutive seats, USD resale inventory, and an explicit listing ID. All offers overlapping the owner's seats are excluded from comparisons. The source's base-price fields must agree and reconcile exactly with its itemized charges and total. No guessed fee percentage is used.

Different verified own pair prices are both displayed. One shared recommendation requires complete own-seat coverage and the same independently calculated recommendation for both pairs. The agreed rule compares against the lowest eligible comparable asking price: above 105% suggests one dollar below it; below 90% suggests matching it; inclusive middle bounds keep the current price. The existing rules treat Rows 1–4 as eligible comparisons; they do not apply an invented row-quality adjustment.

A successful full-event read without any own-seat offer displays Sold, following the owner's instruction. That means no public listing was found; it does not prove a completed transaction. Explicit owner-confirmed sold games remain sold. Freshly inferred Sold is checked again on the next opening.

## Verification

- `tests.html`: page, pricing rules, clearing stale data, return/reopening, timeout, and phone layout checks.
- `relay/relay-tests.html`: authentication, freshness, job isolation, persistence, expiration, and long reads between publisher heartbeats.
- `tools/Test-ChargersHandoff.mjs`: request identity, clock differences, freshness, failure/success transitions, and other-game rendering regressions.
- `tools/security-tests.mjs`, `tools/security-extra-tests.mjs`, and `tools/security-cdp-tests.mjs`: authorization, queue bounds, cancellation, redirect rejection, private-path rejection, and prepared security headers. Test dependencies and reports remain under ignored `.preview/`.

The collector verifies each observation against a new navigation in its own clock. The relay binds queue/lease timestamps to the request ID; the frontend uses a conservative freshness bound without comparing independent phone and collector clocks. Stale and mismatched observations remain rejected.

An emulated phone test is not a physical phone test. The final phone check is opening the private bookmark on a phone using cellular data.
