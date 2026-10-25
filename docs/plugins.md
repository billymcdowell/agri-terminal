# Writing a data source plugin

A plugin is a single `plugin.toml`. It describes one HTTP request and how to turn the response into observations. It cannot run code, read files or contact any host it did not declare, so installing one is a matter of reading its permissions.

Start from [`plugins/template/plugin.toml`](../plugins/template/plugin.toml) (a test keeps it valid), paste your manifest into **Plugins** (`PLUGINS` in the command bar), and choose **Review permissions**. Every problem is listed with the field to change. **Install** saves the plugin switched off; turn it on after you have read what it can do.

## What the manifest controls

| Section | Purpose |
| --- | --- |
| `id`, `name`, `version`, `description`, `license_note` | Identity and attribution. The id may not match a built-in source. |
| `[permissions]` | `hosts` the plugin may contact and `secrets` it may use. |
| `[source]` | `cadence`: `daily` or `weekly`. |
| `[request]` | `https` URL with `{placeholders}`, extra `headers`, `vars`, and an optional `max_bytes`. |
| `[auth]` | Header or query-parameter credentials, taken from a declared secret. |
| `[response]` | `json` or `csv`, the rows to read, and the date field (`[response.period]`). |
| `[[series]]` | One entry per series: `id`, the row field for `value`, and the `unit`. |
| `[release]` | Optional schedule so as-of joins never use a report before it was public. |

The built-in Drought Monitor connector is a manifest too: [`plugins/builtin/us-drought-monitor.toml`](../plugins/builtin/us-drought-monitor.toml).

## How permissions are enforced

All plugin traffic goes through one client (`src-tauri/src/plugins/http.rs`):

- https only, on listed hosts only. IP addresses, `localhost`, `.local`, `.internal`, custom ports and URLs with credentials are refused even if listed.
- Redirects are followed by hand, at most three, and each hop is checked again.
- Responses are cut off at `max_bytes` (default 5 MiB, at most 20 MiB) and requests time out after 30 seconds.
- Values substituted into the URL are percent-encoded, so a variable cannot add parameters or change the path.
- A plugin's secrets are stored in the keychain as `plugin:<id>:<name>`, separate from the app's own keys, and a plugin can only name secrets it declared.
- Installed plugins may only write series that begin with `plugin.<id>.`, so they cannot overwrite prices or built-in series.
- A manifest is limited to 64 KiB, and ids cannot contain path separators.

The `plugins` tests include a malicious-plugin set covering each of these.

## Limits of this release

- Data source plugins only. Panel plugins (sandboxed iframes) and analysis plugins (expressions, then WebAssembly with fuel limits) are not built.
- Install is by pasting a manifest. There is no registry or checksum verification yet.
- A host name that resolves to a private address is not detected, because only the name is checked.
- Plugin data appears in CSV export (`SETTINGS`) but has no panel of its own yet.
