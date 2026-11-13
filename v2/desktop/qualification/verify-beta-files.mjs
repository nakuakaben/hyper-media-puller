import { createHash } from 'node:crypto'
import { createReadStream } from 'node:fs'
import { lstat, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

const packages = [
  'HMP-V2-0.1.0-beta.1-macos-arm64.dmg',
  'HMP-V2-0.1.0-beta.1-windows-x64-setup.exe',
]
const sources = [
  'notices/source/option-ext-0.2.0.crate',
  'notices/source/nsis-3.13-src.tar.bz2',
  'notices/source/nsis-tauri-utils-0.5.3.tar.gz',
]
const notices = [
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
  'notices/frontend/react/LICENSE',
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

function pathParts(relative) {
  const parts = relative.split('/')
  const windowsDevice = /^(?:con|prn|aux|nul|com[1-9]|lpt[1-9]) *(?:\.|$)/i
  if (parts.some(part => !part || /[^\w @.-]|^[. ]|[. ]$/.test(part) || windowsDevice.test(part))) {
    throw new Error(`Chemin interdit dans le dossier de remise : ${relative}`)
  }
  return parts
}

async function regularFile(root, relative) {
  const parts = pathParts(relative)
  let path = root
  for (const [index, part] of parts.entries()) {
    path = join(path, part)
    const info = await lstat(path).catch(error => {
      if (error.code === 'ENOENT') throw new Error(`Fichier manquant : ${relative}`)
      throw error
    })
    if (info.isSymbolicLink()) throw new Error(`Lien symbolique interdit : ${relative}`)
    if (index < parts.length - 1 ? !info.isDirectory() : !info.isFile() || info.size === 0) {
      throw new Error(`Fichier ou dossier invalide : ${relative}`)
    }
  }
  return path
}

async function verifyManifest(root, manifest, expected) {
  const raw = await readFile(await regularFile(root, manifest), 'utf8')
  const entries = new Map()
  const lines = raw.replace(/\r?\n$/, '').split(/\r?\n/)
  for (const [index, line] of lines.entries()) {
    const match = /^([a-f0-9]{64}) [ *](.+)$/i.exec(line)
    if (!match) throw new Error(`Ligne SHA-256 invalide : ${manifest}, ligne ${index + 1}`)
    const [, hash, name] = match
    pathParts(name)
    const key = name.toLowerCase()
    if (entries.has(key)) throw new Error(`Entrée en double : ${name}`)
    entries.set(key, { hash: hash.toLowerCase(), name })
  }
  for (const name of expected) {
    if (entries.get(name.toLowerCase())?.name !== name) {
      throw new Error(`Entrée manquante dans ${manifest} : ${name}`)
    }
  }
  for (const { name, hash } of entries.values()) {
    const digest = createHash('sha256')
    for await (const chunk of createReadStream(await regularFile(root, name))) digest.update(chunk)
    if (digest.digest('hex') !== hash) throw new Error(`SHA-256 différent : ${name}`)
    console.log(`SHA-256 OK  ${name}`)
  }
}

try {
  if (process.argv.length !== 3) throw new Error('Usage : node verify-beta-files.mjs <dossier-de-remise>')
  const root = resolve(process.argv[2])
  const info = await lstat(root)
  if (info.isSymbolicLink()) throw new Error('Lien symbolique interdit à la racine de la remise.')
  if (!info.isDirectory()) throw new Error('Un dossier de remise est requis.')
  await verifyManifest(root, 'SHA256SUMS.txt', packages)
  await verifyManifest(root, 'provenance/SOURCE-SHA256SUMS.txt', sources)
  for (const notice of notices) await regularFile(root, notice)
  console.log('Notices requises et relevé de fabrication présents.')
} catch (error) {
  console.error(error.message)
  process.exitCode = 1
}
