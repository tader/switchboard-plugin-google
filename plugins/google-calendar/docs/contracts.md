---
title: Shared Calendar contract (staged)
services: [google-calendar]
---

# Shared Calendar contract

This plugin adds the optional Calendar v1 category operations beside the existing
Google Calendar HTTP API. It requires the staged core contract support in
[tader/switchboard#40](https://github.com/tader/switchboard/pull/40); that core API is
disabled by default. The schema is provisional until cross-provider conformance.
The JSON and schema wrapper are vendored from the core's `server/contracts/` files.
No new scopes are requested and existing connections are not changed.

Capabilities require actual granted Calendar scopes and respect a read-only
connection binding. Calendar list results also report individual calendar write
access. Event snapshots expand recurring occurrences within an explicit time
window, preserve all-day exclusive ends and timezone information, and return
query-bound opaque page cursors. A final page has complete coverage of active
events in the requested window, not an unbounded deletion feed.

Create/update/delete return write receipts. Update/delete require the read ETag
and use `If-Match` to reject conflicting changes. Updates change only supplied
fields, preserving provider fields outside the common schema. Common creates do
not include attendees; requests use `sendUpdates=none`. This is not a promise that
a provider will suppress every email for edits to existing shared events. Recurrence
rule editing, attendees and reminders remain outside this common schema.

The collector is a bounded fallback: one calendar-list request checks access and
emits a connection-wide calendar invalidation. Consumers must reread affected
snapshots. It is not a native Google notification subscription or a precise delta
feed. Core activity leases, cooldowns, durable SSE replay and authentication pause
control when this fallback runs. Google watch registration can be added separately
without changing consumers' category operation names.

Implementation references: [events list](https://developers.google.com/workspace/calendar/api/v3/reference/events/list),
[conditional modification](https://developers.google.com/workspace/calendar/api/guides/version-resources),
and [events patch](https://developers.google.com/workspace/calendar/api/v3/reference/events/patch).
