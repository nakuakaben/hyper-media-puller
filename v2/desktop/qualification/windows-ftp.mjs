import { createServer } from 'node:net'
import { networkInterfaces } from 'node:os'
import { setTimeout as delay } from 'node:timers/promises'

export const files = {
  'clip principal.mov': Buffer.alloc(1024 * 1024, 0x31),
  [`${'plan-long-'.repeat(19)}.mov`]: Buffer.alloc(524288, 0x56),
  'annulation.mov': Buffer.alloc(8 * 1024 * 1024, 0x62),
  'reessai.mov': Buffer.alloc(2 * 1024 * 1024, 0x73),
  'fermeture.mov': Buffer.alloc(8 * 1024 * 1024, 0x64),
}

function localAddress() {
  const addresses = Object.values(networkInterfaces()).flat()
  return addresses.find(address => address?.family === 'IPv4' && !address.internal
    && /^(10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(address.address))?.address
}

function listen(server, host, port = 0) {
  return new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => {
      server.removeListener('error', reject)
      resolve(server.address().port)
    })
  })
}

function lines(socket, onLine) {
  let buffer = ''
  socket.setEncoding('utf8')
  socket.on('error', () => {})
  socket.on('data', data => {
    buffer += data
    let newline
    while ((newline = buffer.indexOf('\r\n')) !== -1) {
      const line = buffer.slice(0, newline)
      buffer = buffer.slice(newline + 2)
      onLine(line)
    }
  })
}

export async function startFixture() {
  const host = localAddress()
  if (!host) throw new Error('No private IPv4 interface for the Windows FTP fixture')
  const servers = new Set()
  const sockets = new Set()
  const commands = []
  const errors = []
  let dropCount = 0

  function server(handler) {
    const instance = createServer(socket => {
      if (socket.remoteAddress !== host) {
        socket.destroy()
        return
      }
      sockets.add(socket)
      socket.on('error', () => {})
      socket.once('close', () => sockets.delete(socket))
      handler(socket)
    })
    servers.add(instance)
    return instance
  }
  function close() {
    for (const socket of sockets) socket.destroy()
    for (const instance of servers) instance.close()
  }

  const control = server(socket => {
    socket.write('500 connection:\r\nprotocol version: 1.8\r\n\r\n')
    lines(socket, line => {
      commands.push(line)
      if (line !== 'device info') { errors.push('Unexpected HyperDeck command'); socket.destroy(); return }
      socket.end('204 device info:\r\nmodel: HyperDeck Studio HD Plus\r\nprotocol version: 1.8\r\nunique id: hmp-windows-qa\r\n\r\n')
    })
  })
  const ftp = server(socket => {
    socket.write('220 HMP Windows fixture\r\n')
    let passive
    let acceptData
    let pending = Promise.resolve()
    socket.once('close', () => passive?.close())
    lines(socket, line => {
      pending = pending.then(async () => {
        const [verb] = line.split(' ')
        commands.push(verb === 'PASS' ? 'PASS' : line)
        switch (verb) {
          case 'USER': socket.write('331 Password\r\n'); break
          case 'PASS': socket.write('230 Logged in\r\n'); break
          case 'OPTS':
          case 'STRU': socket.write('502 Optional\r\n'); break
          case 'TYPE': socket.write('200 Binary\r\n'); break
          case 'EPSV': {
            passive?.close()
            let accepted
            acceptData = new Promise(resolve => { accepted = resolve })
            passive = server(accepted)
            const port = await listen(passive, host)
            socket.write(`229 (|||${port}|)\r\n`)
            break
          }
          case 'LIST':
          case 'RETR': {
            const data = await Promise.race([acceptData, delay(5000).then(() => { throw new Error('Passive connection timed out') })])
            passive.close()
            socket.write('150 Opening data\r\n')
            if (verb === 'LIST') {
              const path = line.split(' ').at(-1)
              const listing = path === '/'
                ? 'drwxr-xr-x 1 owner group 0 Jan 01 2026 sd2\r\n'
                : Object.entries(files).map(([name, bytes]) => `-rw-r--r-- 1 owner group ${bytes.length} Jan 01 2026 ${name}\r\n`).join('')
              await new Promise(resolve => data.end(listing, resolve))
            } else {
              const name = line.slice('RETR /sd2/'.length)
              const payload = files[name]
              if (!payload) throw new Error('Unexpected RETR path')
              if (name === 'reessai.mov' && dropCount++ === 0) {
                await new Promise(resolve => data.end(payload.subarray(0, 65536), resolve))
                socket.destroy()
                break
              }
              for (let at = 0; at < payload.length && !data.destroyed; at += 65536) {
                await new Promise(resolve => data.write(payload.subarray(at, at + 65536), resolve))
                if (name === 'annulation.mov' || name === 'fermeture.mov') await delay(45)
              }
              if (data.destroyed) break
              await new Promise(resolve => data.end(resolve))
            }
            if (!socket.destroyed) socket.write('226 Complete\r\n')
            break
          }
          case 'QUIT': socket.end('221 Bye\r\n'); break
          default: throw new Error(`Unexpected FTP verb ${verb}`)
        }
      }).catch(error => { errors.push(error.message); socket.destroy() })
    })
  })

  try {
    await listen(control, host, 9993)
    await listen(ftp, host, 21)
    return { host, close, commands, errors }
  } catch (error) {
    close()
    throw error
  }
}
