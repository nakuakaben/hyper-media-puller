import assert from 'node:assert/strict'
import { readFile, readdir } from 'node:fs/promises'

const thumbnails = new URL('../src/device-thumbnails/', import.meta.url)
const photos = new URL('../../../assets/devices/', import.meta.url)
const models = ['extreme-8k', 'studio-4k-pro', 'studio-hd-mini', 'studio-hd-plus']
const read = (folder, name) => readFile(new URL(name, folder))
const originals = await Promise.all(models.map(model => read(thumbnails, model + '.png')))
const restricted = await Promise.all(models.map(model => read(photos, 'hyperdeck-' + model + '.png')))

for (const build of ['dist', 'dist-internal']) {
  const internal = build === 'dist-internal'
  const folder = new URL(`../${build}/assets/`, import.meta.url)
  const names = await readdir(folder)
  const scripts = (await Promise.all(names.filter(name => name.endsWith('.js')).map(name => read(folder, name)))).join('\n')
  const images = await Promise.all(names.filter(name => name.endsWith('.png')).map(async name => ({ name, bytes: await read(folder, name) })))
  assert.equal(images.length, internal ? 8 : 4, build)
  for (const bytes of [...originals, ...(internal ? restricted : [])]) {
    assert.equal(images.filter(image => image.bytes.equals(bytes) && scripts.includes(image.name)).length, 1,
      `Expected one referenced copy of each permitted thumbnail in ${build}`)
  }
  for (const bytes of restricted) {
    assert.ok(!scripts.includes(bytes.toString('base64')), `Unexpected inline historical photo in ${build}`)
  }
  console.log(`${build}: four original illustrations, ${internal ? 'four historical photos' : 'historical photos excluded'}`)
}
