/**
 * Host half of dsh-archived-open.
 *
 * The behaviour lives in the browser half: DSH 0.2 already ships
 * `uiWorkspace.unarchiveSession()` and `uiWorkspace.openSession()`, so no Host
 * logic is needed. This half exists for two reasons:
 *
 *  1. the package must be a real Cordis entry (via `cordis.patch.yml`) before
 *     the host scans `dsh.client` and ships `lib/client.js` to the browser;
 *  2. it hosts the trace route the browser half reports to, so a failed click
 *     can be diagnosed from `~/.dsh/logs/archived-open.log` instead of guessed.
 */

import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'

/** Plugin id; must match the `id` in cordis.patch.yml. */
export const name = 'archived-open'

/** Host services this half uses. */
export const inject = ['connection']

/** Route the browser half posts diagnostics to. */
export const TRACE_PATH = '/api/archived-open.trace'

/** Default trace file, next to the other DSH plugin logs. */
export const DEFAULT_LOG_FILE = path.join(os.homedir(), '.dsh', 'logs', 'archived-open.log')

/** Longest field accepted from the browser, so one bad frame cannot bloat the log. */
const FIELD_MAX = 300

/**
 * Register the trace route.
 * @param ctx - host context.
 * @param config - plugin config (`debug`, `logFile`).
 */
export function apply(ctx, config = {}) {
  if (config.debug === false) return
  const logFile = typeof config.logFile === 'string' && config.logFile !== '' ? config.logFile : DEFAULT_LOG_FILE

  /**
   * Append one trace line; diagnostics must never break the plugin.
   * @param stage - short stage marker reported by the browser.
   * @param detail - human-readable detail.
   */
  const write = (stage, detail) => {
    try {
      fs.mkdirSync(path.dirname(logFile), { recursive: true })
      fs.appendFileSync(logFile, `${new Date().toISOString()} ${stage} ${detail}\n`)
    } catch {
      /* a diagnostic failure is not a functional failure */
    }
  }

  write('host-apply', logFile)

  const json = (body, status = 200) =>
    new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })

  ctx.effect(
    () =>
      ctx.connection.fetch.register({
        path: TRACE_PATH,
        methods: ['POST'],
        requestBody: 'buffered',
        fetch: async (request) => {
          let body
          try {
            body = await request.json()
          } catch {
            return json({ error: 'bad request' }, 400)
          }
          const stage = typeof body?.stage === 'string' ? body.stage.slice(0, 40) : 'unknown'
          const detail = typeof body?.detail === 'string' ? body.detail.slice(0, FIELD_MAX) : ''
          write(stage, detail)
          return json({ ok: true })
        }
      }),
    'archived-open: trace route'
  )
}
