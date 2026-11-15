import assert from 'node:assert/strict'
import { test } from 'node:test'
import { deviceModel } from '../src/device-model.ts'

test('known hardware model names and variations resolve to their illustrations', () => {
  assert.equal(deviceModel('HyperDeck Extreme 8K HDR'), 'extreme-8k')
  assert.equal(deviceModel('HyperDeck Studio 4K Pro'), 'studio-4k-pro')
  assert.equal(deviceModel('  HyperDeck Studio HD\u00a0Mini  '), 'studio-hd-mini')
  assert.equal(deviceModel('Blackmagic Design HyperDeck Studio HD-Plus'), 'studio-hd-plus')
})

test('unknown models keep a neutral fallback instead of borrowing a model image', () => {
  for (const model of ['', 'Unknown', 'constructor', 'HyperDeck Studio Mini (2017)', 'HyperDeck Shuttle HD']) {
    assert.equal(deviceModel(model), undefined, model)
  }
})
