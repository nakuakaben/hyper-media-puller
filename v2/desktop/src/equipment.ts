import { useEffect, useRef, useState } from 'react'
import { bridge, equipment, errorMessage, type Connection, type Identified, type RecorderEdit, type SavedDeck } from './contracts'

export function useEquipment() {
  const [decks, setDecks] = useState<SavedDeck[]>([])
  const [status, setStatus] = useState<Record<string, Connection>>({})
  const [ready, setReady] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const checking = useRef(new Map<string, symbol>())
  const manuallyConfirmed = useRef(new Set<string>())
  const savedDecks = useRef<SavedDeck[]>([])

  function replaceDecks(next: SavedDeck[]) {
    savedDecks.current = next
    setDecks(next)
  }

  async function verify(deck: SavedDeck, acceptUnidentified = false, background = false) {
    const id = deck.recorder.id
    if (checking.current.has(id)) return
    const request = Symbol()
    checking.current.set(id, request)
    if (!background) setStatus(previous => ({ ...previous, [id]: 'checking' }))
    try {
      const result = await equipment.verify(id, acceptUnidentified || manuallyConfirmed.current.has(id))
      if (checking.current.get(id) === request) {
        if (acceptUnidentified && result === 'online') manuallyConfirmed.current.add(id)
        if (result !== 'online') manuallyConfirmed.current.delete(id)
        setStatus(previous => previous[id] === result ? previous : { ...previous, [id]: result })
      }
    } catch (failure) {
      if (checking.current.get(id) !== request) return
      manuallyConfirmed.current.delete(id)
      setStatus(previous => ({ ...previous, [id]: 'offline' }))
      setError(errorMessage(failure))
    } finally {
      if (checking.current.get(id) === request) checking.current.delete(id)
    }
  }

  useEffect(() => {
    if (!bridge.native) return
    let active = true
    equipment.list().then(saved => {
      if (!active) return
      replaceDecks(saved)
      setReady(true)
      // Limit background probes when importing a large prestation.
      void verifyAll(saved, false, () => active)
    }).catch(failure => { if (active) setError(errorMessage(failure)) })
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!bridge.native || !ready) return
    let current = true
    let running = false
    const refresh = async () => {
      if (running) return
      running = true
      try { await verifyAll(savedDecks.current, true, () => current) }
      finally { running = false }
    }
    const interval = window.setInterval(refresh, 30_000)
    const resume = () => { if (document.visibilityState === 'visible') void refresh() }
    window.addEventListener('focus', resume)
    document.addEventListener('visibilitychange', resume)
    return () => {
      current = false
      window.clearInterval(interval)
      window.removeEventListener('focus', resume)
      document.removeEventListener('visibilitychange', resume)
    }
  }, [ready])

  async function verifyAll(saved: SavedDeck[], background = false, current = () => true) {
    if (!background) setStatus(previous => ({ ...previous, ...Object.fromEntries(saved.map(deck => [deck.recorder.id, 'checking'])) }))
    for (let index = 0; index < saved.length && current(); index += 8) {
      const batch = saved.slice(index, index + 8).flatMap(deck =>
        savedDecks.current.filter(current => current.recorder.id === deck.recorder.id))
      await Promise.all(batch.map(deck => verify(deck, false, background)))
    }
  }

  function identified({ deck, connection }: Identified) {
    const id = deck.recorder.id
    checking.current.delete(id)
    if (deck.unique_id === null && connection === 'online') manuallyConfirmed.current.add(id)
    const previous = savedDecks.current
    replaceDecks(previous.some(item => item.recorder.id === id)
      ? previous.map(item => item.recorder.id === id ? deck : item)
      : [...previous, deck])
    setStatus(previous => ({ ...previous, [id]: connection }))
  }

  async function edit(change: RecorderEdit) {
    setBusy(true)
    try {
      const updated = await equipment.edit(change)
      if (change.action === 'remove') {
        checking.current.delete(change.id)
        manuallyConfirmed.current.delete(change.id)
      }
      if (change.action === 'reset') {
        checking.current.clear()
        manuallyConfirmed.current.clear()
        setStatus({})
      } else if (change.action === 'remove') {
        setStatus(previous => {
          const next = { ...previous }
          delete next[change.id]
          return next
        })
      }
      replaceDecks(updated)
    } finally {
      setBusy(false)
    }
  }

  async function exchange(importFile: boolean) {
    setBusy(true)
    setError('')
    setNotice('')
    try {
      const result = await equipment.json(importFile)
      if (!result) return
      if (importFile) {
        replaceDecks([...savedDecks.current, ...result.added])
        setNotice(`${result.added.length} ajouté(s), ${result.skipped} doublon(s) ou conflit(s) ignoré(s).`)
        void verifyAll(result.added)
      } else {
        setNotice('Configuration exportée.')
      }
    } catch (failure) {
      setError(errorMessage(failure))
    } finally {
      setBusy(false)
    }
  }

  return { decks, status, ready, busy, error, notice, verify, identified, edit, exchange }
}
