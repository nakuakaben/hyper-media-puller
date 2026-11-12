import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises'
import { createServer } from 'node:net'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { promisify } from 'node:util'
import { setTimeout as delay } from 'node:timers/promises'
import { fileURLToPath } from 'node:url'
import { files, startFixture } from './windows-ftp.mjs'

const execute = promisify(execFile)
const windowHelper = fileURLToPath(new URL('./windows-window.ps1', import.meta.url))
const artifacts = resolve(process.argv[3] ?? 'windows-qualification')
const executable = resolve(process.argv[2] ?? 'src-tauri/target/debug/hmp-v2-preview.exe')
assert.equal(process.platform, 'win32', 'Native Windows required')
assert.equal(process.arch, 'x64', 'Native x64 test runner required')
assert.equal(process.env.GITHUB_ACTIONS, 'true', 'Use an isolated Windows CI profile')
const image = await readFile(executable)
assert.equal(image.readUInt16LE(image.readUInt32LE(0x3c) + 4), 0x8664)
await mkdir(artifacts, { recursive: true })

async function waitFor(description, operation, timeout = 20000) {
  const start = Date.now()
  let failure
  do {
    try {
      const value = await operation()
      if (value) return value
    } catch (error) { failure = error }
    await delay(120)
  } while (Date.now() - start < timeout)
  throw new Error('Timed out: ' + description, { cause: failure })
}

async function debuggingPort() {
  const server = createServer()
  await new Promise((ok, fail) => {
    server.once('error', fail)
    server.listen(0, '127.0.0.1', ok)
  })
  const port = server.address().port
  await new Promise(ok => server.close(ok))
  return port
}

async function cdp(url) {
  const socket = new WebSocket(url)
  await new Promise((ok, fail) => {
    socket.addEventListener('open', ok, { once: true })
    socket.addEventListener('error', fail, { once: true })
  })
  let id = 0
  const calls = new Map()
  socket.addEventListener('message', ({ data }) => {
    const message = JSON.parse(data)
    const call = calls.get(message.id)
    if (!call) return
    calls.delete(message.id)
    clearTimeout(call.timer)
    if (message.error) call.reject(new Error(message.error.message))
    else call.resolve(message.result)
  })
  return {
    send(method, params = {}) {
      return new Promise((resolve, reject) => {
        const callId = ++id
        const timer = setTimeout(() => {
          calls.delete(callId)
          reject(new Error('CDP timeout: ' + method))
        }, 8000)
        calls.set(callId, { resolve, reject, timer })
        socket.send(JSON.stringify({ id: callId, method, params }))
      })
    },
    close: () => socket.close(),
  }
}

const root = await mkdtemp(join(tmpdir(), 'hmp-win-qa-'))
const destination = join(root, 'Régie extérieure ' + 'session '.repeat(9).trimEnd())
await mkdir(destination)
const report = { schema_version: 1, architecture: process.arch, scenarios: [], screenshots: [] }
const note = (name, detail = true) => {
  report.scenarios.push({ name, detail })
  console.log('PASS', name, detail === true ? '' : detail)
}
const stdout = []
let fixture, app, browser
let completed = false
try {
  fixture = await startFixture()
  const port = await debuggingPort()
  app = spawn(executable, [], {
    env: {
      ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: join(root, 'webview'),
      WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS: `--remote-debugging-address=127.0.0.1 --remote-debugging-port=${port}`,
    },
    windowsHide: false,
  })
  app.stdout.on('data', chunk => stdout.push(String(chunk)))
  app.stderr.on('data', chunk => stdout.push(String(chunk)))
  app.on('error', error => stdout.push(String(error)))
  const endpoint = `http://127.0.0.1:${port}`
  const version = await waitFor('WebView2 DevTools', async () => {
    const response = await fetch(endpoint + '/json/version', { signal: AbortSignal.timeout(1500) })
    return response.ok && response.json()
  }, 40000)
  const target = await waitFor('embedded HMP WebView2 target', async () => {
    const targets = await (await fetch(endpoint + '/json/list', { signal: AbortSignal.timeout(1500) })).json()
    return targets.find(item => item.type === 'page' && item.url.includes('tauri.localhost') && item.webSocketDebuggerUrl)
  })
  browser = await cdp(target.webSocketDebuggerUrl)
  const send = browser.send
  const evaluate = async expression => {
    const result = await send('Runtime.evaluate', { expression, returnByValue: true })
    if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description ?? result.exceptionDetails.text)
    return result.result.value
  }
  const dom = description => waitFor(description, () => evaluate(description))
  const bodyContains = text => `document.body.innerText.includes(${JSON.stringify(text)})`
  const button = text => `[...document.querySelectorAll('button')].find(b => b.textContent.trim() === ${JSON.stringify(text)} && !b.disabled)`
  const element = selector => `document.querySelector(${JSON.stringify(selector)})`
  async function click(expression) {
    const point = await waitFor('actionable control: ' + expression, () => evaluate(`(() => {
      const node = ${expression};
      if (!node || node.disabled || !node.getClientRects().length) return null;
      node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = node.getBoundingClientRect();
      return {x: r.x + r.width / 2, y: r.y + r.height / 2};
    })()`))
    await send('Input.dispatchMouseEvent', { ...point, type: 'mousePressed', button: 'left', clickCount: 1 })
    await send('Input.dispatchMouseEvent', { ...point, type: 'mouseReleased', button: 'left', clickCount: 1 })
  }
  async function press(key, virtualKey) {
    for (const type of ['rawKeyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', { type, key: key === 'Space' ? ' ' : key, code: key, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey })
    }
  }
  const navigate = name => click(`[...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === ${JSON.stringify(name)})`)
  async function native(action, folder) {
    const args = ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', windowHelper, '-AppProcess', String(app.pid), '-Action', action]
    if (folder) args.push('-Folder', folder)
    const result = await execute('powershell.exe', args, { timeout: 26000, windowsHide: true })
    return result.stdout.trim()
  }
  async function shot(name) {
    await send('Page.enable')
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    const png = Buffer.from(data, 'base64')
    assert.ok(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && png.length > 8000)
    await writeFile(join(artifacts, name + '.png'), png)
    report.screenshots.push({ name, width: png.readUInt32BE(16), height: png.readUInt32BE(20) })
  }

  await dom(bodyContains('Mode réel'))
  const agent = await evaluate('navigator.userAgent')
  report.webview2 = { browser: version.Browser, agent }
  assert.match(agent, /Edg\//)
  note('Windows x64 executable running in its embedded WebView2', version.Browser)
  const originalWidth = await evaluate('innerWidth')
  note('Native window resize', await native('resize'))
  await dom(`innerWidth !== ${originalWidth}`)
  const connect = '[aria-label="Identifier un HyperDeck"]'
  await click(element(connect))
  await click(element('dialog input'))
  await send('Input.insertText', { text: fixture.host })
  await click(button('Identifier'))
  await click(button('sd2'))
  await dom(bodyContains('clip principal.mov'))
  note('HyperDeck identification and FTP navigation through /sd2')

  const keyboard = element('.system-toggle input')
  await evaluate(`${keyboard}.focus()`)
  await press('Tab', 9)
  assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"), 'Sélectionner tous les fichiers')
  await press('Space', 32)
  await dom("document.querySelectorAll('.media-table tbody input:checked').length === 4")
  await press('Space', 32)
  await dom("document.querySelectorAll('.media-table tbody input:checked').length === 0")
  note('Keyboard focus traversal and keyboard media selection')

  async function showOptions() {
    if (await evaluate(`Boolean(${button('Options')})`)) await click(button('Options'))
  }
  async function media(name) {
    await click(`[...document.querySelectorAll('.media-table tbody input')].find(n => n.getAttribute('aria-label') === ${JSON.stringify('Sélectionner ' + name)})`)
  }
  await showOptions()
  assert.ok(await evaluate(bodyContains('Aucun dossier choisi')), 'Fresh destination profile expected')
  await click(button('Choisir un dossier'))
  note('Windows native folder picker', await native('folder', destination))
  await dom(bodyContains('Régie extérieure'))
  const shaOption = "[aria-label='Destination et options'] select"
  await evaluate(`(() => {
    const select = [...document.querySelectorAll(${JSON.stringify(shaOption)})].at(-1);
    select.value = 'sha256';
    select.dispatchEvent(new Event('change', {bubbles:true}));
  })()`)
  await dom(`[...document.querySelectorAll(${JSON.stringify(shaOption)})].at(-1).value === 'sha256'`)
  if (await evaluate("Boolean(document.querySelector('dialog[open]'))")) {
    await press('Escape', 27)
    await dom("!document.querySelector('dialog[open]')")
  }

  const [first, long] = Object.keys(files)
  await media(first)
  await media(long)
  await showOptions()
  await click(button('Ajouter à la file'))
  await click(button('Démarrer / reprendre le lot'))
  await dom("[...document.querySelectorAll('.queue-table tbody tr')].filter(row => row.innerText.includes('Vérifié')).length === 2")
  for (const name of [first, long]) assert.deepEqual(await readFile(join(destination, name)), files[name])
  note('Two verified files match their original bytes on the selected NTFS destination')
  await shot('02-transferts')
  await navigate('Rapports')
  await dom(bodyContains('Flux reçu comparé à sa relecture locale'))
  await shot('03-rapports')
  await click(button('Afficher le JSON'))
  const actualReport = await dom("document.querySelector('textarea[aria-label=\"Rapport JSON\"]')?.value")
  const parsed = JSON.parse(actualReport)
  assert.equal(parsed.schema_version, 1)
  assert.equal(parsed.batch.options.batch.checksum, 'sha256')
  assert.equal(parsed.jobs.length, 2)
  for (const { transfer } of parsed.jobs) {
    const name = transfer.remote_path.split('/').at(-1)
    const payload = files[name]
    assert.equal(transfer.status, 'verified')
    assert.equal(transfer.progress.written, String(payload.length))
    assert.equal(transfer.progress.verified, String(payload.length))
    assert.equal(transfer.checksum.scope, 'transfer_stream_compared_to_local')
    assert.equal(transfer.checksum.sha256, createHash('sha256').update(payload).digest('hex'))
  }
  // Avoid publishing runner-specific paths and network identifiers.
  report.verified = parsed.jobs.map(({ transfer }) => ({
    media: transfer.remote_path, status: transfer.status, progress: transfer.progress, checksum: transfer.checksum,
  }))
  note('Rendered JSON report matches independently calculated SHA-256')
  await navigate('Paramètres')
  await dom(bodyContains('Préférences de transfert'))
  await shot('04-parametres')

  async function addAndStart(name) {
    await navigate('Médias')
    await media(name)
    await showOptions()
    await click(button('Ajouter à la file'))
    await click(button('Démarrer / reprendre le lot'))
  }
  const row = name => `[...document.querySelectorAll('.queue-table tbody tr')].find(row => row.innerText.includes(${JSON.stringify(name)}))`
  await addAndStart('annulation.mov')
  await dom(`${row('annulation.mov')}?.innerText.includes('Copie')`)
  await click(button('Annuler'))
  await dom(`${row('annulation.mov')}?.innerText.includes('Annulé')`)
  assert.ok(!(await readdir(destination)).includes('annulation.mov'))
  note('Cancellation keeps the final name absent')
  await addAndStart('reessai.mov')
  await dom(`${row('reessai.mov')}?.innerText.includes('Erreur')`)
  assert.ok(!(await readdir(destination)).includes('reessai.mov'))
  await click(button('Réessayer'))
  await click(button('Démarrer / reprendre le lot'))
  await dom(`${row('reessai.mov')}?.innerText.includes('Vérifié')`)
  assert.deepEqual(await readFile(join(destination, 'reessai.mov')), files['reessai.mov'])
  note('FTP interruption leaves no final; a new attempt completes and verifies')

  await navigate('Médias')
  await shot('01-medias')
  for (const factor of [1, 1.5, 2]) {
    await send('Emulation.setDeviceMetricsOverride', { width: 1120, height: 710, deviceScaleFactor: factor, mobile: false })
    await dom(`devicePixelRatio === ${factor} && innerWidth === 1120`)
    assert.equal(await evaluate('document.documentElement.scrollWidth'), 1120)
    await shot('medias-webview2-' + factor * 100)
  }
  await send('Emulation.clearDeviceMetricsOverride')
  note('WebView2 rendering at emulated device scale factors 100%, 150%, 200%')
  assert.deepEqual(fixture.errors, [])
  assert.ok(fixture.commands.includes('device info') && fixture.commands.some(command => command.startsWith('RETR /sd2/')))

  await addAndStart('annulation.mov')
  await dom(`${row('annulation.mov')}?.innerText.includes('Copie')`)
  note('Native close requested during an active transfer', await native('close'))
  await waitFor('application exits after orderly shutdown', () => app.exitCode !== null)
  assert.equal(app.exitCode, 0)
  assert.ok(!(await readdir(destination)).includes('annulation.mov'))
  note('Application exited without publishing the cancelled file')
  completed = true
} finally {
  report.completed = completed
  if (!completed && browser) {
    try {
      const { data } = await browser.send('Page.captureScreenshot', { format: 'png' })
      await writeFile(join(artifacts, 'failure.png'), Buffer.from(data, 'base64'))
    } catch {}
  }
  browser?.close()
  if (app?.exitCode === null) app.kill()
  fixture?.close()
  await writeFile(join(artifacts, 'evidence.json'), JSON.stringify(report, null, 2) + '\n')
  await writeFile(join(artifacts, 'fixture.log'), [...fixture?.commands ?? [], ...fixture?.errors ?? [], ...stdout].join('\n'))
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
}
