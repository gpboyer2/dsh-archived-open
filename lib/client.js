/**
 * Client half of dsh-archived-open.
 *
 * DSH refuses to open an archived session: the sidebar rows route every click
 * through a guard that shows "已归档对话暂时无法查看，请取消归档后查看". The
 * data is all there and the client API for restoring it exists
 * (`uiWorkspace.unarchiveSession`), so the manual `取消归档 → 点开` dance is
 * pure friction. This plugin removes the friction: a click on an archived row
 * unarchives the session and opens it in the same gesture.
 *
 * Implementation notes:
 *
 *  - The interception runs as a capture-phase listener on `document`, which
 *    fires before React's delegated click listener on the app root. Stopping
 *    propagation there keeps the host guard from also firing its toast.
 *  - The session id comes from the row's `data-row-key="session:<id>"`; whether
 *    the row is archived comes from the `workspaces` snapshot, not from CSS.
 *  - Clicks inside the row's own controls (archive/unarchive button, "..." menu)
 *    are left alone, so the explicit controls keep their own semantics.
 *  - `unarchiveSession()` resolves when the Host accepted the write; the local
 *    snapshot is updated by the workspace follow stream a moment later. Opening
 *    while the id is still considered archived would let the native
 *    "an archived session cannot stay open" rule clear the view again, so we
 *    wait for the snapshot to drop the id (bounded) before opening.
 *  - Every stage posts one line to the Host trace route, so a click that does
 *    not work says where it stopped instead of requiring another guess.
 */

globalThis.__ModuleLoader__.load({
  id: 'dsh-archived-open',
  factory() {
    /** Services this plugin needs from the client container. */
    const inject = ['uiWorkspace', 'workspaces']

    /** Prefix of the session row key rendered by `ui-workspace`. */
    const ROW_PREFIX = 'session:'

    /** Host route that appends trace lines to ~/.dsh/logs/archived-open.log. */
    const TRACE_PATH = '/api/archived-open.trace'

    /** Elements whose clicks belong to the row's own controls, not to "open". */
    const CONTROL_SELECTOR = [
      'button',
      'a',
      'input',
      'textarea',
      'select',
      '[role="menu"]',
      '[role="menuitem"]',
      '[contenteditable="true"]'
    ].join(', ')

    /** Longest wait for the local snapshot to accept the unarchive. */
    const SNAPSHOT_WAIT_MS = 3000

    /** Poll interval while waiting for the snapshot. */
    const SNAPSHOT_POLL_MS = 40

    const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

    /**
     * Post one diagnostic line; never throws and never blocks the click path.
     * @param stage - stage marker (`apply`, `hit`, `nomatch`, `unarchived`, `opened`, `error`).
     * @param detail - short human-readable detail.
     */
    function trace(stage, detail = '') {
      try {
        fetch(TRACE_PATH, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ stage, detail: String(detail).slice(0, 300) })
        }).catch(() => {})
      } catch {
        /* diagnostics must not affect behaviour */
      }
    }

    /**
     * Restore an archived session and open it.
     * @param uiWorkspace - workspace UI operations service.
     * @param workspaces - workspace controller snapshot service.
     * @param sessionId - archived session to restore and open.
     */
    async function unarchiveAndOpen(uiWorkspace, workspaces, sessionId) {
      await uiWorkspace.unarchiveSession(sessionId)
      trace('unarchived', sessionId)
      const deadline = Date.now() + SNAPSHOT_WAIT_MS
      while ((workspaces.list.getSnapshot().archivedSessionIds ?? []).includes(sessionId)) {
        if (Date.now() > deadline) {
          trace('snapshot-timeout', sessionId)
          break
        }
        await sleep(SNAPSHOT_POLL_MS)
      }
      uiWorkspace.openSession(sessionId)
      trace('opened', sessionId)
    }

    /**
     * Register the capture-phase click interceptor.
     * @param ctx - client root context.
     */
    function apply(ctx) {
      const uiWorkspace = ctx.get('uiWorkspace')
      const workspaces = ctx.get('workspaces')
      trace('client-apply', `uiWorkspace=${uiWorkspace !== undefined} workspaces=${workspaces !== undefined}`)
      if (uiWorkspace === undefined || workspaces === undefined) return

      /** Sessions whose restore is already in flight (double-click guard). */
      const inFlight = new Set()

      /** Probe messages already reported once, so the log stays readable. */
      const reported = new Set()

      const reportOnce = (stage, detail) => {
        const key = `${stage}|${detail}`
        if (reported.has(key)) return
        reported.add(key)
        trace(stage, detail)
      }

      const isArchived = (sessionId) =>
        (workspaces.list.getSnapshot().archivedSessionIds ?? []).includes(sessionId)

      const onClick = (event) => {
        if (event.defaultPrevented || event.button !== 0) return
        const target = event.target
        if (!(target instanceof Element)) return
        if (target.closest(CONTROL_SELECTOR) !== null) return

        const row = target.closest('[data-row-key^="session:"]')
        if (row === null) {
          const treeitem = target.closest('[role="treeitem"]')
          if (treeitem !== null) {
            reportOnce(
              'nomatch',
              `aria="${treeitem.getAttribute('aria-description') ?? ''}" key="${treeitem.getAttribute('data-row-key') ?? ''}"`
            )
          }
          return
        }

        const key = row.getAttribute('data-row-key') ?? ''
        const sessionId = key.slice(ROW_PREFIX.length)
        if (sessionId === '' || !isArchived(sessionId) || inFlight.has(sessionId)) return

        event.preventDefault()
        event.stopPropagation()
        inFlight.add(sessionId)
        trace('hit', sessionId)
        unarchiveAndOpen(uiWorkspace, workspaces, sessionId)
          .catch((error) => {
            trace('error', `${sessionId} ${String(error)}`)
          })
          .finally(() => {
            inFlight.delete(sessionId)
          })
      }

      ctx.effect(() => {
        document.addEventListener('click', onClick, true)
        return () => {
          document.removeEventListener('click', onClick, true)
        }
      }, 'archived-open: auto-unarchive on click')
    }

    return { inject, apply }
  }
})
