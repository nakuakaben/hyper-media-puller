import { AlertCircle, Circle, CircleCheck, LoaderCircle, type LucideIcon } from 'lucide-react'
import { useRef, type CSSProperties, type ReactNode } from 'react'
import type { Job, Status } from './contracts'
import { percent } from './demo'

export function Panel({ title, icon: Icon, meta, actions, children, className = '' }: {
  title: string; icon?: LucideIcon; meta?: string; actions?: ReactNode; children: ReactNode; className?: string
}) {
  return <section className={'panel ' + className} aria-label={title}>
    <header className="panel-head">
      {Icon && <Icon size={15} aria-hidden="true" />}
      <h2>{title}</h2>{meta && <span className="panel-meta">{meta}</span>}
      {actions && <div className="panel-actions">{actions}</div>}
    </header>
    {children}
  </section>
}

export function Empty({ icon: Icon = Circle, title, children }: { icon?: LucideIcon; title: string; children?: ReactNode }) {
  return <div className="empty" role="status"><Icon size={22} aria-hidden="true" /><strong>{title}</strong>{children && <div>{children}</div>}</div>
}

export const statuses: Record<Status, { label: string; tone: string }> = {
  pending: { label: 'En attente', tone: 'neutral' },
  running: { label: 'Copie', tone: 'info' },
  verifying: { label: 'Vérification', tone: 'info' },
  finalizing: { label: 'Finalisation', tone: 'info' },
  done: { label: 'Terminé', tone: 'ok' },
  verified: { label: 'Vérifié', tone: 'ok' },
  skipped: { label: 'Ignoré', tone: 'neutral' },
  error: { label: 'Erreur FTP', tone: 'error' },
  checksum_error: { label: 'Erreur checksum', tone: 'error' },
  cancelled: { label: 'Annulé', tone: 'neutral' },
}

export function Badge({ label, tone = 'neutral' }: { label: string; tone?: string }) {
  const Icon = tone === 'ok' ? CircleCheck : tone === 'error' || tone === 'warn' ? AlertCircle : Circle
  return <span className={'badge ' + tone}><Icon size={11} aria-hidden="true" />{label}</span>
}

export function Loading({ title }: { title: string }) {
  return <div className="empty" role="status"><LoaderCircle size={22} className="spinner" aria-hidden="true" /><strong>{title}</strong></div>
}

export function ProgressCell({ job, phase }: { job: Job; phase: 'copy' | 'verify' }) {
  const isCopy = phase === 'copy'
  const label = isCopy ? 'Copie' : 'Vérification'
  const value = isCopy ? job.progress.written : job.progress.verified
  if (!isCopy && value === '0' && job.status !== 'verifying' && job.status !== 'verified') return <span className="muted">—</span>
  const amount = percent(value, job.progress.total)
  const indeterminate = amount === null && job.status === (isCopy ? 'running' : 'verifying')
  return <div className={'progress-cell' + (isCopy ? '' : ' verify')}>
    <progress aria-label={label} max={100} value={indeterminate ? undefined : amount ?? 0} />
    <span>{amount === null ? '—' : amount + ' %'}</span>
  </div>
}

export function Splitter({ axis, label, value, min, max, reverse = false, onChange }: {
  axis: 'x' | 'y'; label: string; value: number; min: number; max: number; reverse?: boolean; onChange: (n: number) => void
}) {
  const drag = useRef<{ start: number; value: number } | null>(null)
  const direction = reverse ? -1 : 1
  const coord = (event: { clientX: number; clientY: number }) => axis === 'x' ? event.clientX : event.clientY
  const clamp = (n: number) => onChange(Math.round(Math.max(min, Math.min(max, n))))
  return <div className={'splitter ' + axis} role="separator" aria-orientation={axis === 'x' ? 'vertical' : 'horizontal'}
    aria-label={label} aria-valuemin={min} aria-valuemax={max} aria-valuenow={value} tabIndex={0}
    onPointerDown={event => {
      if (event.button !== 0) return
      drag.current = { start: coord(event), value }
      event.currentTarget.setPointerCapture(event.pointerId)
    }}
    onPointerMove={event => {
      if (drag.current) clamp(drag.current.value + (coord(event) - drag.current.start) * direction)
    }}
    onLostPointerCapture={() => { drag.current = null }}
    onKeyDown={event => {
      const step = axis === 'x' ? ['ArrowLeft', 'ArrowRight'] : ['ArrowUp', 'ArrowDown']
      if (![...step, 'Home', 'End'].includes(event.key)) return
      event.preventDefault()
      clamp(event.key === 'Home' ? min : event.key === 'End' ? max : value + (event.key === step[1] ? 8 : -8) * direction)
    }} />
}

export type Layout = { left: number; right: number; queue: number }
export const defaultLayout: Layout = { left: 258, right: 298, queue: 228 }
export const layoutStyle = (layout: Layout) => ({
  '--left': layout.left + 'px', '--right': layout.right + 'px', '--queue': layout.queue + 'px',
}) as CSSProperties
