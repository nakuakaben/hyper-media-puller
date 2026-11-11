import { useEffect, useRef, useState } from 'react'
import { bridge, errorMessage, offload, schemaVersion, type LiveJob, type Queue, type TransferSettings } from './contracts'

export type Rate = { bytesPerSecond: number; secondsLeft?: number }

function rateFor(job: LiveJob, previous: LiveJob | undefined, elapsed: number): Rate | undefined {
  if (!previous || elapsed <= 0 || job.status !== 'running' || previous.status !== 'running' || job.attempt_id !== previous.attempt_id) return
  const written = BigInt(job.progress.written)
  const delta = written - BigInt(previous.progress.written)
  if (delta <= 0n) return
  const bytesPerSecond = Math.floor(Number(delta) * 1000 / elapsed)
  if (!Number.isSafeInteger(bytesPerSecond) || bytesPerSecond <= 0) return
  const remaining = job.progress.total === null ? undefined : BigInt(job.progress.total) - written
  return { bytesPerSecond, secondsLeft: remaining !== undefined && remaining > 0n ? Math.ceil(Number(remaining) / bytesPerSecond) : undefined }
}

export function useOffload() {
  const [settings, setSettings] = useState<TransferSettings>()
  const [queue, setQueue] = useState<Queue>()
  const [rates, setRates] = useState<Record<string, Rate>>({})
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const [connectionError, setConnectionError] = useState('')
  const lock = useRef(false)
  const sampled = useRef<{ queue: Queue; timestamp: number }>()
  const initial = useRef(false)

  useEffect(() => {
    if (!bridge.native) return
    let mounted = true
    offload.settings().then(value => {
      if (mounted && !initial.current) {
        initial.current = true
        if (value.schema_version !== schemaVersion) throw new Error('Version des paramètres inconnue')
        setSettings(value)
      }
    }).catch(error => { if (mounted) setFeedback(errorMessage(error)) })
    let timer: number
    async function poll() {
      try {
        const next = await offload.queue()
        if (!mounted) return
        if (next.schema_version !== schemaVersion) throw new Error('Version de file inconnue')
        const timestamp = performance.now()
        const previous = sampled.current
        const byId = new Map(previous?.queue.jobs.map(job => [job.id, job]))
        const nextRates: Record<string, Rate> = {}
        if (previous) {
          for (const job of next.jobs) {
            const rate = rateFor(job, byId.get(job.id), timestamp - previous.timestamp)
            if (rate) nextRates[job.id] = rate
          }
        }
        sampled.current = { queue: next, timestamp }
        setRates(nextRates)
        setQueue(next)
        setConnectionError('')
      } catch (error) {
        if (mounted) {
          sampled.current = undefined
          setRates({})
          setConnectionError(errorMessage(error))
        }
      } finally {
        if (mounted) timer = window.setTimeout(poll, 450)
      }
    }
    void poll()
    return () => { mounted = false; window.clearTimeout(timer) }
  }, [])

  async function perform<T>(operation: () => Promise<T>): Promise<T | undefined> {
    if (lock.current) return
    lock.current = true
    setBusy(true)
    setFeedback('')
    try { return await operation() }
    catch (error) { setFeedback(errorMessage(error)); return undefined }
    finally { lock.current = false; setBusy(false) }
  }

  async function choose() {
    const value = await perform(offload.destination)
    if (value) setSettings(value)
  }

  return { settings, setSettings, queue, rates, busy, feedback, connectionError, perform, choose }
}
