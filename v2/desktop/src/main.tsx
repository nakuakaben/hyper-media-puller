import { version } from '../package.json'
import { Activity, AppWindow, ChevronRight, Clapperboard, FileCheck2, Folder, Info, ListChecks, Network, Play, Settings2, X } from 'lucide-react'
import { useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource-variable/inter'
import { bridge, errorMessage, offload, type Deck, type Identified, type SavedDeck, type Job, type PreviewInfo, type TransferAction, type TransferOptions as OptionsDto } from './contracts'
import { advanceDemo, demoDecks, demoJob, initialJobs, listDemo, formatBytes } from './demo'
import { isSystemPath, selectableMedia, visibleParent } from './media-visibility'
import { MediaBrowser, Recorders, TransferOptions, type Listing } from './media'
import { defaultPreferences, Options, Settings, type Preferences } from './settings'
import { CompactQueue, Reports, Transfers } from './transfers'
import { RealReports } from './reports'
import { useOffload } from './offload'
import { useEquipment } from './equipment'
import { EquipmentEdit, EquipmentSettings, RecorderMenu } from './equipment-controls'
import { Badge, Empty, Loading, Panel, ProgressCell, Splitter, defaultLayout, layoutStyle, type Layout } from './ui'
import './tokens.css'
import './style.css'

const visibleDemoDecks: Deck[] = import.meta.env.MODE === 'internal' ? [...demoDecks, {
  recorder: { id: 'extreme', name: 'HyperDeck Extreme 8K', host: '192.0.2.25', port: 21 },
  model: 'HyperDeck Extreme 8K',
}] : demoDecks

const pages = [
  { id: 'media', title: 'Médias', icon: Clapperboard },
  { id: 'transfers', title: 'Transferts', icon: ListChecks },
  { id: 'reports', title: 'Rapports', icon: FileCheck2 },
  { id: 'settings', title: 'Paramètres', icon: Settings2 },
] as const
type Page = typeof pages[number]['id']
type Overlay = 'connect' | 'options' | 'components'
const layoutKey = 'hmp-v2.preview.layout'
const idle: Listing = { status: 'idle', items: [] }

function readLayout(): Layout {
  try {
    const saved = JSON.parse(localStorage.getItem(layoutKey) ?? 'null')
    const valid = (value: unknown, min: number, max: number): value is number => typeof value === 'number' && value >= min && value <= max
    if (saved && valid(saved.left, 210, 340) && valid(saved.right, 254, 360) && valid(saved.queue, 128, 340)) return saved
  } catch { /* Use defaults when WebView storage is unavailable. */ }
  return defaultLayout
}

function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  const dialog = useRef<HTMLDialogElement>(null)
  useEffect(() => { dialog.current?.showModal() }, [])
  return <dialog ref={dialog} className={wide ? 'wide' : undefined} aria-labelledby="modal-title" onClose={onClose}>
    <header className="panel-head"><h2 id="modal-title">{title}</h2>
      <button className="icon-button" aria-label="Fermer" onClick={() => dialog.current?.close()}><X size={17} /></button></header>
    {children}
  </dialog>
}

function Connect({ onConnect }: { onConnect: (result: Identified) => void }) {
  const [host, setHost] = useState('')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const mounted = useRef(true)
  useEffect(() => () => { mounted.current = false }, [])
  async function submit(event: FormEvent) {
    event.preventDefault()
    setBusy(true)
    setFailure('')
    try {
      const deck = await bridge.identify(host)
      if (mounted.current) onConnect(deck)
    } catch (error) {
      if (mounted.current) setFailure(errorMessage(error))
    } finally {
      if (mounted.current) setBusy(false)
    }
  }
  return <form className="panel-body stack" onSubmit={submit}>
    <label className="field-label">Adresse IPv4 locale<input autoFocus value={host} onChange={event => setHost(event.target.value)}
      required maxLength={15} spellCheck={false} autoComplete="off" placeholder="192.168.1.20" /></label>
    <p>Utilise TCP 9993 pour identifier l’appareil et FTP anonyme pour lire ses dossiers.</p>
    {failure && <div className="callout error" role="alert">{failure}</div>}
    <button className="primary" disabled={busy || !host.trim()} type="submit"><Network size={15} />{busy ? 'Identification…' : 'Identifier'}</button>
  </form>
}

function ComponentBoard() {
  const [values, setValues] = useState(defaultPreferences)
  return <div className="component-board">
    <Panel title="Contrôles" icon={Settings2}><div className="panel-body stack">
      <div className="row"><button className="primary"><Play size={14} />Action principale</button><button>Secondaire</button><button disabled>Désactivé</button></div>
      <Options values={values} onChange={setValues} />
      <label className="row"><input type="checkbox" defaultChecked />Sélection active</label>
    </div></Panel>
    <Panel title="États et progression" icon={Activity}><div className="panel-body stack">
      <div className="row"><Badge label="En attente" /><Badge label="Copie" tone="info" /><Badge label="Terminé" tone="ok" />
        <Badge label="Démonstration" tone="warn" /><Badge label="Erreur FTP" tone="error" /></div>
      <label className="field-label">Copie<ProgressCell job={initialJobs[0]} phase="copy" /></label>
      <label className="field-label">Vérification<ProgressCell job={initialJobs[1]} phase="verify" /></label>
      <div className="callout error"><strong>FTP 550</strong>Volume indisponible.</div>
    </div></Panel>
    <Panel title="Dossier vide" icon={Folder}><Empty icon={Folder} title="Aucun média dans ce dossier" /></Panel>
    <Panel title="Chargement" icon={Folder}><Loading title="Lecture du dossier FTP…" /></Panel>
  </div>
}

function optionsDto(values: Preferences): OptionsDto {
  return { batch: { duplicate: values.duplicate, checksum: values.checksum },
    global_limit: values.concurrency, recorder_limit: values.recorderLimit }
}

function App() {
  const real = useOffload()
  const hardware = useEquipment()
  const hydrated = useRef(false)
  const [saved, setSaved] = useState(false)
  const [preferredBatch, setPreferredBatch] = useState<string>()
  const [page, setPage] = useState<Page>('media')
  const [demo, setDemo] = useState(false)
  const [info, setInfo] = useState<PreviewInfo>()
  const [bridgeError, setBridgeError] = useState('')
  const [menu, setMenu] = useState<{ deck: SavedDeck; x: number; y: number }>()
  const [hardwareDialog, setHardwareDialog] = useState<{ action: 'rename' | 'remove' | 'verify' | 'reset'; deck?: SavedDeck }>()
  const [liveId, setLiveId] = useState<string>()
  const [demoId, setDemoId] = useState('mini')
  const [path, setPath] = useState('/')
  const [refresh, setRefresh] = useState(0)
  const [result, setResult] = useState<{ key: string; listing: Listing }>()
  const [showSystem, setShowSystem] = useState(false)
  const [selected, setSelected] = useState(new Set<string>())
  const [jobs, setJobs] = useState<Job[]>(initialJobs)
  const [playing, setPlaying] = useState(false)
  const [selectedJob, setSelectedJob] = useState<string>()
  const [layout, setLayout] = useState(readLayout)
  const [viewport, setViewport] = useState({ width: window.innerWidth, height: window.innerHeight })
  const [overlay, setOverlay] = useState<Overlay>()
  const [preferences, setPreferences] = useState<Preferences>(defaultPreferences)
  const [demoPreferences, setDemoPreferences] = useState<Preferences>({ ...defaultPreferences, destination: '/Volumes/Offload/Régie' })
  const demoSequence = useRef(5)
  const compact = viewport.width < 1450
  const leftMax = compact ? 300 : 340
  const reservedHeight = 44 + 28 + 56 + 12 + 5 + 164
  const queueMax = Math.min(340, Math.max(128, viewport.height - reservedHeight))
  const activeLayout = { ...layout, left: Math.min(layout.left, leftMax), queue: Math.min(layout.queue, queueMax) }
  const decks = demo ? visibleDemoDecks : hardware.decks
  const id = demo ? demoId : liveId
  const activeDeck = decks.find(deck => deck.recorder.id === id)
  const connection = !demo && liveId ? hardware.status[liveId] ?? 'checking' : undefined
  const listingKey = JSON.stringify([demo, id, path, refresh, connection])
  let rawListing: Listing = !activeDeck ? idle : result?.key === listingKey ? result.listing : { status: 'loading', items: [] }
  if (activeDeck && !demo && connection !== 'online' && connection !== 'checking') {
    rawListing = { status: 'offline', items: [], message: connection === 'unconfirmed'
      ? 'Identité non confirmée. Vérifiez la connexion dans le menu de l’enregistreur.' : 'Vérifiez la connexion dans le menu de l’enregistreur.' }
  }
  const hiddenCount = showSystem ? 0 : rawListing.items.filter(item => isSystemPath(item.remote_path)).length
  const listing: Listing = hiddenCount
    ? { ...rawListing, items: rawListing.items.filter(item => !isSystemPath(item.remote_path)) }
    : rawListing
  const visibleJobs = demo ? jobs : real.queue?.jobs ?? []
  const names = demo ? Object.fromEntries(decks.map(({ recorder }) => [recorder.id, recorder.name])) : real.queue?.recorders ?? {}
  const chosen = selectableMedia(listing.items).filter(item => selected.has(item.remote_path))
  const bytes = chosen.some(entry => entry.size === null) ? null : String(chosen.reduce((sum, entry) => sum + BigInt(entry.size ?? '0'), 0n))
  const values = demo ? demoPreferences : { ...preferences, destination: real.settings?.destination ?? '' }
  const available = real.settings?.available ? formatBytes(real.settings.available) : undefined
  const realRunning = Boolean(real.queue?.active || real.queue?.batches.some(batch => batch.started))
  function setValues(next: Preferences) {
    if (demo) setDemoPreferences(next)
    else {
      setPreferences(next)
      setSaved(false)
    }
  }

  useEffect(() => {
    if (!hydrated.current && real.settings) {
      const options = real.settings.options
      hydrated.current = true
      setPreferences({ ...options.batch, concurrency: options.global_limit, recorderLimit: options.recorder_limit, destination: '' })
    }
  }, [real.settings])

  useEffect(() => {
    if (bridge.native) bridge.info().then(setInfo).catch(error => setBridgeError(errorMessage(error)))
  }, [])
  useEffect(() => {
    const resize = () => setViewport({ width: window.innerWidth, height: window.innerHeight })
    window.addEventListener('resize', resize)
    return () => window.removeEventListener('resize', resize)
  }, [])
  useEffect(() => {
    try { localStorage.setItem(layoutKey, JSON.stringify(layout)) } catch { /* Layout remains available in memory. */ }
  }, [layout])
  useEffect(() => {
    if (!activeDeck) return
    let current = true
    const update = (listing: Listing) => { if (current) setResult({ key: listingKey, listing }) }
    const receive = (items: Listing['items']) => update({ status: 'ready', items })
    const fail = (error: unknown) => {
      if (!current) return
      const offline = demo ? id === 'legacy'
        : typeof error === 'object' && error !== null && 'phase' in error && error.phase === 'connecting'
          && 'code' in error && ['connection_lost', 'timeout'].includes(String(error.code))
      update({ status: offline ? 'offline' : 'error', items: [], message: errorMessage(error) })
    }
    if (demo) {
      const timer = window.setTimeout(() => {
        try { receive(listDemo(activeDeck.recorder.id, path)) } catch (error) { fail(error) }
      }, 220)
      return () => { window.clearTimeout(timer); current = false }
    }
    if (connection === 'online') bridge.list(activeDeck.recorder.id, path).then(receive).catch(fail)
    return () => { current = false }
  }, [activeDeck, demo, id, path, listingKey, connection])
  useEffect(() => {
    if (!demo || !playing) return
    const interval = window.setInterval(() => setJobs(previous => advanceDemo(previous, demoPreferences.concurrency)), 900)
    return () => window.clearInterval(interval)
  }, [demo, playing, demoPreferences.concurrency])

  function navigate(next: string) {
    setSelected(new Set())
    setPath(next)
    setRefresh(value => value + 1)
  }

  function chooseDeck(next: string) {
    if (demo) setDemoId(next)
    else setLiveId(next)
    navigate('/')
  }

  function toggleDemo() {
    if (!demo && (realRunning || real.busy)) return
    setDemo(!demo)
    setShowSystem(false)
    setPlaying(false)
    if (!demo) setDemoId('mini')
    setSelectedJob(undefined)
    setPreferredBatch(undefined)
    setPage('media')
    navigate(demo ? '/' : '/1')
  }

  function changeSystemVisibility(show: boolean) {
    setShowSystem(show)
    const parent = visibleParent(path)
    if (!show && parent !== path) navigate(parent)
  }

  async function addJobs() {
    if (!chosen.length || !values.destination.trim()) return
    if (!demo) {
      if (!activeDeck) return
      const batch = await real.perform(() => offload.enqueue(activeDeck.recorder.id, chosen.map(item => item.remote_path), optionsDto(values)))
      if (!batch) return
      setSelected(new Set())
      setSelectedJob(undefined)
      setPreferredBatch(batch)
      setOverlay(undefined)
      setPage('transfers')
      return
    }
    const additions = chosen.map(item => demoJob(item, 'demo-' + demoSequence.current++))
    setJobs(previous => [...previous, ...additions])
    setSelected(new Set())
  }

  function changeJob(id: string, retry: boolean) {
    if (!demo) return
    setJobs(previous => previous.map(job => job.id !== id ? job : retry
      ? demoJob({ recorder_id: job.recorder_id, remote_path: job.remote_path, size: job.progress.total, directory: false }, id)
      : { ...job, status: 'cancelled', error: null }))
  }

  async function saveDefaults() {
    const result = await real.perform(() => offload.saveOptions(optionsDto(values)))
    if (result) {
      real.setSettings(result)
      setSaved(true)
    }
  }

  function action(action: TransferAction, id: string) {
    if (!demo) void real.perform(() => offload.action(action, id))
  }

  const transferOptions = <TransferOptions demo={demo} values={values} onChange={setValues}
    count={chosen.length} bytes={bytes} onAdd={addJobs} onChoose={real.choose} available={available} busy={!demo && (real.busy || !bridge.native)} />
  return <div className="app">
    <main className="workspace" id="main-content">
      <header className="workspace-head">
        <div className="app-name"><AppWindow size={18} /><span>HMP</span><ChevronRight size={13} />
          <h1>{pages.find(item => item.id === page)?.title}</h1></div>
        <div className="row"><Badge label={demo ? 'Mode démonstration' : bridge.native ? 'Mode réel' : 'Aperçu navigateur'} tone={demo ? 'warn' : 'neutral'} />
          <button disabled={!demo && (realRunning || real.busy)} onClick={toggleDemo}>{demo ? 'Quitter la démonstration' : 'Ouvrir la démonstration'}</button></div>
      </header>
      {!demo && hardware.error && <div className="callout error bridge-error" role="alert">{hardware.error}</div>}
      {bridgeError && <div className="callout error bridge-error" role="alert">{bridgeError}</div>}
      {!demo && real.connectionError && <div className="callout error bridge-error" role="alert">File en cours de reconnexion · {real.connectionError}</div>}
      {!demo && real.feedback && <div className="callout error bridge-error" role="alert">{real.feedback}</div>}
      {page === 'media' && <div className="media-layout" style={layoutStyle(activeLayout)}>
        <div className={'upper' + (compact ? ' compact' : '')}>
          <Recorders decks={decks} active={id} demo={demo} native={bridge.native} onSelect={chooseDeck} onConnect={() => setOverlay('connect')}
            canConnect={hardware.ready && !hardware.busy} connections={hardware.status}
            onActions={(id, x, y) => {
              const deck = hardware.decks.find(item => item.recorder.id === id)
              if (deck) setMenu({ deck, x, y })
            }} />
          <Splitter axis="x" label="Largeur des appareils" min={210} max={leftMax} value={activeLayout.left} onChange={left => setLayout({ ...layout, left })} />
          <MediaBrowser deck={activeDeck} path={path} listing={listing} selected={selected} setSelected={setSelected} navigate={navigate}
            refresh={() => navigate(path)} showSystem={showSystem} hiddenCount={hiddenCount} onShowSystem={changeSystemVisibility} compact={compact} onOptions={() => setOverlay('options')} />
          {!compact && <><Splitter axis="x" label="Largeur des options" min={254} max={360} value={layout.right} reverse
            onChange={right => setLayout({ ...layout, right })} />{transferOptions}</>}
        </div>
        <Splitter axis="y" label="Hauteur de la file" min={128} max={queueMax} value={activeLayout.queue} reverse
          onChange={queue => setLayout({ ...layout, queue })} />
        <CompactQueue jobs={visibleJobs} names={names} onOpen={job => { setPreferredBatch(undefined); setSelectedJob(job); setPage('transfers') }} />
      </div>}
      {page === 'transfers' && <Transfers jobs={visibleJobs} names={names} demo={demo} selected={selectedJob} preferredBatch={preferredBatch} onSelect={job => { setPreferredBatch(undefined); setSelectedJob(job) }}
        playing={playing} onPlayback={() => setPlaying(value => !value)}
        batches={real.queue?.batches ?? []} destinations={real.queue?.destinations ?? []} rates={real.rates} onAction={action} busy={real.busy || Boolean(real.connectionError)}
        onCancel={job => changeJob(job, false)} onRetry={job => changeJob(job, true)} />}
      {page === 'reports' && (demo ? <Reports demo jobs={visibleJobs} /> : <RealReports queue={real.queue} />)}
      {page === 'settings' && <Settings demo={demo} native={bridge.native} info={info} values={values} onChange={setValues}
        onConnect={() => setOverlay('connect')} onReset={() => setLayout(defaultLayout)} onComponents={() => setOverlay('components')}
        onChoose={real.choose} available={available} busy={real.busy} onSave={saveDefaults} saved={saved}
        canConnect={hardware.ready && !hardware.busy}
        equipmentPanel={<EquipmentSettings enabled={!demo && hardware.ready && !hardware.busy}
          hasDecks={hardware.decks.length > 0} notice={demo ? '' : hardware.notice}
          onImport={() => void hardware.exchange(true)} onExport={() => void hardware.exchange(false)}
          onReset={() => setHardwareDialog({ action: 'reset' })} />} />}
    </main>
    <nav className="bottom-nav" aria-label="Espaces HMP">
      {pages.map(({ id, title, icon: Icon }) => <button key={id} aria-current={id === page ? 'page' : undefined} onClick={() => setPage(id)}>
        <Icon size={16} aria-hidden="true" />{title}
      </button>)}
    </nav>
    <footer className="status-bar">
      <span><Activity size={13} />{demo ? 'Données fictives · aucun transfert physique' : realRunning ? 'Transferts réels en cours' : activeDeck ? activeDeck.recorder.host : 'Aucun appareil sélectionné'}</span>
      <span><Info size={13} />V2 bêta <span className="mono">{info?.version ?? version}</span></span>
    </footer>
    {overlay === 'connect' && <Modal title="Identifier un HyperDeck" onClose={() => setOverlay(undefined)}>
      <Connect onConnect={result => {
        hardware.identified(result)
        chooseDeck(result.deck.recorder.id)
        setOverlay(undefined)
        setPage('media')
      }} />
    </Modal>}
    {menu && <RecorderMenu x={menu.x} y={menu.y} name={menu.deck.recorder.name}
      checking={hardware.status[menu.deck.recorder.id] === 'checking'}
      onClose={() => setMenu(undefined)}
      onRename={() => { setHardwareDialog({ action: 'rename', deck: menu.deck }); setMenu(undefined) }}
      onRemove={() => { setHardwareDialog({ action: 'remove', deck: menu.deck }); setMenu(undefined) }}
      onVerify={() => {
        setMenu(undefined)
        if (menu.deck.unique_id === null) setHardwareDialog({ action: 'verify', deck: menu.deck })
        else void hardware.verify(menu.deck)
      }} />}
    {hardwareDialog?.action === 'verify' && hardwareDialog.deck && <Modal title="Confirmer l’appareil" onClose={() => setHardwareDialog(undefined)}>
      <div className="panel-body stack">
        <p>Cet enregistreur ne fournit pas d’identifiant matériel. Confirmez que l’appareil à l’adresse {hardwareDialog.deck.recorder.host} est bien celui de cette prestation.</p>
        <button className="primary" onClick={() => {
          const deck = hardwareDialog.deck
          setHardwareDialog(undefined)
          if (deck) void hardware.verify(deck, true)
        }}>Confirmer et vérifier</button>
      </div>
    </Modal>}
    {hardwareDialog && hardwareDialog.action !== 'verify' && <Modal
      title={hardwareDialog.action === 'rename' ? 'Renommer l’enregistreur' : hardwareDialog.action === 'remove' ? 'Supprimer de la configuration' : 'Réinitialiser la prestation'}
      onClose={() => setHardwareDialog(undefined)}>
      <EquipmentEdit action={hardwareDialog.action} deck={hardwareDialog.deck} onCancel={() => setHardwareDialog(undefined)}
        onSave={async edit => {
          await hardware.edit(edit)
          if (edit.action === 'reset' || (edit.action === 'remove' && edit.id === liveId)) {
            setLiveId(undefined)
            navigate('/')
          }
          setHardwareDialog(undefined)
        }} />
    </Modal>}
    {overlay === 'options' && <Modal title="Options du lot" onClose={() => setOverlay(undefined)}>{!demo && real.feedback && <div className="callout error" role="alert">{real.feedback}</div>}{transferOptions}</Modal>}
    {overlay === 'components' && <Modal title="Planche des composants" wide onClose={() => setOverlay(undefined)}><ComponentBoard /></Modal>}
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
