import { dialog, ipcMain, BrowserWindow } from "electron";
import { ipcChannels } from "../shared/ipc";
import type { AppSettings, QueueOptions, QueueSource, RecorderConfig, ScanRequest } from "../shared/types";
import { loadSettings, saveSettings } from "./config-store";
import { scanMedia, testConnection } from "./ftp-service";
import { mockScanMedia } from "./mock-service";
import { QueueService } from "./queue-service";
import { writeLog, getLogs } from "./logger";
import { getNetworkInterfaces, startHyperDeckSearch } from "./network-service";
import { normalizeFtpPath } from "./path-utils";

let settingsCache: AppSettings | null = null;

async function getSettings(): Promise<AppSettings> {
  if (!settingsCache) {
    settingsCache = await loadSettings();
  }
  return settingsCache;
}

function findRecorder(settings: AppSettings, recorderId: string): RecorderConfig {
  const recorder = settings.recorders.find((item) => item.id === recorderId);
  if (!recorder) {
    throw new Error("Recorder not found.");
  }
  return recorder;
}

export function registerIpc(mainWindow: BrowserWindow): void {
  const queue = new QueueService(getSettings);
  const activeScans = new Map<string, () => void>();
  queue.setSnapshotListener((snapshot) => {
    mainWindow.webContents.send(ipcChannels.queueUpdated, snapshot);
  });

  ipcMain.handle(ipcChannels.getSettings, async () => getSettings());

  ipcMain.handle(ipcChannels.saveSettings, async (_event, settings: AppSettings) => {
    settingsCache = await saveSettings(settings);
    writeLog("info", "Settings saved.");
    return settingsCache;
  });

  ipcMain.handle(ipcChannels.testRecorder, async (_event, recorder: RecorderConfig) => {
    try {
      const settings = await getSettings();
      if (settings.mockMode) {
        writeLog("info", `Mock connection OK: ${recorder.name}`);
        return { ok: true, message: "Mode mock actif : connexion simulée." };
      }

      const result = await testConnection(recorder);
      writeLog("info", `FTP connection OK: ${recorder.name} (${recorder.host}:${recorder.port})`);
      return {
        ok: true,
        message: result.legacyMode
          ? "Connexion FTP réussie. Mode legacy FTP utilisé."
          : "Connexion FTP réussie."
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeLog("error", `FTP connection failed for ${recorder.name}: ${message}`);
      return { ok: false, message };
    }
  });

  ipcMain.handle(ipcChannels.scanMedia, async (_event, request: ScanRequest) => {
    try {
      const settings = await getSettings();
      const recorder = findRecorder(settings, request.recorderId);
      const scanPath = normalizeFtpPath(request.path);
      writeLog("info", `Scan started: ${scanPath}`);
      const entries = settings.mockMode ? await mockScanMedia(recorder, scanPath) : await scanMedia(recorder, scanPath);
      writeLog("info", `Scan completed: ${scanPath} (${entries.length} item(s))`);
      return entries;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeLog("error", `FTP scan error: ${message}`);
      throw error;
    }
  });

  ipcMain.handle(ipcChannels.chooseDestination, async () => {
    const result = await dialog.showOpenDialog(mainWindow, {
      title: "Choisir le dossier destination",
      properties: ["openDirectory", "createDirectory"]
    });

    if (result.canceled || result.filePaths.length === 0) {
      return "";
    }

    const selected = result.filePaths[0] ?? "";
    const settings = await getSettings();
    settingsCache = await saveSettings({ ...settings, lastDestination: selected });
    return selected;
  });

  ipcMain.handle(ipcChannels.addJobs, async (_event, payload: { sources: QueueSource[]; options: QueueOptions }) => {
    const settings = await getSettings();
    if (!payload.options.destinationRoot) {
      throw new Error("Destination folder is required before queueing copy jobs.");
    }
    return queue.addJobs(settings.recorders, payload.sources, payload.options);
  });

  ipcMain.handle(ipcChannels.startQueue, async () => {
    const settings = await getSettings();
    queue.start(settings.recorders);
    return queue.snapshot();
  });

  ipcMain.handle(ipcChannels.pauseQueue, async () => {
    queue.pause();
    return queue.snapshot();
  });

  ipcMain.handle(ipcChannels.cancelJob, async (_event, jobId: string) => {
    queue.cancelJob(jobId);
    return queue.snapshot();
  });

  ipcMain.handle(ipcChannels.retryJob, async (_event, jobId: string) => {
    queue.retryJob(jobId);
    return queue.snapshot();
  });

  ipcMain.handle(ipcChannels.clearFinished, async () => {
    queue.clearFinished();
    return queue.snapshot();
  });

  ipcMain.handle(ipcChannels.getQueue, async () => queue.snapshot());
  ipcMain.handle(ipcChannels.getLogs, async () => getLogs());
  ipcMain.handle(ipcChannels.getNetworkInterfaces, async () => getNetworkInterfaces());

  ipcMain.handle(ipcChannels.startHyperDeckSearch, async (_event, request) => {
    const scan = startHyperDeckSearch(request, (progress) => {
      mainWindow.webContents.send(ipcChannels.hyperDeckSearchProgress, progress);
      if (progress.status === "done" || progress.status === "cancelled" || progress.status === "error") {
        activeScans.delete(progress.scanId);
      }
    });
    activeScans.set(scan.scanId, scan.cancel);
    void scan.done.finally(() => activeScans.delete(scan.scanId));
    return { scanId: scan.scanId };
  });

  ipcMain.handle(ipcChannels.cancelHyperDeckSearch, async (_event, scanId: string) => {
    activeScans.get(scanId)?.();
    activeScans.delete(scanId);
  });
}
