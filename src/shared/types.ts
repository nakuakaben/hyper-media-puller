export type DuplicatePolicy = "overwrite" | "rename" | "skip" | "ask";
export type ChecksumMode = "none" | "md5" | "sha256" | "both";
export type JobStatus = "pending" | "running" | "verifying" | "verified" | "done" | "skipped" | "checksum-error" | "error" | "cancelled";

export interface RecorderConfig {
  id: string;
  name: string;
  model?: string;
  host: string;
  port: number;
  user: string;
  password: string;
}

export interface AppSettings {
  recorders: RecorderConfig[];
  lastRecorderId: string;
  lastDestination: string;
  destinationMode: "direct" | "recorder" | "recorderDate";
  duplicatePolicy: DuplicatePolicy;
  concurrency: number;
  avoidSameRecorder: boolean;
  checksumMode: ChecksumMode;
  mockMode: boolean;
}

export interface MediaEntry {
  id: string;
  recorderId: string;
  name: string;
  path: string;
  size: number | null;
  modifiedAt: string | null;
  isDirectory: boolean;
}

export interface ScanRequest {
  recorderId: string;
  path: string;
}

export interface QueueSource {
  recorderId: string;
  sourcePath: string;
  isDirectory: boolean;
  size: number | null;
}

export interface QueueOptions {
  destinationRoot: string;
  destinationMode: AppSettings["destinationMode"];
  duplicatePolicy: DuplicatePolicy;
  checksumMode?: ChecksumMode;
}

export interface ChecksumResult {
  mode: ChecksumMode;
  md5?: string;
  sha256?: string;
  verified?: boolean;
  error?: string;
}

export interface CopyJob {
  id: string;
  recorderId: string;
  recorderName: string;
  sourcePath: string;
  destinationPath: string;
  size: number | null;
  transferred: number;
  speedBytesPerSecond: number;
  etaSeconds: number | null;
  status: JobStatus;
  checksum?: ChecksumResult;
  error?: string;
  createdAt: string;
  startedAt?: string;
  finishedAt?: string;
}

export interface QueueSnapshot {
  jobs: CopyJob[];
  running: boolean;
  paused: boolean;
  totalBytes: number;
  transferredBytes: number;
  progressPercent: number | null;
}

export interface LogEntry {
  timestamp: string;
  level: "info" | "warn" | "error";
  message: string;
}

export interface ConnectionResult {
  ok: boolean;
  message: string;
}

export interface AddJobsResult {
  added: number;
  skipped: number;
}

export interface NetworkInterfaceInfo {
  id: string;
  name: string;
  label: string;
  address: string;
  netmask: string;
  cidr: string;
  family: "IPv4";
  kind: "ethernet" | "wifi" | "other";
}

export type HyperDeckSearchStatus = "detected" | "ftp-ok" | "ftp-error" | "already-added" | "unknown";

export interface HyperDeckSearchResult {
  ip: string;
  name: string;
  model: string;
  hyperdeckPortOpen: boolean;
  ftpPortOpen: boolean;
  status: HyperDeckSearchStatus;
  alreadyAdded: boolean;
  hyperdeckConfirmed: boolean;
  protocolSummary: string;
  ftpMessage: string;
  error?: string;
}

export interface HyperDeckSearchProgress {
  scanId: string;
  status: "running" | "done" | "cancelled" | "error";
  scanned: number;
  total: number;
  candidates: number;
  confirmed: number;
  message: string;
  results: HyperDeckSearchResult[];
}

export interface HyperDeckSearchRequest {
  interfaceId: string;
  cidr: string;
  timeoutMs: number;
  concurrency: number;
  knownRecorders: RecorderConfig[];
}

export interface HyperDeckSearchStarted {
  scanId: string;
}
