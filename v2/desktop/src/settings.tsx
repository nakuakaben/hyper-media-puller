import { Database, FolderOpen, Info, Network, Settings2, SlidersHorizontal } from 'lucide-react'
import type { Checksum, Duplicate, PreviewInfo } from './contracts'
import { Badge, Panel } from './ui'

export type Preferences = { checksum: Checksum; duplicate: Duplicate; concurrency: number; recorderLimit: number; destination: string }
export const defaultPreferences: Preferences = { checksum: 'md5', duplicate: 'rename', concurrency: 2, recorderLimit: 1, destination: '' }

export const duplicateLabels: Record<Duplicate, string> = {
  rename: 'Renommer la copie', skip: 'Ignorer', overwrite: 'Écraser la copie locale',
}
export const checksumLabels: Record<Checksum, string> = {
  none: 'Aucun', md5: 'MD5', sha256: 'SHA-256', both: 'MD5 + SHA-256',
}

export function Options({ values, onChange }: { values: Preferences; onChange: (p: Preferences) => void }) {
  return <>
    <label className="field-label">Doublons<select value={values.duplicate} onChange={event => onChange({ ...values, duplicate: event.target.value as Duplicate })}>
      {Object.entries(duplicateLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
    <label className="field-label">Checksum<select value={values.checksum} onChange={event => onChange({ ...values, checksum: event.target.value as Checksum })}>
      {Object.entries(checksumLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
    </select></label>
  </>
}

export function Destination({ demo, values, onChange, onChoose, available, busy }: {
  demo: boolean; values: Preferences; onChange: (p: Preferences) => void
  onChoose: () => void; available?: string; busy?: boolean
}) {
  if (demo) return <label className="field-label">Dossier destination
    <div className="input-icon"><FolderOpen size={15} aria-hidden="true" />
      <input value={values.destination} placeholder="/Volumes/Offload/Régie"
        onChange={event => onChange({ ...values, destination: event.target.value })} />
    </div>
  </label>
  return <div className="field-label">
    <span>Dossier destination</span>
    <div className="destination-path mono break-path">{values.destination || 'Aucun dossier choisi'}</div>
    {available && <span>{available} disponibles</span>}
    <button disabled={busy} onClick={onChoose}><FolderOpen size={15} />Choisir un dossier</button>
  </div>
}

export function Settings({ demo, native, info, values, onChange, onConnect, onReset, onComponents, onChoose, available, busy, onSave, saved }: {
  demo: boolean; native: boolean; info?: PreviewInfo; values: Preferences; onChange: (p: Preferences) => void
  onConnect: () => void; onReset: () => void; onComponents: () => void
  onChoose: () => void; available?: string; busy: boolean; onSave: () => void; saved: boolean
}) {
  return <div className="settings-grid">
    <Panel title="Connexions" icon={Network}><div className="panel-body stack">
      <Badge label={demo ? 'Démonstration' : 'FTP en lecture seule'} tone={demo ? 'warn' : 'neutral'} />
      <p>Identification par IPv4 locale, puis navigation FTP anonyme sur le port 21.</p>
      <button disabled={demo || !native} onClick={onConnect}>Identifier un HyperDeck</button>
    </div></Panel>
    <Panel title="Destination" icon={Database}><div className="panel-body stack">
      <Destination demo={demo} values={values} onChange={onChange} onChoose={onChoose} available={available} busy={busy || !native} />
      <p>{demo ? 'Chemin d’exemple, sans accès au disque.' : 'Le dossier choisi devient la destination par défaut des prochains lots.'}</p>
    </div></Panel>
    <Panel title="Préférences de transfert" icon={SlidersHorizontal}><div className="panel-body stack">
      <Options values={values} onChange={onChange} />
      <label className="field-label">Concurrence globale<select value={values.concurrency} onChange={event => onChange({ ...values, concurrency: Number(event.target.value), recorderLimit: Math.min(values.recorderLimit, Number(event.target.value)) })}>
        {[1, 2, 3, 4].map(number => <option key={number} value={number}>{number}</option>)}
      </select></label>
      <label className="field-label">Limite réseau par HyperDeck<select value={values.recorderLimit} disabled={demo}
        onChange={event => onChange({ ...values, recorderLimit: Number(event.target.value) })}>
        {Array.from({ length: values.concurrency }, (_, index) => index + 1).map(number => <option key={number} value={number}>{number}</option>)}
      </select></label>
      {demo ? <p>La concurrence règle l’animation de démonstration.</p> : <>
        <p>Les nouveaux lots enregistrent leurs propres réglages.</p>
        <button onClick={onSave} disabled={busy || !native}>Enregistrer les valeurs par défaut</button>
        {saved && <p role="status">Valeurs par défaut enregistrées.</p>}
      </>}
    </div></Panel>
    <Panel title="Application" icon={Info}><div className="panel-body stack">
      <dl className="key-values"><dt>Version</dt><dd className="mono">{info?.version ?? '0.1.0'} Preview</dd>
        <dt>Contrat</dt><dd className="mono">{info?.schema_version ?? '—'}</dd>
        <dt>Profil V2</dt><dd className="mono break-path">{info?.profile ?? 'Aperçu navigateur'}</dd></dl>
      <div className="row"><button onClick={onReset}><Settings2 size={14} />Réinitialiser la disposition</button>
        <button onClick={onComponents}>Planche des composants</button></div>
    </div></Panel>
  </div>
}
