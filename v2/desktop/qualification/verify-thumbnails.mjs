import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

const thumbnails = new URL('../src/device-thumbnails/', import.meta.url)
const photos = new URL('../../../assets/devices/', import.meta.url)
const originals = ['extreme-8k.png', 'studio-4k-pro.png', 'studio-hd-mini.png', 'studio-hd-plus.png']
const encoded = (folder, names) => Promise.all(names.map(name => readFile(new URL(name, folder), 'base64')))
const expected = await encoded(thumbnails, originals)
const restricted = await encoded(photos, (await readdir(photos)).filter(name => /^hyperdeck-.*\.png$/i.test(name)))
assert.equal(restricted.length, 4)
for (const build of ['dist', 'dist-internal']) {
  const folder = new URL(`../${build}/assets/`, import.meta.url)
  const names = await readdir(folder)
  const scripts = (await Promise.all(names.filter(name => name.endsWith('.js')).map(name => readFile(new URL(name, folder), 'utf8')))).join('\n')
  assert.ok(expected.every(image => scripts.includes(image)), `Missing original thumbnails in ${build}`)
  assert.ok(!restricted.some(image => scripts.includes(image)) && !names.some(name => /^hyperdeck-.*\.png$/i.test(name)), `Restricted photo in ${build}`)
  console.log(`${build}: four original thumbnails, historical photos excluded`)
}
