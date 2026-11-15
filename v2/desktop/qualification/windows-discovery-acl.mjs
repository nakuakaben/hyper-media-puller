import assert from 'node:assert/strict'
import { setTimeout as delay } from 'node:timers/promises'

const port = Number(process.argv[2])
assert.ok(port > 0 && port <= 65535)
const ready = "Boolean(window.isTauri && document.querySelector('.recorder-list'))"
const deadline = Date.now() + 12000
let socket
while (!socket && Date.now() < deadline) {
  try {
    const response = await fetch(`http://127.0.0.1:${port}/json/list`, { signal: AbortSignal.timeout(500) })
    const targets = await response.json()
    const page = targets.find(target => target.type === 'page' && target.url.startsWith('http://tauri.localhost'))
    if (page) socket = new WebSocket(page.webSocketDebuggerUrl)
  } catch {
    // WebView2 may still be starting.
  }
  if (!socket) await delay(150)
}
assert.ok(socket, 'Installed WebView2 target not found')
try {
  await new Promise((resolve, reject) => {
    socket.addEventListener('open', resolve, { once: true })
    socket.addEventListener('error', reject, { once: true })
  })
  let sequence = 0
  async function evaluate(expression) {
    const id = ++sequence
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        socket.removeEventListener('message', receive)
        reject(new Error('Installed WebView2 did not respond'))
      }, 5000)
      function receive(event) {
        const reply = JSON.parse(event.data)
        if (reply.id !== id) return
        clearTimeout(timer)
        socket.removeEventListener('message', receive)
        if (reply.error || reply.result.exceptionDetails) reject(new Error(JSON.stringify(reply.error ?? reply.result.exceptionDetails)))
        else resolve(reply.result.result.value)
      }
      socket.addEventListener('message', receive)
      socket.send(JSON.stringify({ id, method: 'Runtime.evaluate', params: { expression, awaitPromise: true, returnByValue: true } }))
    })
  }
  const renderDeadline = Date.now() + 8000
  while (!await evaluate(ready)) {
    assert.ok(Date.now() < renderDeadline, 'Installed HMP frontend did not mount')
    await delay(150)
  }
  const result = await evaluate(`(async () => {
    const call = window.__TAURI_INTERNALS__.invoke
    const interfaces = await call('network_interfaces')
    const { name, address } = interfaces[0]
    const id = await call('start_network_scan', { name, address, cidr: 'invalid' })
    const progress = await call('network_scan_progress', { id })
    await call('cancel_network_scan', { id })
    try {
      await call('add_network_recorder', { id, address })
    } catch (error) {
      return { progress: typeof progress.finished, error }
    }
  })()`)
  assert.equal(result.progress, 'boolean')
  assert.equal(result.error.code, 'invalid_input')
  assert.equal(result.error.message, 'HyperDeck à confirmer')
  console.log('All five discovery IPC commands authorized in the installed frontend')
} finally {
  socket.close()
}
