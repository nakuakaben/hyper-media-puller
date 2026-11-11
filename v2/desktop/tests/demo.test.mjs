import assert from 'node:assert/strict'
import test from 'node:test'
import { advanceDemo, demoDecks, demoJob, formatBytes, initialJobs, listDemo, percent } from '../src/demo.ts'

test('fixtures isolate demo addresses and preserve volumes, Unicode and errors', () => {
  assert.ok(demoDecks.every(deck => deck.recorder.host.startsWith('192.0.2.')))
  assert.deepEqual(listDemo('mini', '/').map(item => item.remote_path), ['/1', '/2'])
  assert.deepEqual(listDemo('mini', '/2'), [])
  assert.ok(listDemo('mini', '/1').some(item => item.remote_path.includes('Équipe_東京')))
  assert.throws(() => listDemo('plus', '/'), /550/)
  assert.throws(() => listDemo('legacy', '/'), /hors ligne/)
})

test('progress keeps u64 byte counts precise and unknown size indeterminate', () => {
  assert.equal(percent('9223372036854775808', '18446744073709551615'), 50)
  assert.equal(percent('0', null), null)
  assert.equal(formatBytes('5368709120'), '5 Gio')
  assert.equal(formatBytes(null), '—')
})

test('demo actions respect recorder slots and never issue a verified result', () => {
  const another = demoJob(listDemo('pro', '/1')[0], 'extra')
  const queue = [...initialJobs, another]
  const first = advanceDemo(queue, 3)
  assert.equal(first[2].status, 'pending')
  assert.equal(first.at(-1).status, 'pending')
  const result = Array.from({ length: 15 }).reduce(jobs => advanceDemo(jobs, 2), queue)
  assert.deepEqual(result.map(job => job.status), ['done', 'done', 'done', 'error', 'done'])
  assert.equal(initialJobs[0].status, 'running')
})
