import path from "node:path";
import log from "electron-log/main";
import { app, BrowserWindow } from "electron";
import { ipcChannels } from "../shared/ipc";
import type { LogEntry } from "../shared/types";

const entries: LogEntry[] = [];

export function initLogger(): void {
  log.initialize();
  log.transports.file.resolvePathFn = () => path.join(app.getPath("userData"), "hyperdeck-media-puller.log");
}

export function getLogs(): LogEntry[] {
  return entries.slice(-500);
}

export function writeLog(level: LogEntry["level"], message: string): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message
  };

  entries.push(entry);
  if (entries.length > 1000) {
    entries.shift();
  }

  log[level](message);

  for (const window of BrowserWindow.getAllWindows()) {
    window.webContents.send(ipcChannels.logEntry, entry);
  }
}
