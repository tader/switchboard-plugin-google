# Shared Email v1

Gmail implements the optional shared Email contract alongside its existing HTTP
API. Common operation names and schemas match the staged Switchboard Email v1
snapshot. No new scopes or cloud subscriptions are created automatically.

The fifteen operations cover collections, messages, read/flag state, label moves,
trash, send/reply/forward, and draft list/get/create/update/delete/send. Discovery
uses effective granted scopes together with the configured access profile;
read-only bindings never advertise writes even when the credential grant is broader.
Unsupported atomic `ifVersion` preconditions are explicitly rejected. Gmail history
IDs are observation versions, not conditional-write tokens.

Collections are labels. Move adds the destination label and removes only the
explicit source label; unrelated labels stay. System state labels cannot be move
destinations; read/flag and trash have separate operations. Label directories are
snapshots; message/draft pages state whether all accessible pages are included.
Signed cursors bind connection/account/query and survive adapter restart. They
cannot be edited to select another query. Collection and message reads do not mark
messages read. The default all-message scope includes spam/trash.

Message projections decode encoded headers and declared text charsets. Ordinary
attachments remain provider references while textual body parts stored separately
are fetched as needed. Missing/encrypted bodies are explicitly unavailable, never
empty-success text. Treat returned HTML as untrusted; sanitize it in the consumer.

New mail and replies/forwards are MIME encoded. Replies retain native thread and
RFC reply headers, default to sender-only and never inherit Bcc recipients.
Forwarding retains original attachments and inline image IDs, quoting the source
body without copying its Bcc header. Draft edits preserve unspecified fields,
existing attachments, sender alias, Reply-To and threading; supplied empty fields
clear their respective values. Signed/encrypted draft edits are rejected before a
write. Raw MIME edit/forward parsing is bounded at 16 MiB, 1,000 parts and 32 nesting
levels; unsupported content fails explicitly. No attachment upload API is advertised.

All writes require the core's durable idempotency key. There is one provider write
per operation after preflight reads. The core stores intent before dispatch;
accepted/uncertain results never automatically resend. A send receipt records API
acceptance, not recipient delivery. Provider bodies and MIME are absent from common
receipts, change events and audit entries.

Reconciliation makes an authenticated profile request and emits broad metadata
invalidation. This is polling, not native Gmail push. The core bounds work by client
activity and pauses on terminal authentication. Resource-specific 403 responses
stay permission errors and do not pause the whole account.

Validation uses offline fixtures and real core HTTP/SSE. Run `npm run check`,
`npm test` and `SWITCHBOARD_ROOT=/path/to/core npm run integration:email`.
No real emails are sent by these checks.

## API references

- [Gmail message sending](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/send)
- [Draft replacement semantics](https://developers.google.com/workspace/gmail/api/guides/drafts)
- [Thread reply requirements](https://developers.google.com/workspace/gmail/api/guides/threads)
- [Label modifications](https://developers.google.com/workspace/gmail/api/reference/rest/v1/users.messages/modify)

The MIME parser is the unmodified vendored postal-mime 4.2.0 ESM distribution,
licensed MIT-0; its license and package integrity are in `vendor/postal-mime/`.
It requires no per-plugin node_modules or runtime core imports.
