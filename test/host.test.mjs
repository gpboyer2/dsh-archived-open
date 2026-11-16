/**
 * Host-half check: the trace route registers, writes, and rejects malformed bodies.
 *
 * Run: node --test test/*.test.mjs
 */

import assert from 'node:assert/strict'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import test from 'node:test'

import { apply, TRACE_PATH } from '../lib/index.js'

/**
 * Wire the host half against a recording container.
 * @param {object} [config] - plugin config override.
 * @returns {{route: object, logFile: string}} captured route and log path.
 */
function mount(config) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'archived-open-'))
  const logFile = path.join(dir, 'trace.log')
  let route
  const ctx = {
    effect: (fn) => {
      fn()
    },
    connection: {
      fetch: {
        register: (registered) => {
          route = registered
          return () => {}
        }
      }
    }
  }
  apply(ctx, { logFile, ...config })
  return { route, logFile }
}

test('trace route records a stage line', async () => {
  const { route, logFile } = mount()
  assert.equal(route.path, TRACE_PATH)
  assert.deepEqual(route.methods, ['POST'])

  const response = await route.fetch(
    new Request('http://127.0.0.1/api/archived-open.trace', {
      method: 'POST',
      body: JSON.stringify({ stage: 'hit', detail: 'session-1' })
    })
  )
  assert.equal(response.status, 200)

  const lines = fs.readFileSync(logFile, 'utf8').trim().split('\n')
  assert.equal(lines.length, 2, 'host-apply plus one reported stage')
  assert.match(lines[0], /host-apply/)
  assert.match(lines[1], /hit session-1/)
})

test('malformed body is rejected without writing a line', async () => {
  const { route, logFile } = mount()
  const before = fs.readFileSync(logFile, 'utf8')
  const response = await route.fetch(
    new Request('http://127.0.0.1/api/archived-open.trace', { method: 'POST', body: 'not json' })
  )
  assert.equal(response.status, 400)
  assert.equal(fs.readFileSync(logFile, 'utf8'), before, 'nothing appended')
})

test('debug: false skips the route entirely', () => {
  let registered = false
  const ctx = {
    effect: (fn) => {
      fn()
    },
    connection: {
      fetch: {
        register: () => {
          registered = true
          return () => {}
        }
      }
    }
  }
  apply(ctx, { debug: false })
  assert.equal(registered, false)
})
