import type { Deck, Job, Media, Status } from './contracts'

export const demoDecks: Deck[] = [
  { recorder: { id: 'mini', name: 'Régie A', host: '192.0.2.21', port: 21 }, model: 'HyperDeck Studio HD Mini' },
  { recorder: { id: 'pro', name: 'Régie B', host: '192.0.2.22', port: 21 }, model: 'HyperDeck Studio 4K Pro' },
  { recorder: { id: 'plus', name: 'Plateau', host: '192.0.2.23', port: 21 }, model: 'HyperDeck Studio HD Plus' },
  { recorder: { id: 'legacy', name: 'Secours', host: '192.0.2.24', port: 21 }, model: 'HyperDeck Studio Mini (2017)' },
]

const demoFiles = [
  ['A001_C001_Interview_ouverture.mov', '5368709120'],
  ['A001_C002_Plan_large.mov', '2952790016'],
  ['A001_C003_Équipe_東京.mov', '1911260447'],
  ['A001_C004_Deuxième_prise.mov', '3865470566'],
  ['A001_C005_Générique.mov', '724775731'],
  ['A001_C006_Plans_de_coupe_Caméra_A_séquence_finale_étalonnage.mov', '4853313044'],
  ['A001_C007_Ambiance #1.mov', null],
  ['A001_C008_Clôture.mov', '1342177280'],
] as const

export function listDemo(id: string, path: string): Media[] {
  if (id === 'legacy') throw new Error('Appareil de démonstration hors ligne.')
  if (id === 'plus') throw new Error('FTP 550 · Le volume de démonstration est indisponible.')
  const folder = (remote_path: string): Media => ({ recorder_id: id, remote_path, size: null, directory: true })
  if (path === '/') return id === 'mini' ? [folder('/1'), folder('/2')] : [folder('/1')]
  if (path === '/2') return []
  if (path !== '/1') throw new Error('FTP 550 · Dossier de démonstration introuvable.')
  return demoFiles.map(([name, size]) => ({
    recorder_id: id,
    remote_path: '/1/' + (id === 'pro' ? name.replace(/^A/, 'B') : name),
    size,
    directory: false,
  }))
}

export function demoJob(entry: Media, id: string, status: Status = 'pending', copied = 0, verified = 0): Job {
  const fraction = (percent: number) => entry.size === null ? '0' : String(BigInt(entry.size) * BigInt(percent) / 100n)
  return {
    id,
    recorder_id: entry.recorder_id,
    remote_path: entry.remote_path,
    requested_destination: entry.remote_path.split('/').at(-1) ?? '',
    status,
    progress: { received: fraction(copied), written: fraction(copied), verified: fraction(verified), total: entry.size },
    error: status === 'error' ? {
      code: 'timeout', phase: 'copying', message: 'Délai de lecture FTP dépassé (scénario de démonstration).',
      retryable: true, protocol_code: null,
    } : null,
  }
}

export const initialJobs: Job[] = [
  demoJob(listDemo('mini', '/1')[0], 'demo-1', 'running', 62),
  demoJob(listDemo('pro', '/1')[1], 'demo-2', 'verifying', 100, 38),
  demoJob(listDemo('mini', '/1')[2], 'demo-3', 'pending'),
  demoJob(listDemo('pro', '/1')[3], 'demo-4', 'error', 21),
]

export function percent(part: string, total: string | null): number | null {
  if (total === null) return null
  if (total === '0') return 100
  return Number(BigInt(part) * 100n / BigInt(total))
}

export function formatBytes(value: string | null): string {
  if (value === null) return '—'
  const bytes = BigInt(value)
  const units = ['o', 'Kio', 'Mio', 'Gio', 'Tio', 'Pio', 'Eio']
  let divisor = 1n
  let unit = 0
  while (bytes >= divisor * 1024n && unit < units.length - 1) {
    divisor *= 1024n
    unit++
  }
  return unit === 0 ? bytes + ' o' : (Number(bytes * 10n / divisor) / 10).toLocaleString('fr-FR') + ' ' + units[unit]
}

export function advanceDemo(jobs: Job[], concurrency: number): Job[] {
  const active = new Set(jobs.filter(job => job.status === 'running' || job.status === 'verifying').map(job => job.recorder_id))
  let running = jobs.filter(job => job.status === 'running' || job.status === 'verifying').length
  return jobs.map(job => {
    const total = job.progress.total
    if (job.status === 'pending' && running < concurrency && !active.has(job.recorder_id)) {
      running++
      active.add(job.recorder_id)
      return { ...job, status: 'running' }
    }
    if (job.status === 'running') {
      if (total === null) return { ...job, status: 'done' }
      const copied = BigInt(job.progress.written) + (BigInt(total) + 3n) / 4n
      const complete = copied >= BigInt(total)
      const written = complete ? total : String(copied)
      return { ...job, status: complete ? 'verifying' : 'running', progress: { ...job.progress, received: written, written } }
    }
    if (job.status === 'verifying' && total !== null) {
      const checked = BigInt(job.progress.verified) + (BigInt(total) + 1n) / 2n
      const complete = checked >= BigInt(total)
      return { ...job, status: complete ? 'done' : 'verifying', progress: { ...job.progress, verified: complete ? total : String(checked) } }
    }
    return job
  })
}
