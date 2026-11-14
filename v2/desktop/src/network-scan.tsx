import { useEffect, useRef, useState } from 'react'
import { errorMessage, networkScan, type Identified, type ScanInterface, type ScanProgress } from './contracts'

export function NetworkScan({ onAdd }: { onAdd: (value: Identified) => void }) {
  const [interfaces, setInterfaces] = useState<ScanInterface[]>([])
  const [selected, setSelected] = useState(0)
  const [cidr, setCidr] = useState('')
  const [scan, setScan] = useState<string>()
  const [starting, setStarting] = useState(false)
  const [adding, setAdding] = useState<string>()
  const [added, setAdded] = useState<string[]>([])
  const [progress, setProgress] = useState<ScanProgress>()
  const [error, setError] = useState('')
  const mounted = useRef(false)
  const active = useRef<string>()

  useEffect(() => {
    mounted.current = true
    networkScan.interfaces().then(entries => {
      if (!mounted.current) return
      setInterfaces(entries)
      setCidr(entries[0]?.cidr ?? '')
    }).catch(failure => { if (mounted.current) setError(errorMessage(failure)) })
    return () => {
      mounted.current = false
      if (active.current) void networkScan.cancel(active.current).catch(() => {})
    }
  }, [])

  useEffect(() => {
    if (!scan) return
    let current = true
    let timer: number
    const poll = async () => {
      try {
        const next = await networkScan.progress(scan)
        if (!current) return
        setProgress(next)
        if (next.finished) active.current = undefined
        else timer = window.setTimeout(poll, 250)
      } catch (failure) {
        if (!current) return
        setError(errorMessage(failure))
        void networkScan.cancel(scan).catch(() => {})
        setScan(undefined)
      }
    }
    void poll()
    return () => { current = false; window.clearTimeout(timer) }
  }, [scan])

  const running = starting || Boolean(scan && !progress?.finished)
  async function start() {
    const entry = interfaces[selected]
    if (running || !entry) return
    setError('')
    setStarting(true)
    setProgress(undefined)
    setAdded([])
    try {
      const id = await networkScan.start(entry, cidr)
      if (!mounted.current) { await networkScan.cancel(id); return }
      active.current = id
      setScan(id)
    } catch (failure) {
      if (mounted.current) { setError(errorMessage(failure)); setScan(undefined) }
    } finally {
      if (mounted.current) setStarting(false)
    }
  }

  async function add(address: string) {
    if (!scan || adding) return
    setError('')
    setAdding(address)
    try {
      const value = await networkScan.add(scan, address)
      onAdd(value)
      if (mounted.current) setAdded(previous => [...previous, address])
    } catch (failure) {
      if (mounted.current) setError(errorMessage(failure))
    } finally {
      if (mounted.current) setAdding(undefined)
    }
  }

  return <div className="panel-body stack">
    <label className="field-label">Interface réseau<select disabled={running || !interfaces.length} value={selected}
      onChange={event => {
        const index = Number(event.target.value)
        setSelected(index)
        setCidr(interfaces[index].cidr)
      }}>
      {!interfaces.length && <option>Aucune interface IPv4 privée disponible</option>}
      {interfaces.map((entry, index) => <option key={entry.name + entry.address} value={index}>{entry.name} · {entry.address}</option>)}
    </select></label>
    <label className="field-label">Plage IPv4 (CIDR)<input value={cidr} onChange={event => setCidr(event.target.value)} disabled={running || !interfaces.length} /></label>
    <div className="row">
      <button className="primary" disabled={running || Boolean(adding) || !cidr.trim()} onClick={() => void start()}>Lancer la recherche</button>
      {running && <button disabled={!scan || starting} onClick={() => {
        if (scan) void networkScan.cancel(scan).catch(failure => setError(errorMessage(failure)))
      }}>Annuler la recherche</button>}
    </div>
    {(error || progress?.error) && <div className="callout error" role="alert">{error || progress?.error}</div>}
    {progress && <p role="status">{progress.scanned}/{progress.total} adresses testées · {progress.cancelled ? 'Recherche annulée'
      : progress.finished ? 'Recherche terminée' : 'Recherche en cours'}</p>}
    {progress && Object.keys(progress.rows).length > 0 && <table>
      <thead><tr><th>IP</th><th>Nom</th><th>Modèle</th><th>Statut</th><th aria-label="Action" /></tr></thead>
      <tbody>{Object.values(progress.rows).map(row => <tr key={row.address}>
        <td className="mono">{row.address}</td><td>{row.name ?? '—'}</td><td>{row.model ?? '—'}</td>
        <td>{!row.model ? 'Port ouvert · identité non confirmée' : row.ftp === null ? 'HyperDeck confirmé · vérification FTP'
          : row.ftp ? 'HyperDeck confirmé · FTP disponible' : 'HyperDeck confirmé · FTP indisponible'}</td>
        <td>{row.saved || added.includes(row.address) ? 'Déjà enregistré' : row.model && row.ftp !== null
          ? <button disabled={Boolean(adding)} onClick={() => void add(row.address)}>Ajouter</button> : null}</td>
      </tr>)}</tbody>
    </table>}
  </div>
}
