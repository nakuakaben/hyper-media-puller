import { ArrowUpRight, ChevronRight, FileCheck2, FileClock, ListChecks, Pause, Play, RotateCcw, X } from 'lucide-react'
import { useState } from 'react'
import { scopeLabel, terminal, type Batch, type BatchDetails, type Job, type LiveJob, type TransferAction } from './contracts'
import type { Rate } from './offload'
import { formatBytes } from './demo'
import { Badge, Empty, Panel, ProgressCell, statuses } from './ui'

type QueueProps = {
  jobs: Job[]
  names: Record<string, string>
  demo: boolean
  onCancel: (id: string) => void
  onRetry: (id: string) => void
}

function JobTable({ jobs, names, selected, onSelect, compact = false }: {
  jobs: Job[]; names: Record<string, string>; selected?: string; onSelect: (id: string) => void; compact?: boolean
}) {
  return <div className="table-scroll">
    <table className="queue-table">
      <colgroup><col style={{ width: '28%' }} /><col style={{ width: '13%' }} /><col style={{ width: '15%' }} />
        <col style={{ width: '16%' }} /><col style={{ width: '16%' }} /><col style={{ width: '12%' }} /></colgroup>
      <thead><tr><th scope="col">Fichier</th><th scope="col">HyperDeck</th><th scope="col">État</th>
        <th scope="col">Copie</th><th scope="col">Vérification</th><th scope="col">{compact ? 'Taille' : 'Destination'}</th></tr></thead>
      <tbody>{jobs.map(job => {
        const status = statuses[job.status]
        const file = job.remote_path.split('/').at(-1)
        return <tr key={job.id} className={job.id === selected ? 'selected' : undefined}>
          <th scope="row"><button className="cell-button" onClick={() => onSelect(job.id)} title={job.remote_path}>
            <FileClock size={14} aria-hidden="true" /><span className="truncate">{file}</span>
          </button></th>
          <td><span className="truncate">{names[job.recorder_id] ?? job.recorder_id}</span></td>
          <td><Badge label={status.label} tone={status.tone} /></td>
          <td><ProgressCell job={job} phase="copy" /></td>
          <td><ProgressCell job={job} phase="verify" /></td>
          <td className="mono"><span className="truncate" title={'destination' in job ? (job as LiveJob).destination ?? job.requested_destination : job.requested_destination}>
            {compact ? formatBytes(job.progress.total) : 'destination' in job ? (job as LiveJob).destination ?? job.requested_destination : job.requested_destination}
          </span></td>
        </tr>
      })}</tbody>
    </table>
  </div>
}

export function CompactQueue({ jobs, names, onOpen }: Pick<QueueProps, 'jobs' | 'names'> & { onOpen: (id?: string) => void }) {
  const active = jobs.filter(job => ['running', 'verifying', 'finalizing'].includes(job.status)).length
  return <Panel title="File de transfert" icon={ListChecks}
    meta={jobs.length + (jobs.length === 1 ? ' tâche' : ' tâches') + (active ? ' · ' + active + ' actives' : '')}
    actions={<button className="ghost small" onClick={() => onOpen()}>Ouvrir les transferts <ArrowUpRight size={14} /></button>}>
    {jobs.length ? <JobTable jobs={jobs} names={names} compact onSelect={onOpen} /> : <Empty icon={ListChecks} title="File vide" />}
  </Panel>
}

export function Transfers({ jobs, names, demo, selected, preferredBatch, onSelect, onCancel, onRetry, playing, onPlayback,
  batches, destinations, rates, onAction, busy }: QueueProps & {
  selected?: string; preferredBatch?: string; onSelect: (id: string) => void; playing: boolean; onPlayback: () => void
  batches: Batch[]; destinations: BatchDetails[]; rates: Record<string, Rate>
  onAction: (action: TransferAction, id: string) => void; busy: boolean
}) {
  const [recorder, setRecorder] = useState('')
  const [status, setStatus] = useState('')
  const visible = jobs.filter(job => (!recorder || job.recorder_id === recorder) && (!status || job.status === status))
  const job = visible.find(item => item.id === selected)
    ?? (preferredBatch && !demo ? visible.find(item => (item as LiveJob).batch_id === preferredBatch) : visible[0])
  const live = job && !demo ? job as LiveJob : undefined
  const batch = batches.find(item => item.id === live?.batch_id)
  const destination = destinations.find(item => item.id === live?.batch_id)
  const rate = live && rates[live.id]
  const hasPending = jobs.some(item => (item as LiveJob).batch_id === batch?.id && item.status === 'pending')
  return <div className="two-pane">
    <Panel title="File de transfert" icon={ListChecks} meta={visible.length + ' / ' + jobs.length}
      actions={demo && <button onClick={onPlayback}>{playing ? <Pause size={14} /> : <Play size={14} />}
        {playing ? 'Mettre la démo en pause' : 'Animer la démonstration'}
      </button>}>
      <div className="toolbar">
        <select aria-label="Filtrer par HyperDeck" value={recorder} onChange={event => setRecorder(event.target.value)}>
          <option value="">Tous les HyperDeck</option>
          {Object.entries(names).map(([id, name]) => <option key={id} value={id}>{name}</option>)}
        </select>
        <select aria-label="Filtrer par état" value={status} onChange={event => setStatus(event.target.value)}>
          <option value="">Tous les états</option>
          {Object.entries(statuses).map(([id, entry]) => <option key={id} value={id}>{entry.label}</option>)}
        </select>
      </div>
      {visible.length ? <JobTable jobs={visible} names={names} selected={job?.id} onSelect={onSelect} />
        : <Empty icon={ListChecks} title={jobs.length ? 'Aucun résultat pour ces filtres' : 'Aucun transfert'} />}
    </Panel>
    <Panel title="Détail du transfert" icon={ChevronRight}>
      {job ? <div className="panel-body stack">
        <Badge {...statuses[job.status]} />
        <h3 className="break-path">{job.remote_path.split('/').at(-1)}</h3>
        <dl className="key-values">
          <dt>Source</dt><dd className="mono break-path">{job.remote_path}</dd>
          <dt>HyperDeck</dt><dd>{names[job.recorder_id]}</dd>
          <dt>{live?.destination ? 'Destination' : 'Nom prévu'}</dt><dd className="mono break-path">{live?.destination ?? job.requested_destination}</dd>
          {destination && !live?.destination && <><dt>Dossier du lot</dt><dd className="mono break-path">{destination.destination}</dd></>}
          <dt>Taille attendue</dt><dd className="mono">{formatBytes(job.progress.total)}</dd>
          {live && <><dt>Octets écrits</dt><dd className="mono">{formatBytes(live.progress.written)}</dd></>}
          {rate && <><dt>Débit</dt><dd className="mono">{formatBytes(String(rate.bytesPerSecond))}/s</dd>
            {rate.secondsLeft !== undefined && <><dt>Temps restant</dt><dd className="mono">{rate.secondsLeft} s</dd></>}
          </>}
        </dl>
        <label className="field-label">Copie<ProgressCell job={job} phase="copy" /></label>
        <label className="field-label">Vérification<ProgressCell job={job} phase="verify" /></label>
        {job.error && <div className="callout error" role="status"><strong>{job.error.code} · {job.error.phase}{job.error.protocol_code ? ' · FTP ' + job.error.protocol_code : ''}</strong>{job.error.message}</div>}
        {live?.checksum && <p>{scopeLabel(live.checksum.scope)}</p>}
        {live?.status === 'skipped' && <p>Fichier existant ignoré. Son contenu reste non vérifié.</p>}
        {live && <div className="row">
          {batch?.started && <button disabled={busy} onClick={() => onAction('pause', batch.id)}><Pause size={14} />Mettre le lot en pause</button>}
          {batch && !batch.started && hasPending && <button className="primary" disabled={busy} onClick={() => onAction('start', batch.id)}>
            <Play size={14} />Démarrer / reprendre le lot
          </button>}
          {!terminal(live.status) && live.status !== 'finalizing' && <button disabled={busy} onClick={() => onAction('cancel', live.id)}><X size={14} />Annuler</button>}
          {(['cancelled', 'error', 'checksum_error'].includes(live.status)) && <button disabled={busy} onClick={() => onAction('retry', live.id)}><RotateCcw size={14} />Réessayer</button>}
        </div>}
        {batch?.started && <p className="hint">La pause laisse les copies actives se terminer.</p>}
        {demo && <div className="row">
          {['pending', 'running', 'verifying'].includes(job.status) && <button onClick={() => onCancel(job.id)}><X size={14} />Annuler</button>}
          {(job.status === 'cancelled' || job.error?.retryable) && <button onClick={() => onRetry(job.id)}><RotateCcw size={14} />Remettre en file</button>}
        </div>}
      </div> : <Empty title="Aucun transfert sélectionné" />}
    </Panel>
  </div>
}

export function Reports({ demo, jobs }: { demo: boolean; jobs: Job[] }) {
  return <div className="two-pane">
    <Panel title="Rapports de transfert" icon={FileCheck2}>
      {!demo ? <Empty icon={FileCheck2} title="Aucun rapport disponible">Les rapports de cette Preview sont consultables en démonstration.</Empty>
        : <div className="panel-body stack">
          <div className="callout warn"><strong>Rapport de démonstration</strong>Données fictives. Aucun checksum ni certificat émis.</div>
          <table className="report-table">
            <thead><tr><th scope="col">Fichier</th><th scope="col">État de démonstration</th><th scope="col">Taille source</th></tr></thead>
            <tbody>{jobs.map(job => <tr key={job.id}>
              <th scope="row" className="break-path">{job.remote_path.split('/').at(-1)}</th>
              <td><Badge {...statuses[job.status]} /></td><td className="mono">{formatBytes(job.progress.total)}</td>
            </tr>)}</tbody>
          </table>
        </div>}
    </Panel>
    <Panel title="Portée de la vérification" icon={FileCheck2}>
      <div className="panel-body stack"><h3>Empreintes et intégrité</h3>
        <p>Le contrat Rust distingue le checksum local de la comparaison entre le flux reçu et sa relecture locale.</p>
        <dl className="key-values"><dt>MD5</dt><dd>—</dd><dt>SHA-256</dt><dd>—</dd><dt>Octets vérifiés</dt><dd>—</dd></dl>
      </div>
    </Panel>
  </div>
}
