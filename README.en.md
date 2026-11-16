# dsh-archived-open

中文 → [README.md](README.md)

## Is this for you?

DeepSeek Harness (DSH) hides an archived session behind a guard: clicking its
sidebar row only shows "Archived sessions cannot be opened. Unarchive it to
view." You have to unarchive first, then click again.

- You archive a lot and keep wanting to look back at old sessions. Install it.
  One click opens the session.
- You only want to peek and keep the archive state as it is. Do not install it.
  This plugin really unarchives — the session returns to the normal list.
- You never archive, or never reopen archived sessions. Skip it.

## Quick start

```sh
# 1. clone into ~/.dsh/plugins/dsh-archived-open
git clone https://github.com/gpboyer2/dsh-archived-open.git ~/.dsh/plugins/dsh-archived-open

# 2. register it in the desktop profile
dsh plugin --profile desktop add link:$HOME/.dsh/plugins/dsh-archived-open

# 3. restart DSH
```

`dsh.bundle.patch` points at the bundled `cordis.patch.yml`, so the plugin is
inserted into the plugin tree automatically; there is no profile patch to edit
by hand.

After the restart, click any archived session: it is unarchived and opened in
the same gesture.

## What it does

**It fuses "unarchive" and "open" into one click.**

- Clicking an archived row in the sidebar unarchives the session and opens it.
- The row's own controls (the "…" menu, archive/pin buttons) behave as before.
- Double clicks and repeated clicks restore once.
- A rejected unarchive is not swallowed: it writes an `error` line instead of
  silently jumping the view somewhere else.

## How it works

DSH 0.2 funnels every session-row click through one guard:

```js
const guardedOpen = (sessionId) => {
  if (archivedSessionIds.includes(sessionId)) {
    notifyArchivedNotOpenable()
    return
  }
  open(sessionId)
}
```

An archived session can therefore never be opened. Unarchiving itself is a
shipped capability (`uiWorkspace.unarchiveSession`); it is simply not wired to
the click.

The plugin intercepts the click first, in the capture phase on `document`:

1. match `[data-row-key="session:<id>"]` where `<id>` is in `archivedSessionIds`;
2. `preventDefault()` + `stopPropagation()`, so the native toast never fires;
3. `await unarchiveSession(id)`;
4. wait for the local snapshot to drop the id (at most 3 seconds);
5. `openSession(id)`.

Step 4 is mandatory: DSH enforces "an archived session cannot stay open", so
opening before the snapshot updates would clear the view right away.

## Diagnostics

Every stage is appended to `~/.dsh/logs/archived-open.log`. If a click does
nothing, read that file first:

| Last line | Meaning |
| --- | --- |
| nothing at all | The plugin never entered the tree: check `dsh.profile.bundles` in the profile, and that `dsh.bundle.patch` was read |
| `host-apply` only | Host loaded it, but the client half never reached the browser: check the browser console for bundle errors |
| `client-apply` only | Running, but no click matched a session row: `nomatch` lines carry the actual `aria-description` and `data-row-key` |
| `hit` → `unarchived` → `opened` | Working |
| `error` | The host rejected the unarchive; the reason is on the line |

Each `nomatch` shape is logged once, so the file does not flood.

## Configuration

| Option | Default | Meaning |
| --- | --- | --- |
| `debug` | `true` | Write diagnostics and register the trace route |
| `logFile` | `~/.dsh/logs/archived-open.log` | Where diagnostics go |

Set them in `cordis.patch.yml`'s `config:` block, or override them from the
profile patch layer. With `debug: false` the trace route is not registered at
all and nothing is written.

## Tests

```sh
npm test
```

Four tests: archived rows are intercepted, row controls pass through, live rows
pass through, repeated clicks restore once — plus the host trace route's write
path and rejection of malformed bodies.

## Known limits

- **Archived rows in search results are not handled.** Those rows carry no
  session id in the DOM, so the plugin cannot identify the target; the native
  toast still appears there. Sidebar rows are unaffected.
- **Opening unarchives.** There is no "re-archive after leaving", because that
  would make sessions jump around the list — worse than the original friction.
- **A DSH restart is required.** Client bundles are scanned at startup.
- Targets DSH 0.2.x desktop/web clients and depends on the `uiWorkspace` and
  `workspaces` client services.

## License

MIT. See [LICENSE](LICENSE).
