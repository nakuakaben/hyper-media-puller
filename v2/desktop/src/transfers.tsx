import { ArrowUpRight, ChevronRight, FileCheck2, FileClock, ListChecks, Pause, Play, RotateCcw, X } from 'lucide-react'
import { useState } from 'react'
import type { Job } from './contracts'
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
          <td className="mono"><span className="truncate" title={job.requested_destination}>
            {compact ? formatBytes(job.progress.total) : job.requested_destination}
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

export function Transfers({ jobs, names, demo, selected, onSelect, onCancel, onRetry, playing, onPlayback }: QueueProps & {
  selected?: string; onSelect: (id: string) => void; playing: boolean; onPlayback: () => void
}) {
  const [recorder, setRecorder] = useState('')
  const [status, setStatus] = useState('')
  const visible = jobs.filter(job => (!recorder || job.recorder_id === recorder) && (!status || job.status === status))
  const job = visible.find(item => item.id === selected) ?? visible[0]
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
          <dt>Nom prévu</dt><dd className="mono break-path">{job.requested_destination}</dd>
          <dt>Taille</dt><dd className="mono">{formatBytes(job.progress.total)}</dd>
        </dl>
        <label className="field-label">Copie<ProgressCell job={job} phase="copy" /></label>
        <label className="field-label">Vérification<ProgressCell job={job} phase="verify" /></label>
        {job.error && <div className="callout error" role="status"><strong>{job.error.code} · {job.error.phase}</strong>{job.error.message}</div>}
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
