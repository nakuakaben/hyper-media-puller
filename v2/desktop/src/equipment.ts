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

  async function verify(deck: SavedDeck, acceptUnidentified = false) {
    const id = deck.recorder.id
    if (checking.current.has(id)) return
    const request = Symbol()
    checking.current.set(id, request)
    setStatus(previous => ({ ...previous, [id]: 'checking' }))
    try {
      const result = await equipment.verify(id, acceptUnidentified)
      if (checking.current.get(id) === request) setStatus(previous => ({ ...previous, [id]: result }))
    } catch (failure) {
      if (checking.current.get(id) !== request) return
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
      setDecks(saved)
      setReady(true)
      // Limit background probes when importing a large prestation.
      void verifyAll(saved)
    }).catch(failure => { if (active) setError(errorMessage(failure)) })
    return () => { active = false }
  }, [])

  async function verifyAll(saved: SavedDeck[]) {
    setStatus(previous => ({ ...previous, ...Object.fromEntries(saved.map(deck => [deck.recorder.id, 'checking'])) }))
    for (let index = 0; index < saved.length; index += 8) {
      await Promise.all(saved.slice(index, index + 8).map(deck => verify(deck)))
    }
  }

  function identified({ deck, connection }: Identified) {
    const id = deck.recorder.id
    checking.current.delete(id)
    setDecks(previous => previous.some(item => item.recorder.id === id)
      ? previous.map(item => item.recorder.id === id ? deck : item)
      : [...previous, deck])
    setStatus(previous => ({ ...previous, [id]: connection }))
  }

  async function edit(change: RecorderEdit) {
    setBusy(true)
    try {
      const updated = await equipment.edit(change)
      if (change.action === 'remove') checking.current.delete(change.id)
      if (change.action === 'reset') checking.current.clear()
      setDecks(updated)
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
        setDecks(previous => [...previous, ...result.added])
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
