import { Database, FolderOpen, Info, Network, Settings2, SlidersHorizontal } from 'lucide-react'
import type { Checksum, Duplicate, PreviewInfo } from './contracts'
import { Badge, Panel } from './ui'

export type Preferences = { checksum: Checksum; duplicate: Duplicate; concurrency: number; destination: string }
export const defaultPreferences: Preferences = { checksum: 'md5', duplicate: 'rename', concurrency: 2, destination: '' }

export function Options({ values, onChange }: { values: Preferences; onChange: (p: Preferences) => void }) {
  return <>
    <label className="field-label">Doublons<select value={values.duplicate} onChange={event => onChange({ ...values, duplicate: event.target.value as Duplicate })}>
      <option value="rename">Renommer la copie</option><option value="skip">Ignorer</option><option value="overwrite">Écraser la copie locale</option>
    </select></label>
    <label className="field-label">Checksum<select value={values.checksum} onChange={event => onChange({ ...values, checksum: event.target.value as Checksum })}>
      <option value="none">Aucun</option><option value="md5">MD5</option><option value="sha256">SHA-256</option><option value="both">MD5 + SHA-256</option>
    </select></label>
  </>
}

export function Destination({ demo, values, onChange }: { demo: boolean; values: Preferences; onChange: (p: Preferences) => void }) {
  return <label className="field-label">Dossier destination
    <div className="input-icon"><FolderOpen size={15} aria-hidden="true" />
      <input value={demo ? values.destination : ''} disabled={!demo} placeholder={demo ? '/Volumes/Offload/Régie' : 'Sélection native à venir'}
        onChange={event => onChange({ ...values, destination: event.target.value })} />
    </div>
  </label>
}

export function Settings({ demo, native, info, values, onChange, onConnect, onReset, onComponents }: {
  demo: boolean; native: boolean; info?: PreviewInfo; values: Preferences; onChange: (p: Preferences) => void
  onConnect: () => void; onReset: () => void; onComponents: () => void
}) {
  return <div className="settings-grid">
    <Panel title="Connexions" icon={Network}><div className="panel-body stack">
      <Badge label={demo ? 'Démonstration' : 'FTP en lecture seule'} tone={demo ? 'warn' : 'neutral'} />
      <p>Identification par IPv4 locale, puis navigation FTP anonyme sur le port 21.</p>
      <button disabled={demo || !native} onClick={onConnect}>Identifier un HyperDeck</button>
    </div></Panel>
    <Panel title="Destination" icon={Database}><div className="panel-body stack">
      <Destination demo={demo} values={values} onChange={onChange} />
      <p>{demo ? 'Chemin d’exemple, sans accès au disque.' : 'La copie vers une destination locale sera raccordée dans un lot suivant.'}</p>
    </div></Panel>
    <Panel title="Préférences de transfert" icon={SlidersHorizontal}><div className="panel-body stack">
      <Options values={values} onChange={onChange} />
      <label className="field-label">Concurrence globale<select value={values.concurrency} onChange={event => onChange({ ...values, concurrency: Number(event.target.value) })}>
        {[1, 2, 3, 4].map(number => <option key={number} value={number}>{number}</option>)}
      </select></label>
      <p>La concurrence règle l’animation de démonstration. Le moteur de transfert reste indépendant.</p>
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
