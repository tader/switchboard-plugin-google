# Google

Google sign-in for Google APIs. Other plugins build services such as Gmail on top of it.

Maintained independently from [Switchboard](https://github.com/tader/switchboard).

## Installation

Open **Plugins → Community** to install individual plugins. Alternatively install `tader/switchboard-plugin-google` without a path to install the whole family, or specify one of these paths:

| Plugin | Path |
| --- | --- |
| Google | `plugins/google` |
| Gmail | `plugins/gmail` |
| Google Calendar | `plugins/google-calendar` |
| Google Drive | `plugins/google-drive` |
| Google Docs | `plugins/google-docs` |
| Google Sheets | `plugins/google-sheets` |
| Google Keep | `plugins/google-keep` |

Each plugin retains its own ID and version. Shared helpers are resolved through plugin dependencies.

## Existing installations

Install this repository before upgrading a Switchboard instance that bundles `google`. The plugin ID, service IDs, authentication methods, settings and persistent data paths are preserved. Installed plugins replace the built-in copy. Existing connections and saved calls continue to work; keep the instance data directory and encryption key.

## Setup guides

- [oauth-client](plugins/google/docs/oauth-client.md)

## Development

Use Node.js 24 or newer. Run `npm ci` and `npm run check`. The plugin folder includes local type declarations, so development does not require a Switchboard checkout. Type imports are erased at runtime; shared helpers are provided by `ctx.require()` and the manifest declares compatible versions.

Keep `plugin.json` and `package.json` versions in sync. Commit version changes before tagging a release; `gh release create` does not bump versions. Switchboard follows the branch, tag or commit selected during installation.

## Releases

Release-please opens version and changelog pull requests from Conventional Commits. Merge the release PR to publish its tag and GitHub release. Plugin manifests are updated with their package versions. Family repositories maintain an independent version for each plugin.

## Reusable OAuth credentials

With Switchboard's reusable-credentials support and the updated OAuth helper, named Drive, Calendar, Docs, Sheets, and Gmail connections can use one Google authorization. Shared credentials retain granted scopes and refresh centrally. Additional APIs request explicit additional consent; signing in as another account does not replace the shared account.

Request policies preserve each connection's resource and access boundaries, including APIs on the same hostname. Read-only shared connections permit GET/HEAD requests; create a private authorization for read operations requiring POST. Drive's file-only mode cannot reuse a grant containing broader Drive scopes. Gmail's send and modify modes retain their narrower permissions. Generic wildcard Google APIs and service-account connections remain independent until they have an appropriate reusable-credential contract.
