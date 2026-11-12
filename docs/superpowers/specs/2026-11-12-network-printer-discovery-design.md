# Network printer discovery through VPN

## Intent and agreed direction

The operator runs PrintOps through a VPN and can ping the printer network. Existing discovery enumerates installed Windows/CUPS queues; it does not scan remote printers. The user selected an on-demand form on the Discovered Printers page: enter an IP or IP range and choose the Runner that should search.

## Approaches

1. **Chosen:** initiate a bounded search from the dashboard and execute it on the selected Runner. Operators can change destinations without editing machine configuration, and the search uses the same network vantage point as the Runner.
2. Configure automatic scanning ranges in Runner environment variables. Less UI and command plumbing, but unsuitable for the chosen interactive workflow.

## Proposed first-release scope

- Add a Thai/English search form to the existing Discovered Printers page, with Runner selection, IPv4 target input, and a search action. Accept a single address, CIDR, or inclusive start/end range. Normalize and deduplicate before enforcing a maximum of 256 addresses per search.
- Search TCP port 9100 initially, matching PrintOps' existing raw network printing adapter. This is an explicit first-release limitation: IPP-only, LPD-only, shared Windows queues, and IPv6 network scanning are outside this change. Existing installed-printer discovery remains available for these queues.
- A successful TCP connection is a reachable network-printing candidate, not verified printer identity or successful physical printing. Display the address and detected port without inventing a manufacturer/model. Never send print payloads, PJL, or test pages during discovery.
- Show queued/running/completed/failed/expired state and discovered candidates. An empty completed search explains that no reachable port 9100 was found; it does not claim the VPN or printer is offline. Ping is not a prerequisite for scanning.
- Register selected candidates using `raw_tcp_9100` and the canonical TCP URI expected by the existing adapter, preserving the selected Runner association. Existing OS queue registrations retain their current behavior. Registration does not print automatically.

## Architecture and constraints

- Browser submits a search to the API. The API persists its Runner, normalized targets, timestamps, state, and results; the Runner polls and claims its pending search using outbound authenticated HTTP. The browser must not require inbound access to the Runner or use the API host's network as a substitute.
- Implement a separate lightweight polling/execution loop that also runs when Runner job execution is disabled. Desktop uses discovery-only Runners, so print-job polling cannot carry search commands. Avoid blocking heartbeats, OS queue discovery, or print processing.
- Existing `/runners/:runnerId/printers/discover` returns `queued: true` without delivering work. Do not reuse that response as evidence a search ran. Introduce explicit network-search endpoints and states.
- Proposed bounds: one outstanding search per Runner; at most 16 concurrent TCP connections; a 1.5-second timeout per address; a 60-second execution deadline and a bounded queue lifetime. Validate on both API and Runner. Persist a claim/lease so another poll cannot execute the same active search. Reject late results from an expired/replaced claim.
- Persist successful candidates through the discovery repository with a stable address/port identity and explicit network-discovery metadata, preserving original registration links on subsequent scans. A partial timeout preserves observed candidates and reports the incomplete outcome.
- Protect start/register operations with the existing printer-management permissions, and polling/results with the existing Runner authentication model plus Runner/search/claim validation. Validate requested Runner existence. Follow repository audit and error conventions.
- Old Runners do not implement this protocol. Advertise support in Runner metadata so the UI can explain that an update is required, rather than queue work they cannot consume. Offline/expired searches are visible instead of staying pending indefinitely.
- Follow existing SQLite repository and composition-root patterns. Respect the workspace's unrelated UI edits; do not replace or revert them.

## Verification

- API tests for target normalization/bounds, permissions, Runner capability validation, persistence, exclusive claims, expiry, late results, and correct protocol/URI registration. Retain existing OS discovery behavior.
- Go tests with local listeners/fake dialers for reachable/closed endpoints, bounded concurrency, cancellation, timeout, and no bytes written. Test search polling/result exchange without requiring a physical printer or actual VPN.
- UI verification for Runner choice, invalid targets, running/empty/error/results states, registration, and Thai/English text. Run relevant workspace typechecks and tests.
- Actual VPN connectivity cannot be established from repository tests; final reporting must distinguish local verification from a real deployment test.

## Builder decisions

Exact endpoint names, repository/schema naming, expiry scheduling, polling interval, and component extraction are implementation choices, provided they preserve these behaviors and use existing project conventions. No new scanning dependency is required.
