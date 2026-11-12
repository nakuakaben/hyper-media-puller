import assert from 'node:assert/strict'
import test from 'node:test'
import { isSystemPath, selectableMedia, visibleParent } from '../src/media-visibility.ts'

test('system artefacts are classified without hiding unfamiliar media or real volumes', () => {
  for (const path of ['/sd2/.Spotlight-V100', '/sd2/.FSEVENTSD', '/sd2/System Volume Information', '/sd2/._HyperDeck_0003.mp4', '/sd2/.Trashes/clip.mov']) {
    assert.equal(isSystemPath(path), true, path)
  }
  for (const path of ['/sd2', '/sd2/HyperDeck_0003.mp4', '/sd2/.hidden-take.mov', '/sd2/System Volume Information.mp4']) {
    assert.equal(isSystemPath(path), false, path)
  }
})

test('diagnostic entries never enter select-all or enqueue, and hiding returns to the visible ancestor', () => {
  const paths = ['/sd2/._clip.mov', '/sd2/clip.mov', '/sd2/folder', '/sd2/.fseventsd/nested/clip.mov']
  const items = paths.map(remote_path => ({ remote_path, directory: remote_path.endsWith('/folder') }))
  assert.deepEqual(selectableMedia(items).map(item => item.remote_path), ['/sd2/clip.mov'])
  assert.equal(visibleParent('/sd2/.fseventsd/nested'), '/sd2')
  assert.equal(visibleParent('/.Spotlight-V100'), '/')
  assert.equal(visibleParent('/sd2/takes'), '/sd2/takes')
})
