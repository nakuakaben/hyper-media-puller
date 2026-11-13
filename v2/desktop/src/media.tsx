import { ArrowUp, ChevronRight, CircleAlert, Clapperboard, FileVideo, Folder, FolderOpen, HardDrive, ListPlus, Plus, RefreshCw, Search, Server, SlidersHorizontal } from 'lucide-react'
import { useState } from 'react'
import type { Deck, Media } from './contracts'
import { isSystemPath, selectableMedia } from './media-visibility'
import { formatBytes } from './demo'
import { deviceImages } from './device-images'
import { Destination, Options, type Preferences } from './settings'
import { Badge, Empty, Loading, Panel } from './ui'

export function Recorders({ decks, active, demo, native, onSelect, onConnect }: {
  decks: Deck[]; active: string | undefined; demo: boolean; native: boolean
  onSelect: (id: string) => void; onConnect: () => void
}) {
  const [filter, setFilter] = useState('')
  const query = filter.trim().toLocaleLowerCase()
  const visible = decks.filter(({ recorder, model }) => [recorder.name, model, recorder.host].some(value => value.toLocaleLowerCase().includes(query)))
  return <Panel title="HyperDeck" icon={Server} meta={String(decks.length)}
    actions={!demo && <button className="icon-button" disabled={!native} aria-label="Identifier un HyperDeck" title="Identifier un HyperDeck" onClick={onConnect}><Plus size={15} /></button>}>
    <div className="toolbar"><label className="input-icon"><Search size={14} aria-hidden="true" /><input aria-label="Filtrer les HyperDeck"
      value={filter} onChange={event => setFilter(event.target.value)} placeholder="Rechercher" /></label></div>
    <div className="recorder-list">
      {visible.map(({ recorder, model }) => {
        const image = deviceImages[model.toLowerCase()]
        const offline = demo && recorder.id === 'legacy'
        return <button key={recorder.id} className="recorder" aria-pressed={active === recorder.id} onClick={() => onSelect(recorder.id)}>
          <span className="device-icon">{image ? <img src={image} alt="" /> :
            <span title="Visuel du modèle indisponible dans ce build"><Server size={23} aria-hidden="true" /></span>}</span>
          <span className="device-label"><strong className="truncate" title={recorder.name}>{recorder.name}</strong>
            {model !== recorder.name && <span className="truncate" title={model}>{model}</span>}
            <span className="mono truncate">{offline ? "Hors ligne" : recorder.host}</span></span>
          <span className={'device-dot ' + (offline ? 'offline' : 'available')} aria-label={offline ? 'Hors ligne' : demo ? 'Appareil de démonstration' : 'Identifié'} />
        </button>
      })}
      {!visible.length && <Empty icon={Server} title={decks.length ? 'Aucun résultat' : 'Aucun HyperDeck'} />}
    </div>
  </Panel>
}

export type Listing = { status: 'idle' | 'loading' | 'ready' | 'error' | 'offline'; items: Media[]; message?: string }

export function MediaBrowser({ deck, path, listing, selected, setSelected, navigate, refresh, onOptions, compact, showSystem, hiddenCount, onShowSystem }: {
  deck?: Deck; path: string; listing: Listing; selected: Set<string>; setSelected: (value: Set<string>) => void
  navigate: (path: string) => void; refresh: () => void; onOptions: () => void; compact: boolean
  showSystem: boolean; hiddenCount: number; onShowSystem: (show: boolean) => void
}) {
  const files = selectableMedia(listing.items)
  const segments = path.split('/').filter(Boolean)
  const parent = path.slice(0, path.lastIndexOf('/')) || '/'
  return <Panel title="Navigateur FTP" icon={FolderOpen} meta={deck?.recorder.name} actions={<>
    {compact && <button onClick={onOptions}><SlidersHorizontal size={14} />Options</button>}
    <button className="icon-button" disabled={!deck || listing.status === 'loading'} onClick={refresh} title="Actualiser" aria-label="Actualiser"><RefreshCw size={15} /></button>
  </>}>
    <div className="toolbar breadcrumb" aria-label="Chemin FTP">
      <button className="icon-button" aria-label="Dossier parent" title="Dossier parent" disabled={!deck || path === '/'} onClick={() => navigate(parent)}><ArrowUp size={14} /></button>
      <button className="ghost small mono" disabled={!deck} onClick={() => navigate('/')}>/</button>
      {segments.map((segment, index) => <span className="crumb" key={index}><ChevronRight size={12} />
        <button className="ghost small mono truncate" title={segment} aria-current={index === segments.length - 1 ? 'location' : undefined}
          onClick={() => navigate('/' + segments.slice(0, index + 1).join('/'))}>{segment}</button></span>)}
      <label className="system-toggle">
        <input type="checkbox" checked={showSystem} disabled={!deck} onChange={event => onShowSystem(event.target.checked)} />
        Afficher les fichiers système
      </label>
    </div>
    {listing.status === 'idle' && <Empty icon={HardDrive} title="Sélectionnez un HyperDeck">Les dossiers et médias FTP s’afficheront ici.</Empty>}
    {listing.status === 'loading' && <Loading title="Lecture du dossier FTP…" />}
    {(listing.status === 'error' || listing.status === 'offline') && <Empty icon={CircleAlert}
      title={listing.status === 'offline' ? 'HyperDeck hors ligne' : 'Dossier FTP inaccessible'}>
      <p>{listing.message}</p><button onClick={refresh}><RefreshCw size={14} />Réessayer</button>
    </Empty>}
    {listing.status === 'ready' && !listing.items.length && <Empty icon={FolderOpen} title={hiddenCount ? "Ce dossier contient uniquement des fichiers système masqués" : "Dossier vide"} />}
    {listing.status === 'ready' && listing.items.length > 0 && <div className="table-scroll">
      <table className="media-table"><colgroup><col className="check-col" /><col /><col className="type-col" /><col className="size-col" /></colgroup>
        <thead><tr><th scope="col"><input type="checkbox" aria-label="Sélectionner tous les fichiers"
          disabled={!files.length} checked={files.length > 0 && files.every(file => selected.has(file.remote_path))}
          ref={input => { if (input) input.indeterminate = files.some(file => selected.has(file.remote_path)) && !files.every(file => selected.has(file.remote_path)) }}
          onChange={event => setSelected(new Set(event.target.checked ? files.map(file => file.remote_path) : []))} /></th>
          <th scope="col">Nom</th><th scope="col">Type</th><th scope="col" className="align-right">Taille</th></tr></thead>
        <tbody>{listing.items.map(entry => {
          const name = entry.remote_path.split('/').at(-1)
          const system = isSystemPath(entry.remote_path)
          const checked = !system && selected.has(entry.remote_path)
          return <tr key={entry.remote_path} className={checked ? 'selected' : undefined}>
            <td>{!entry.directory && !system && <input type="checkbox" aria-label={'Sélectionner ' + name} checked={checked} onChange={event => {
              const next = new Set(selected)
              if (event.target.checked) next.add(entry.remote_path)
              else next.delete(entry.remote_path)
              setSelected(next)
            }} />}</td>
            <th scope="row">{entry.directory
              ? <button className="cell-button" title={name} onClick={() => navigate(entry.remote_path)}><Folder size={15} /><span className="truncate">{name}</span></button>
              : <span className="cell-button" title={name}><FileVideo size={15} /><span className="truncate">{name}</span></span>}</th>
            <td className="muted">{system ? 'Système' : entry.directory ? 'Dossier' : 'Média'}</td>
            <td className="align-right mono">{formatBytes(entry.size)}</td>
          </tr>
        })}</tbody>
      </table>
    </div>}
    <div className="panel-foot"><span>{listing.items.length} éléments</span><span>{selected.size} sélectionné(s)</span>{hiddenCount > 0 && <span>{hiddenCount} système masqué(s)</span>}</div>
  </Panel>
}

export function TransferOptions({ demo, values, onChange, count, bytes, onAdd, onChoose, available, busy }: {
  demo: boolean; values: Preferences; onChange: (p: Preferences) => void
  count: number; bytes: string | null; onAdd: () => void
  onChoose: () => void; available?: string; busy: boolean
}) {
  return <Panel title="Destination et options" icon={SlidersHorizontal}>
    <div className="panel-body stack">
      <Destination demo={demo} values={values} onChange={onChange} onChoose={onChoose} available={available} busy={busy} />
      <hr />
      <Options values={values} onChange={onChange} />
      <div className="selection-summary"><Clapperboard size={17} /><div><strong>{count} fichier(s) sélectionné(s)</strong>
        <span className="mono">{bytes === null ? 'Taille inconnue' : formatBytes(bytes)}</span></div></div>
      <button className="primary" disabled={busy || !count || !values.destination.trim()} onClick={onAdd}><ListPlus size={15} />Ajouter à la file</button>
      <p className="hint">{demo ? 'File de démonstration. Aucune écriture sur le disque.' : 'La destination, les doublons et les checksums sont figés à la création du lot.'}</p>
    </div>
  </Panel>
}
