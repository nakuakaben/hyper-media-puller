import { invoke, isTauri } from '@tauri-apps/api/core'

export type Recorder = { id: string; name: string; host: string; port: number }
export type Deck = { recorder: Recorder; model: string }
export type Media = { recorder_id: string; remote_path: string; size: string | null; directory: boolean }
export type Duplicate = 'rename' | 'skip' | 'overwrite'
export type Checksum = 'none' | 'md5' | 'sha256' | 'both'
export type Status = 'pending' | 'running' | 'verifying' | 'finalizing' | 'done' | 'verified' | 'skipped' | 'error' | 'checksum_error' | 'cancelled'
export type Phase = 'planning' | 'connecting' | 'copying' | 'verifying' | 'finalizing'
export type Progress = { received: string; written: string; verified: string; total: string | null }
export type TransferError = { code: string; phase: Phase; message: string; retryable: boolean; protocol_code: number | null }
export type PreviewInfo = { version: string; schema_version: number; profile: string }
export type Job = {
  id: string
  recorder_id: string
  remote_path: string
  requested_destination: string
  status: Status
  progress: Progress
  error: TransferError | null
}
export const bridge = {
  native: isTauri(),
  info: () => invoke<PreviewInfo>('preview_info'),
  identify: (host: string) => invoke<Deck>('identify_deck', { host }),
  list: (recorderId: string, path: string) => invoke<Media[]>('list_media', { recorderId, path }),
}

export function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return typeof error === 'string' ? error : 'La requête a échoué.'
}

export const schemaVersion = 1
export type TransferOptions = {
  batch: { duplicate: Duplicate; checksum: Checksum }
  global_limit: number
  recorder_limit: number
}
export type TransferSettings = {
  schema_version: number
  destination: string | null
  available: string | null
  options: TransferOptions
}
export type ChecksumResult = {
  scope: 'local_only' | 'transfer_stream_compared_to_local'
  md5: string | null
  sha256: string | null
  bytes_covered: string
}
export type LiveJob = Job & {
  batch_id: string
  attempt_id: string
  destination: string | null
  partial_hint: string
  checksum: ChecksumResult | null
  history: { id: string; status: Status; progress: Progress; error: TransferError | null }[]
}
export type Batch = { id: string; jobs: string[]; started: boolean; options: TransferOptions['batch'] }
export type BatchDetails = {
  id: string; destination: string; staging: string; options: TransferOptions; created_at_millis: string
}
export type Queue = {
  schema_version: number
  sequence: string
  active: number
  shutting_down: boolean
  batches: Batch[]
  jobs: LiveJob[]
  destinations: BatchDetails[]
  recorders: Record<string, string>
}
export type Report = {
  schema_version: number
  batch: BatchDetails
  elapsed_millis: string
  generated_at_millis: string
  jobs: {
    source: Recorder
    transfer: LiveJob
    started_at_millis: string | null
    ended_at_millis: string | null
    elapsed_millis: string | null
  }[]
}
export type TransferAction = 'start' | 'pause' | 'cancel' | 'retry'

export const offload = {
  settings: () => invoke<TransferSettings>('transfer_settings'),
  destination: () => invoke<TransferSettings | null>('choose_destination'),
  saveOptions: (options: TransferOptions) => invoke<TransferSettings>('save_transfer_options', { schemaVersion, options }),
  enqueue: (recorderId: string, paths: string[], options: TransferOptions) => invoke<string>('enqueue_transfer', {
    request: { schema_version: schemaVersion, recorder_id: recorderId, paths, options },
  }),
  queue: () => invoke<Queue>('transfer_queue'),
  action: (action: TransferAction, id: string) => invoke<void>('transfer_action', { schemaVersion, action, id }),
  report: (batchId: string) => invoke<Report>('transfer_report', { batchId }),
}

export const terminal = (status: Status) => ['done', 'verified', 'skipped', 'error', 'checksum_error', 'cancelled'].includes(status)
export const scopeLabel = (scope: ChecksumResult['scope']) => scope === 'local_only'
  ? 'Empreinte locale' : 'Flux reçu comparé à sa relecture locale'
