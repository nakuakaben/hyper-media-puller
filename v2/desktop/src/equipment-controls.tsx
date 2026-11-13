import { useEffect, useRef, useState, type FormEvent } from 'react'
import { Network } from 'lucide-react'
import { errorMessage, type RecorderEdit, type SavedDeck } from './contracts'
import { Panel } from './ui'

export function RecorderMenu({ x, y, name, onClose, onRename, onRemove, onVerify, checking }: {
  x: number; y: number; name: string; onClose: () => void
  onRename: () => void; onRemove: () => void; onVerify: () => void; checking: boolean
}) {
  const menu = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const previous = document.activeElement
    menu.current?.querySelector('button')?.focus()
    return () => { if (previous instanceof HTMLElement) previous.focus() }
  }, [])
  return <div className="recorder-menu-layer" onPointerDown={event => { if (event.target === event.currentTarget) onClose() }}
    onContextMenu={event => { event.preventDefault(); onClose() }}>
    <div className="recorder-menu stack" ref={menu} role="group" aria-label={`Actions pour ${name}`}
      style={{ left: Math.max(4, Math.min(x, window.innerWidth - 246)), top: Math.max(4, Math.min(y, window.innerHeight - 132)) }}
      onBlur={event => { if (!event.currentTarget.contains(event.relatedTarget)) onClose() }}
      onKeyDown={event => { if (event.key === 'Escape') onClose() }}>
      <button onClick={onRename}>Renommer</button>
      <button onClick={onVerify} disabled={checking}>Vérifier la connexion</button>
      <button onClick={onRemove}>Supprimer de la configuration</button>
    </div>
  </div>
}

export function EquipmentEdit({ action, deck, onSave, onCancel }: {
  action: RecorderEdit['action']; deck?: SavedDeck
  onSave: (edit: RecorderEdit) => Promise<void>; onCancel: () => void
}) {
  const [name, setName] = useState(deck?.recorder.name ?? '')
  const [busy, setBusy] = useState(false)
  const [failure, setFailure] = useState('')
  const id = deck?.recorder.id ?? ''
  async function submit(event: FormEvent) {
    event.preventDefault()
    if (busy) return
    setBusy(true)
    setFailure('')
    const edit: RecorderEdit = action === 'rename' ? { action, id, name } : action === 'remove' ? { action, id } : { action }
    try { await onSave(edit) } catch (error) { setFailure(errorMessage(error)); setBusy(false) }
  }
  return <form className="panel-body stack" onSubmit={submit}>
    {action === 'rename' ? <label className="field-label">Nom personnalisé
      <input autoFocus value={name} maxLength={200} required onChange={event => setName(event.target.value)} />
    </label> : <p>{action === 'remove' ? `Retirer « ${deck?.recorder.name} » de cette prestation ?` : 'Retirer tous les enregistreurs de cette prestation ?'}
      {' '}Les médias et les lots existants sont conservés.</p>}
    {failure && <div className="callout error" role="alert">{failure}</div>}
    <div className="row">
      <button type="button" onClick={onCancel} disabled={busy}>Annuler</button>
      <button type="submit" className="primary" disabled={busy || (action === 'rename' && !name.trim())}>
        {action === 'rename' ? 'Enregistrer le nom' : action === 'remove' ? 'Supprimer l’enregistreur' : 'Réinitialiser les équipements'}
      </button>
    </div>
  </form>
}

export function EquipmentSettings({ enabled, hasDecks, notice, onImport, onExport, onReset }: {
  enabled: boolean; hasDecks: boolean; notice: string
  onImport: () => void; onExport: () => void; onReset: () => void
}) {
  return <Panel title="Configuration matérielle" icon={Network}><div className="panel-body stack">
    <p>Prestation active. L’import ajoute les équipements et conserve la configuration locale en cas de conflit.</p>
    <div className="row equipment-actions">
      <button disabled={!enabled} onClick={onExport}>Exporter le JSON</button>
      <button disabled={!enabled} onClick={onImport}>Importer un JSON</button>
      <button disabled={!enabled || !hasDecks} onClick={onReset}>Réinitialiser les équipements</button>
    </div>
    {notice && <p role="status">{notice}</p>}
  </div></Panel>
}
