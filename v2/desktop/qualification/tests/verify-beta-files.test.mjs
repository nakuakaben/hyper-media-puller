import assert from 'node:assert/strict'
import { spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { appendFile, mkdir, mkdtemp, rename, rm, symlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { test } from 'node:test'
import { fileURLToPath } from 'node:url'

const script = fileURLToPath(new URL('../verify-beta-files.mjs', import.meta.url))
const dmg = 'HMP-V2-0.1.0-beta.1-macos-arm64.dmg'
const nsis = 'HMP-V2-0.1.0-beta.1-windows-x64-setup.exe'
const source = 'notices/source/option-ext-0.2.0.crate'
const react = 'notices/frontend/react/LICENSE'
const contents = 'fixture\n'
const digest = createHash('sha256').update(contents).digest('hex')
const entry = (name, marker = ' ') => `${digest} ${marker}${name}`

async function fixture(t) {
  const temp = await mkdtemp(join(tmpdir(), 'hmp-verify-'))
  t.after(() => rm(temp, { recursive: true, force: true }))
  const root = join(temp, 'remise')
  const manifest = join(root, 'SHA256SUMS.txt')
  const sources = [source, 'notices/source/nsis-3.13-src.tar.bz2', 'notices/source/nsis-tauri-utils-0.5.3.tar.gz']
  const files = [
    dmg, nsis, ...sources,
    'notices/README.md',
    'notices/BETA_RUST_LICENSE_INVENTORY.tsv',
    'notices/project/HMP-MIT.txt',
    'notices/project/Inter-OFL.txt',
    'notices/project/Lucide-LICENSE.txt',
    'notices/project/Resolve-Workflow-Assistant-MIT.txt',
    'notices/frontend/@fontsource-variable/inter/LICENSE',
    'notices/frontend/@tauri-apps/api/LICENSE-APACHE-2.0',
    'notices/frontend/@tauri-apps/api/LICENSE-MIT',
    'notices/frontend/@tauri-apps/api/LICENSE.spdx',
    'notices/frontend/lucide-react/LICENSE',
    react,
    'notices/frontend/react-dom/LICENSE',
    'notices/frontend/scheduler/LICENSE',
    'notices/rust/option-ext-0.2.0/LICENSE.txt',
    'notices/windows-installer/COPYING',
    'notices/windows-installer/Docs-Modern UI 2-License.txt',
    'notices/windows-installer/Docs-NSISdl-License.txt',
    'notices/windows-installer/nsis-tauri-LICENSE_MIT',
    'notices/windows-installer/nsis-tauri-LICENSE_APACHE-2.0',
    'provenance/BUILDS.txt',
    'BETA_RELEASE_NOTES.md',
  ]
  for (const file of files) {
    const path = join(root, file)
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, contents)
  }
  await writeFile(manifest, `${entry(dmg)}\r\n${entry(nsis, '*')}\r\n`)
  await writeFile(join(root, 'provenance/SOURCE-SHA256SUMS.txt'), sources.map(name => entry(name)).join('\n'))
  return { root, temp, manifest }
}

function verify(root, expectedError) {
  const result = spawnSync(process.execPath, [script, root], { encoding: 'utf8', timeout: 5000 })
  assert.ifError(result.error)
  assert.equal(result.status, expectedError ? 1 : 0, result.stderr)
  if (expectedError) assert.match(result.stderr, expectedError)
  else assert.match(result.stdout, /Notices requises/)
}

test('accepte LF, CRLF, le marqueur binaire et la dernière ligne sans saut', async t => {
  verify((await fixture(t)).root)
})

test('détecte un package modifié', async t => {
  const { root } = await fixture(t)
  await appendFile(join(root, dmg), 'altération')
  verify(root, /SHA-256 différent/)
})

test('détecte une notice frontend manquante', async t => {
  const { root } = await fixture(t)
  await rm(join(root, react))
  verify(root, /Fichier manquant : notices\/frontend\/react\/LICENSE/)
})

test('détecte un package manquant et une notice vide', async t => {
  const { root } = await fixture(t)
  await rm(join(root, nsis))
  verify(root, /Fichier manquant : .*setup\.exe/)
  await writeFile(join(root, nsis), contents)
  await writeFile(join(root, react), '')
  verify(root, /Fichier ou dossier invalide/)
})

test('rejette un manifeste mal formé et une entrée obligatoire omise', async t => {
  const { root, manifest } = await fixture(t)
  await writeFile(manifest, `${entry(dmg)}\n1234  ${nsis}\n`)
  verify(root, /ligne 2/)
  await writeFile(manifest, entry(dmg))
  verify(root, /Entrée manquante/)
})

test('rejette les doublons même lorsque la casse diffère', async t => {
  const { root, manifest } = await fixture(t)
  await appendFile(manifest, entry(dmg.toUpperCase()))
  verify(root, /Entrée en double/)
})

test('rejette les chemins non portables, y compris en dernière ligne', async t => {
  const { root, manifest } = await fixture(t)
  for (const path of ['../escape', '/absolute', 'C:/absolute', 'a\\b', 'a//b', 'NUL.txt', 'com1.any', 'a ', ' a']) {
    await writeFile(manifest, `${entry(dmg)}\n${entry(nsis)}\n${entry(path)}\n`)
    verify(root, /Chemin interdit/)
  }
  await writeFile(manifest, `${entry(dmg)}\n${entry(nsis)} \n`)
  verify(root, /Chemin interdit/)
})

test('rejette les liens sur la racine, un fichier, un dossier et un manifeste', async t => {
  const { root, temp, manifest } = await fixture(t)
  const rootLink = join(temp, 'lien')
  await symlink(root, rootLink, 'junction')
  verify(rootLink, /Lien symbolique interdit à la racine/)
  for (const [path, type] of [[join(root, dmg), 'file'], [join(root, 'notices', 'source'), 'junction'], [manifest, 'file']]) {
    const target = path + '.original'
    await rename(path, target)
    try {
      await symlink(target, path, type)
    } catch (error) {
      await rename(target, path)
      if (process.platform === 'win32' && error.code === 'EPERM') {
        t.diagnostic('Lien de fichier non testé : autorisation de création absente sur ce poste.')
        continue
      }
      throw error
    }
    verify(root, /Lien symbolique interdit/)
    await rm(path)
    await rename(target, path)
  }
})
