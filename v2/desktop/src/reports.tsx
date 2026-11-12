import { FileCheck2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { errorMessage, offload, schemaVersion, scopeLabel, type Queue, type Report } from './contracts'
import { checksumLabels, duplicateLabels } from './settings'
import { formatBytes } from './demo'
import { displayLocalPath, Badge, Empty, Loading, Panel, statuses } from './ui'

const seconds = new Intl.NumberFormat('fr-FR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })
const formatDuration = (milliseconds: string) => seconds.format(Number(milliseconds) / 1000) + ' s'

export function RealReports({ queue }: { queue?: Queue }) {
  const batches = queue?.destinations ?? []
  const [selected, setSelected] = useState('')
  const [detail, setDetail] = useState<{ id: string; report?: Report; error?: string }>()
  const [json, setJson] = useState(false)
  const id = selected || batches.at(-1)?.id
  const sequence = queue?.sequence
  useEffect(() => {
    if (!id) return
    let current = true
    offload.report(id).then(report => {
      if (current) {
        if (report.schema_version !== schemaVersion) throw new Error('Version de rapport inconnue')
        setDetail({ id, report })
      }
    }).catch(error => { if (current) setDetail({ id, error: errorMessage(error) }) })
    return () => { current = false }
  }, [id, sequence])

  const report = detail?.id === id ? detail?.report : undefined
  const error = detail?.id === id ? detail?.error : undefined
  return <div className="two-pane reports-layout">
    <Panel title="Rapports de transfert réels" icon={FileCheck2}>
      {batches.length ? <div className="toolbar">
        <label className="field-label">Lot
          <select value={id} onChange={event => setSelected(event.target.value)}>
            {batches.map(batch => <option key={batch.id} value={batch.id}>
              {new Date(Number(batch.created_at_millis)).toLocaleString('fr-FR')} · {batch.id.slice(0, 8)}
            </option>)}
          </select>
        </label>
        <button onClick={() => setJson(value => !value)} aria-pressed={json}>{json ? 'Voir le rapport' : 'Afficher le JSON'}</button>
      </div> : <Empty icon={FileCheck2} title="Aucun lot réel" />}
      {id && !report && (error ? <div className="callout error" role="alert">{error}</div> : <Loading title="Lecture du rapport…" />)}
      {report && (json ? <div className="panel-body"><textarea readOnly className="report-json mono" aria-label="Rapport JSON" value={JSON.stringify(report, null, 2)} /></div>
        : <div className="panel-body stack">
          {report.jobs.map(({ source, transfer, elapsed_millis }) => {
            const status = statuses[transfer.status]
            return <article key={transfer.id} className="report-entry stack">
              <div className="row"><h3 className="break-path">{transfer.remote_path}</h3><Badge {...status} /></div>
              <dl className="key-values">
                <dt>Source</dt><dd>{source.name} · {source.host}</dd>
                <dt>Destination</dt><dd className="mono break-path">{displayLocalPath(transfer.destination ?? transfer.requested_destination)}</dd>
                <dt>Attendu</dt><dd className="mono">{formatBytes(transfer.progress.total)}</dd>
                <dt>Reçu / écrit</dt><dd className="mono">{formatBytes(transfer.progress.received)} / {formatBytes(transfer.progress.written)}</dd>
                <dt>Durée</dt><dd>{elapsed_millis === null ? '—' : formatDuration(elapsed_millis)}</dd>
                {transfer.checksum && <>
                  <dt>Portée</dt><dd>{scopeLabel(transfer.checksum.scope)}</dd>
                  {transfer.checksum.md5 && <><dt>MD5</dt><dd className="mono break-path">{transfer.checksum.md5}</dd></>}
                  {transfer.checksum.sha256 && <><dt>SHA-256</dt><dd className="mono break-path">{transfer.checksum.sha256}</dd></>}
                </>}
              </dl>
              {transfer.status === 'skipped' && <p>Fichier existant ignoré, contenu non vérifié.</p>}
              {transfer.error && <p className="callout error">{transfer.error.code} · {transfer.error.phase} · {transfer.error.message}</p>}
              {transfer.history.length > 0 && <p>{transfer.history.length} tentative(s) antérieure(s) dans le JSON.</p>}
            </article>
          })}
        </div>)}
    </Panel>
    <Panel title="Informations du lot" icon={FileCheck2}>
      {report ? <div className="panel-body stack">
        <dl className="key-values"><dt>Création</dt><dd>{new Date(Number(report.batch.created_at_millis)).toLocaleString('fr-FR')}</dd>
          <dt>Durée</dt><dd>{formatDuration(report.elapsed_millis)}</dd>
          <dt>Dossier</dt><dd className="mono break-path">{displayLocalPath(report.batch.destination)}</dd>
          <dt>Doublons</dt><dd>{duplicateLabels[report.batch.options.batch.duplicate]}</dd>
          <dt>Checksums</dt><dd>{checksumLabels[report.batch.options.batch.checksum]}</dd>
          <dt>Concurrence</dt><dd>{report.batch.options.global_limit} globale · {report.batch.options.recorder_limit} par HyperDeck</dd>
        </dl>
        <p>Une comparaison flux/local vérifie la relecture de la copie à partir des octets reçus.</p>
      </div> : <Empty title="Aucun rapport sélectionné" />}
    </Panel>
  </div>
}
