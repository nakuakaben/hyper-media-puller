import { contextBridge, ipcRenderer } from "electron";
import { ipcChannels } from "../shared/ipc";
import type { HyperdeckApi } from "../shared/api";
import type { HyperDeckSearchProgress, LogEntry, QueueSnapshot } from "../shared/types";

const api: HyperdeckApi = {
  getSettings: () => ipcRenderer.invoke(ipcChannels.getSettings),
  saveSettings: (settings) => ipcRenderer.invoke(ipcChannels.saveSettings, settings),
  testRecorder: (recorder) => ipcRenderer.invoke(ipcChannels.testRecorder, recorder),
  scanMedia: (request) => ipcRenderer.invoke(ipcChannels.scanMedia, request),
  chooseDestination: () => ipcRenderer.invoke(ipcChannels.chooseDestination),
  addJobs: (sources, options) => ipcRenderer.invoke(ipcChannels.addJobs, { sources, options }),
  startQueue: () => ipcRenderer.invoke(ipcChannels.startQueue),
  pauseQueue: () => ipcRenderer.invoke(ipcChannels.pauseQueue),
  cancelJob: (jobId) => ipcRenderer.invoke(ipcChannels.cancelJob, jobId),
  retryJob: (jobId) => ipcRenderer.invoke(ipcChannels.retryJob, jobId),
  clearFinished: () => ipcRenderer.invoke(ipcChannels.clearFinished),
  getQueue: () => ipcRenderer.invoke(ipcChannels.getQueue),
  getLogs: () => ipcRenderer.invoke(ipcChannels.getLogs),
  getNetworkInterfaces: () => ipcRenderer.invoke(ipcChannels.getNetworkInterfaces),
  startHyperDeckSearch: (request) => ipcRenderer.invoke(ipcChannels.startHyperDeckSearch, request),
  cancelHyperDeckSearch: (scanId) => ipcRenderer.invoke(ipcChannels.cancelHyperDeckSearch, scanId),
  onQueueUpdated: (callback: (snapshot: QueueSnapshot) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, snapshot: QueueSnapshot) => callback(snapshot);
    ipcRenderer.on(ipcChannels.queueUpdated, listener);
    return () => ipcRenderer.removeListener(ipcChannels.queueUpdated, listener);
  },
  onLogEntry: (callback: (entry: LogEntry) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, entry: LogEntry) => callback(entry);
    ipcRenderer.on(ipcChannels.logEntry, listener);
    return () => ipcRenderer.removeListener(ipcChannels.logEntry, listener);
  },
  onHyperDeckSearchProgress: (callback: (progress: HyperDeckSearchProgress) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, progress: HyperDeckSearchProgress) => callback(progress);
    ipcRenderer.on(ipcChannels.hyperDeckSearchProgress, listener);
    return () => ipcRenderer.removeListener(ipcChannels.hyperDeckSearchProgress, listener);
  }
};

contextBridge.exposeInMainWorld("hyperdeck", api);
