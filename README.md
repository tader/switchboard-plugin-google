# Google

Google sign-in for Google APIs. Other plugins build services such as Gmail on top of it.

Maintained independently from [Switchboard](https://github.com/tader/switchboard).

## Installation

Open **Plugins → Community** in Switchboard and install **Google**. Alternatively use **Install from GitHub** with repository `tader/switchboard-plugin-google` and path `plugins/google`. Review the dependency preview and apply it.

Dependencies: `oauth2` (^1.0.0). Missing external dependencies are resolved through the live community catalog; OAuth and API Keys are built into Switchboard.

## Existing installations

Install this repository before upgrading a Switchboard instance that bundles `google`. The plugin ID, service IDs, authentication methods, settings and persistent data paths are preserved. Installed plugins replace the built-in copy. Existing connections and saved calls continue to work; keep the instance data directory and encryption key.

## Setup guides

- [oauth-client](plugins/google/docs/oauth-client.md)

## Development

Use Node.js 24 or newer. Run `npm ci` and `npm run check`. The plugin folder includes local type declarations, so development does not require a Switchboard checkout. Type imports are erased at runtime; shared helpers are provided by `ctx.require()` and the manifest declares compatible versions.

Keep `plugin.json` and `package.json` versions in sync. Commit version changes before tagging a release; `gh release create` does not bump versions. Switchboard follows the branch, tag or commit selected during installation.
