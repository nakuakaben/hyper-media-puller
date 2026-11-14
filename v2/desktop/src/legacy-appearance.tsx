import { useState, type FormEvent } from 'react'
import { legacyPhotos } from '@legacy-photos'
import type { ThumbnailStyle } from './device-model'

const storageKey = 'hmp-v2.thumbnail-style'
export const legacyAvailable = legacyPhotos !== null

export function readThumbnailStyle(): ThumbnailStyle | null {
  if (!legacyAvailable) return null
  try {
    const saved = localStorage.getItem(storageKey)
    if (saved === 'generic' || saved === 'legacy') return saved
  } catch { /* The choice remains available for the current session. */ }
  return null
}

export function saveThumbnailStyle(style: ThumbnailStyle): boolean {
  try {
    localStorage.setItem(storageKey, style)
    return true
  } catch {
    return false
  }
}

export function LegacyUnlock({ onUnlock }: { onUnlock: () => void }) {
  const [code, setCode] = useState('')
  const [rejected, setRejected] = useState(false)

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (code === 'HYPERDECK') onUnlock()
    else setRejected(true)
  }

  return <form className="panel-body stack" onSubmit={submit}>
    <label className="field-label">Code secret
      <input type="password" autoFocus autoComplete="off" value={code}
        aria-invalid={rejected} onChange={event => { setCode(event.target.value); setRejected(false) }} />
    </label>
    {rejected && <p className="callout error" role="alert">Code incorrect.</p>}
    <button type="submit" disabled={!code}>Déverrouiller</button>
  </form>
}
