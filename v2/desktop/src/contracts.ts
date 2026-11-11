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
  list: (recorder: Recorder, path: string) => invoke<Media[]>('list_media', { recorder, path }),
}

export function errorMessage(error: unknown): string {
  if (typeof error === 'object' && error !== null && 'message' in error && typeof error.message === 'string') {
    return error.message
  }
  return typeof error === 'string' ? error : 'La requête a échoué.'
}
