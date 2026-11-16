/**
 * Offline behavioural check for the client half, with a tiny DOM/container mock.
 *
 * Run: node test/client.test.mjs
 */

import assert from 'node:assert/strict'

/** Minimal `Element` stand-in so the interceptor's instanceof check passes. */
class FakeElement {
  /** @param {(selector: string) => unknown} closestImpl */
  constructor(closestImpl) {
    this.closest = closestImpl
  }
}

const handlers = []
const documentMock = {
  addEventListener: (type, handler, capture) => {
    handlers.push({ type, handler, capture })
  },
  removeEventListener: (type, handler) => {
    const index = handlers.findIndex((entry) => entry.type === type && entry.handler === handler)
    if (index >= 0) handlers.splice(index, 1)
  }
}
globalThis.document = documentMock
globalThis.Element = FakeElement

/** Trace endpoint stub: the client half posts diagnostics, which the test ignores. */
const traces = []
globalThis.fetch = async (url, init) => {
  traces.push({ url, body: init?.body })
  return { ok: true, status: 200 }
}

let plugin
globalThis.__ModuleLoader__ = {
  load: ({ factory }) => {
    plugin = factory()
  }
}

await import('../lib/client.js')

assert.ok(plugin !== undefined, 'client bundle registered a plugin')
assert.deepEqual(plugin.inject, ['uiWorkspace', 'workspaces'])

/** Archive set the mocked workspace snapshot reports. */
let archived = []
const calls = []
const uiWorkspace = {
  unarchiveSession: async (id) => {
    calls.push(`unarchive:${id}`)
    archived = archived.filter((entry) => entry !== id)
  },
  openSession: (id) => {
    calls.push(`open:${id}`)
  }
}
const workspaces = {
  list: { getSnapshot: () => ({ archivedSessionIds: archived }) }
}
const cleanups = []
const ctx = {
  get: (name) => (name === 'uiWorkspace' ? uiWorkspace : name === 'workspaces' ? workspaces : undefined),
  effect: (fn) => {
    const cleanup = fn()
    if (typeof cleanup === 'function') cleanups.push(cleanup)
  },
  logger: { warn: () => {} }
}

plugin.apply(ctx)

assert.equal(handlers.length, 1, 'one capture-phase click listener installed')
assert.equal(handlers[0].capture, true, 'listener runs in the capture phase')

/**
 * Dispatch a synthetic click through the installed capture listener.
 * @param {object} options - row key, and which control the target sits inside.
 * @returns the event the interceptor saw.
 */
function click({ rowKey, insideControl = false, sessionId = 'session-1' }) {
  const row = { getAttribute: (name) => (name === 'data-row-key' ? rowKey ?? `session:${sessionId}` : null) }
  const target = new FakeElement((selector) => {
    if (selector.includes('button')) return insideControl ? {} : null
    if (selector.startsWith('[data-row-key^="session:"]')) return rowKey === undefined ? row : rowKey === '' ? null : row
    return null
  })
  const event = {
    target,
    button: 0,
    defaultPrevented: false,
    preventDefault() {
      this.defaultPrevented = true
    },
    stopped: false,
    stopPropagation() {
      this.stopped = true
    }
  }
  handlers[0].handler(event)
  return event
}

// 1. Archived row: intercepted, unarchived, then opened.
archived = ['session-1']
const first = click({ sessionId: 'session-1' })
assert.equal(first.defaultPrevented, true, 'archived row click is intercepted')
assert.equal(first.stopped, true, 'propagation stops before the host guard')
await new Promise((resolve) => setTimeout(resolve, 10))
assert.deepEqual(calls, ['unarchive:session-1', 'open:session-1'], 'unarchive precedes open')

// 2. Clicks inside the row controls keep native behaviour.
calls.length = 0
archived = ['session-1']
const inControl = click({ sessionId: 'session-1', insideControl: true })
assert.equal(inControl.defaultPrevented, false, 'row controls are left alone')
assert.deepEqual(calls, [], 'no restore for control clicks')

// 3. Non-archived rows are untouched.
archived = []
calls.length = 0
const plain = click({ sessionId: 'session-2' })
assert.equal(plain.defaultPrevented, false, 'live session rows are untouched')
assert.deepEqual(calls, [], 'no restore for live rows')

// 4. Double click while the restore is in flight does not fire twice.
archived = ['session-3']
let releaseRestore
uiWorkspace.unarchiveSession = async (id) => {
  calls.push(`unarchive:${id}`)
  await new Promise((resolve) => {
    releaseRestore = resolve
  })
  archived = []
}
calls.length = 0
const a = click({ sessionId: 'session-3' })
const b = click({ sessionId: 'session-3' })
assert.equal(a.defaultPrevented, true)
assert.equal(b.defaultPrevented, false, 'second click during restore is ignored')
releaseRestore()
await new Promise((resolve) => setTimeout(resolve, 10))
assert.deepEqual(calls, ['unarchive:session-3', 'open:session-3'], 'one restore, one open')

for (const cleanup of cleanups) cleanup()
assert.equal(handlers.length, 0, 'listener removed when the plugin unloads')

console.log('client.test.mjs: all assertions passed')
