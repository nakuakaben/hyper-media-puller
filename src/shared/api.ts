import type { AddJobsResult, AppSettings, ConnectionResult, HyperDeckSearchProgress, HyperDeckSearchRequest, HyperDeckSearchStarted, LogEntry, MediaEntry, NetworkInterfaceInfo, QueueOptions, QueueSnapshot, QueueSource, RecorderConfig, ScanRequest } from "./types";

export interface HyperdeckApi {
  getSettings: () => Promise<AppSettings>;
  saveSettings: (settings: AppSettings) => Promise<AppSettings>;
  testRecorder: (recorder: RecorderConfig) => Promise<ConnectionResult>;
  scanMedia: (request: ScanRequest) => Promise<MediaEntry[]>;
  chooseDestination: () => Promise<string>;
  addJobs: (sources: QueueSource[], options: QueueOptions) => Promise<AddJobsResult>;
  startQueue: () => Promise<QueueSnapshot>;
  pauseQueue: () => Promise<QueueSnapshot>;
  cancelJob: (jobId: string) => Promise<QueueSnapshot>;
  retryJob: (jobId: string) => Promise<QueueSnapshot>;
  clearFinished: () => Promise<QueueSnapshot>;
  getQueue: () => Promise<QueueSnapshot>;
  getLogs: () => Promise<LogEntry[]>;
  getNetworkInterfaces: () => Promise<NetworkInterfaceInfo[]>;
  startHyperDeckSearch: (request: HyperDeckSearchRequest) => Promise<HyperDeckSearchStarted>;
  cancelHyperDeckSearch: (scanId: string) => Promise<void>;
  onQueueUpdated: (callback: (snapshot: QueueSnapshot) => void) => () => void;
  onLogEntry: (callback: (entry: LogEntry) => void) => () => void;
  onHyperDeckSearchProgress: (callback: (progress: HyperDeckSearchProgress) => void) => () => void;
}
