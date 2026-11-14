import assert from 'node:assert/strict'
import { spawn, execFile } from 'node:child_process'
import { createHash } from 'node:crypto'
import { mkdir, mkdtemp, readFile, readdir, rename, rm, writeFile } from 'node:fs/promises'
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
const internal = process.argv.includes('--internal')
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

function embeddedWebView(root) {
  let sequence = 0
  return {
    async send(method, params = {}) {
      const id = ++sequence
      const request = join(root, 'request.tmp')
      const response = join(root, `response-${id}.json`)
      await writeFile(request, JSON.stringify({ id, method, params }))
      await rename(request, join(root, 'request.json'))
      const result = await waitFor(method, async () => {
        try { return JSON.parse(await readFile(response, 'utf8')) }
        catch (error) { if (error.code !== 'ENOENT') throw error }
      }, 12000)
      await rm(response)
      if (result.error) throw new Error(method + ': ' + result.error)
      return result.result
    },
  }
}

const root = await mkdtemp(join(tmpdir(), 'hmp-win-qa-'))
const destination = join(root, 'Régie extérieure ' + 'session '.repeat(9).trimEnd())
await mkdir(destination)
await mkdir(join(root, 'profile'))
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
  assert.ok(process.env.HMP_WEBVIEW2_RUNTIME, 'WebView2 Runtime discovery did not run')
  const launch = () => spawn(executable, [], {
    env: {
      ...process.env,
      WEBVIEW2_USER_DATA_FOLDER: join(root, 'webview'),
      WEBVIEW2_BROWSER_EXECUTABLE_FOLDER: process.env.HMP_WEBVIEW2_RUNTIME,
      HMP_WINDOWS_QUALIFICATION: root,
      HMP_WINDOWS_QUALIFICATION_DESTINATION: destination,
    },
    windowsHide: false,
  })
  app = launch()
  app.stdout.on('data', chunk => stdout.push(String(chunk)))
  app.stderr.on('data', chunk => stdout.push(String(chunk)))
  app.on('error', error => stdout.push(String(error)))
  browser = embeddedWebView(root)
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
  async function click(expression, button = 'left') {
    const point = await waitFor('actionable control: ' + expression, () => evaluate(`(() => {
      const node = ${expression};
      if (!node || node.disabled || !node.getClientRects().length) return null;
      node.scrollIntoView({ block: 'nearest', inline: 'nearest' });
      const r = node.getBoundingClientRect();
      const x = r.x + r.width / 2;
      const y = r.y + r.height / 2;
      return node.contains(document.elementFromPoint(x, y)) ? { x, y } : null;
    })()`))
    await send('Input.dispatchMouseEvent', { ...point, type: 'mousePressed', button, clickCount: 1 })
    await send('Input.dispatchMouseEvent', { ...point, type: 'mouseReleased', button, clickCount: 1 })
  }
  async function press(key, virtualKey) {
    for (const type of ['rawKeyDown', 'keyUp']) {
      await send('Input.dispatchKeyEvent', { type, key: key === 'Space' ? ' ' : key, code: key, windowsVirtualKeyCode: virtualKey, nativeVirtualKeyCode: virtualKey })
    }
  }
  async function expectBreadcrumb(name) {
    await dom(`document.querySelector('.app-name > span')?.textContent === 'HMP' &&
      document.querySelector('.app-name > h1')?.textContent === ${JSON.stringify(name)}`)
    assert.equal(await evaluate("document.querySelector('.status-bar > span:last-child').textContent"), 'V2 bêta 0.1.0-beta.1')
  }
  async function navigate(name) {
    await click(`[...document.querySelectorAll('nav button')].find(b => b.textContent.trim() === ${JSON.stringify(name)})`)
    await expectBreadcrumb(name)
  }
  async function native(action, folderPath) {
    const args = ['-NoProfile', '-NonInteractive', '-Sta', '-ExecutionPolicy', 'Bypass', '-File', windowHelper, '-AppProcess', String(app.pid), '-Action', action]
    if (folderPath) args.push('-FolderPath', folderPath)
    const result = await execute('powershell.exe', args, { timeout: 26000, windowsHide: true })
    return result.stdout.trim()
  }
  async function shot(name) {
    if (internal) return
    await send('Page.enable')
    const { data } = await send('Page.captureScreenshot', { format: 'png' })
    const png = Buffer.from(data, 'base64')
    assert.ok(png.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) && png.length > 8000)
    await writeFile(join(artifacts, name + '.png'), png)
    report.screenshots.push({ name, width: png.readUInt32BE(16), height: png.readUInt32BE(20) })
  }

  await dom(bodyContains('Mode réel'))
  await expectBreadcrumb('Médias')
  await click(button('Ouvrir la démonstration'))
  await dom(`(() => {
    const illustrations = [...document.querySelectorAll('.device-icon img')];
    return illustrations.length === 4 && new Set(illustrations.map(img => img.src)).size === 4
      && illustrations.every(img => img.complete && img.naturalWidth > 0)
      && document.querySelectorAll('.device-icon svg').length === 1;
  })()`)
  await shot('00-vignettes-standard')
  await click(button('Quitter la démonstration'))
  await dom(bodyContains('Mode réel'))
  note(internal ? 'Four internal photos and generic fallback' : 'Four original standard thumbnails and generic fallback')
  const agent = await evaluate('navigator.userAgent')
  report.webview2 = { runtime: process.env.HMP_WEBVIEW2_VERSION, agent }
  assert.match(agent, /Chrome\//)
  note('Windows x64 executable running in its embedded WebView2', report.webview2.runtime)
  report.appearance = await evaluate(`(() => {
    const root = getComputedStyle(document.documentElement)
    return {
      background: root.getPropertyValue('--ui-bg').trim(),
      panel: root.getPropertyValue('--ui-panel').trim(),
      border: root.getPropertyValue('--ui-border').trim(),
      selection: root.getPropertyValue('--ui-selection').trim(),
      navigation: document.querySelector('.bottom-nav').getBoundingClientRect().height,
      status: document.querySelector('.status-bar').getBoundingClientRect().height,
      font: root.fontFamily,
    }
  })()`)
  const { font, ...tokens } = report.appearance
  assert.match(font, /Inter Variable/)
  assert.deepEqual(tokens, { background: '#09090b', panel: '#18181b', border: '#27272a', selection: '#1177d7', navigation: 44, status: 28 })
  note('RWA 0.8.1 palette, typography and bars match the native renderer')
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

  const recorder = element('.recorder-list .recorder')
  const recorderHas = text => `${recorder}?.innerText.includes(${JSON.stringify(text)})`
  await click(recorder, 'right')
  await dom(bodyContains('Vérifier la connexion'))
  await shot('05-menu-enregistreur')
  await click(button('Renommer'))
  await click(element('dialog input'))
  await evaluate("document.querySelector('dialog input').select()")
  await send('Input.insertText', { text: 'Régie A' })
  await click(button('Enregistrer le nom'))
  await dom(recorderHas('Régie A'))
  await shot('06-enregistreur-renomme')
  note('Native context menu renames the saved recorder')

  const keyboard = element('.system-toggle input')
  await evaluate(`${keyboard}.focus()`)
  await press('Tab', 9)
  assert.equal(await evaluate("document.activeElement.getAttribute('aria-label')"), 'Sélectionner tous les fichiers')
  await press('Space', 32)
  await dom(`document.querySelectorAll('.media-table tbody input:checked').length === ${Object.keys(files).length}`)
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
  note('Windows native folder picker', await native('folder'))
  await dom(bodyContains('Régie extérieure'))
  const displayedPath = await evaluate("document.querySelector('.destination-path').textContent")
  assert.match(displayedPath, /^[a-z]:\\/i)
  assert.ok(displayedPath.includes('Régie extérieure'))
  note('Windows destination shown as a readable drive path')
  async function selectFolder(path) {
    await click(button('Choisir un dossier'))
    await native('folder', path)
  }
  const selectedPathIs = path => `document.querySelector('.destination-path').textContent.toLowerCase() === ${JSON.stringify(path.toLowerCase())}`
  for (const volume of (process.env.HMP_QA_NTFS_VOLUMES ?? '').split(';').filter(Boolean)) {
    const folder = join(volume, 'HMP Régie test')
    await mkdir(folder)
    await selectFolder(folder)
    await dom(selectedPathIs(folder))
    const preferences = JSON.parse(await readFile(join(root, 'profile', 'offload-settings-v1.json'), 'utf8'))
    assert.ok(preferences.destination.toLowerCase().endsWith(folder.toLowerCase()))
    note('Native picker accepted an additional NTFS drive', folder)
  }
  if (process.env.HMP_QA_EXFAT_VOLUME) {
    const previous = await evaluate("document.querySelector('.destination-path').textContent")
    await selectFolder(process.env.HMP_QA_EXFAT_VOLUME)
    await dom(bodyContains('Ce volume ne permet pas la publication sans écrasement par lien physique'))
    await dom(selectedPathIs(previous))
    note('Native picker reports an incompatible volume and preserves the selected destination', process.env.HMP_QA_EXFAT_VOLUME)
  }
  if (process.env.HMP_QA_NTFS_VOLUMES || process.env.HMP_QA_EXFAT_VOLUME) {
    await selectFolder(destination)
    await dom(selectedPathIs(destination))
  }
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
  await navigate('Transferts')
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
  await evaluate("Array.from(document.querySelectorAll('h2')).find(h => h.textContent === 'Configuration matérielle').scrollIntoView()")
  await shot('07-configuration-materielle')

  async function addAndStart(name) {
    await navigate('Médias')
    await media(name)
    await showOptions()
    await click(button('Ajouter à la file'))
    await click(button('Démarrer / reprendre le lot'))
  }
  const row = name => `[...document.querySelectorAll('.queue-table tbody tr')].find(row => row.innerText.includes(${JSON.stringify(name)}))`
  const original = Buffer.alloc(files[first].length, 0x7a)
  await writeFile(join(destination, first), original)
  await addAndStart(first)
  await waitFor('collision copy is published under a new name', async () =>
    (await readdir(destination)).includes('clip principal_copy_1.mov'))
  assert.deepEqual(await readFile(join(destination, first)), original)
  assert.deepEqual(await readFile(join(destination, 'clip principal_copy_1.mov')), files[first])
  note('Same-size collision preserves the original and publishes a verified copy')
  await addAndStart('annulation.mov')
  await waitFor('FTP data sent for annulation.mov', () => fixture.activeSlowCopies.has('annulation.mov'))
  await dom(`${row('annulation.mov')}?.innerText.includes('Copie')`)
  // Live rate and ETA rows can move this button between pointer events.
  const cancel = button('Annuler')
  await dom(`(() => {
    const control = ${cancel};
    if (control?.closest('section')?.querySelector('h3')?.textContent !== 'annulation.mov') return false;
    control.focus();
    return document.activeElement === control;
  })()`)
  await press('Space', 32)
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

  await addAndStart('fermeture.mov')
  await waitFor('FTP data sent for fermeture.mov', () => fixture.activeSlowCopies.has('fermeture.mov'))
  await dom(`${row('fermeture.mov')}?.innerText.includes('Copie')`)
  note('Native close requested during an active transfer', await native('close'))
  await waitFor('application exits after orderly shutdown', () => app.exitCode !== null)
  assert.equal(app.exitCode, 0)
  assert.ok(!(await readdir(destination)).includes('fermeture.mov'))
  note('Application exited without publishing the cancelled file')

  fixture.setOnline(false)
  app = launch()
  await dom(recorderHas('Régie A'))
  await dom(recorderHas('Hors ligne'))
  assert.equal(await evaluate("document.querySelectorAll('.recorder-list .recorder').length"), 1)
  await shot('08-enregistreur-hors-ligne')
  fixture.setOnline(true)
  // Allow one full production polling interval plus the network probe.
  await waitFor('automatic reconnection after the 30-second probe interval', () => evaluate(recorderHas('En ligne')), 42000)
  await click(recorder, 'right')
  await click(button('Vérifier la connexion'))
  await dom(recorderHas('En ligne'))
  await click(element(connect))
  await click(element('dialog input'))
  await send('Input.insertText', { text: fixture.host })
  await click(button('Identifier'))
  await dom("!document.querySelector('dialog[open]')")
  await dom(recorderHas('Régie A'))
  assert.equal(await evaluate("document.querySelectorAll('.recorder-list .recorder').length"), 1)
  assert.deepEqual(await readFile(join(destination, first)), original)
  note('Restart restores the custom name, automatic reconnection updates status and rediscovery keeps one entry')
  await click(recorder, 'right')
  await click(button('Supprimer de la configuration'))
  await dom(bodyContains('Les médias et les lots existants sont conservés'))
  await shot('09-confirmer-retrait')
  await click(button('Supprimer l’enregistreur'))
  await dom(bodyContains('Aucun HyperDeck'))
  assert.deepEqual(await readFile(join(destination, first)), original)
  note('Confirmed removal preserves existing media')
  await native('close')
  await waitFor('restarted application exits', () => app.exitCode !== null)
  assert.equal(app.exitCode, 0)
  app = launch()
  await dom(`Boolean(${element(connect)} && !${element(connect)}.disabled)`)
  assert.equal(await evaluate("document.querySelectorAll('.recorder-list .recorder').length"), 0)
  await click(element(connect))
  await click(element('dialog input'))
  await send('Input.insertText', { text: fixture.host })
  await click(button('Identifier'))
  await dom(recorderHas('En ligne'))
  assert.equal(await evaluate("document.querySelectorAll('.recorder-list .recorder').length"), 1)
  note('Removal persists across restart and deliberate identification adds the recorder again')
  await native('close')
  await waitFor('final application exit', () => app.exitCode !== null)
  assert.equal(app.exitCode, 0)
  completed = true
} catch (error) {
  console.error('App exit code:', app?.exitCode, 'PID:', app?.pid)
  if (app?.pid) {
    try {
      const diagnostic = [
        `Get-Process -Id ${app.pid} -ErrorAction SilentlyContinue | Select-Object ProcessName, SessionId, MainWindowTitle | Format-List`,
        `Get-CimInstance Win32_Process -Filter "Name='msedgewebview2.exe'" | Where-Object { $_.CommandLine -like '*hmp-win-qa-*' } | ForEach-Object { [pscustomobject]@{ ProcessId=$_.ProcessId; SessionId=$_.SessionId; DebugFlag=$_.CommandLine -like '*remote-debugging-port=*' } } | Format-Table`,
      ].join('; ')
      const result = await execute('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', diagnostic], { timeout: 12000, windowsHide: true })
      console.log(result.stdout.trim())
      stdout.push(result.stdout.trim())
    } catch (diagnosticError) { console.error(diagnosticError.message) }
  }
  throw error
} finally {
  report.completed = completed
  if (!completed && browser && !internal) {
    try {
      const { data } = await browser.send('Page.captureScreenshot', { format: 'png' })
      await writeFile(join(artifacts, 'failure.png'), Buffer.from(data, 'base64'))
    } catch {}
  }
  if (app?.exitCode === null) app.kill()
  fixture?.close()
  await writeFile(join(artifacts, 'evidence.json'), JSON.stringify(report, null, 2) + '\n')
  await writeFile(join(artifacts, 'fixture.log'), [...fixture?.commands ?? [], ...fixture?.errors ?? [], ...stdout].join('\n'))
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 250 })
}
