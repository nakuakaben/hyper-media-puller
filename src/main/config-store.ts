import fs from "node:fs/promises";
import path from "node:path";
import { app } from "electron";
import { randomUUID } from "node:crypto";
import type { AppSettings, RecorderConfig } from "../shared/types";
import { writeLog } from "./logger";

const checksumModes = new Set<AppSettings["checksumMode"]>(["none", "md5", "sha256", "both"]);

const defaultSettings: AppSettings = {
  recorders: [],
  lastRecorderId: "",
  lastDestination: "",
  destinationMode: "recorderDate",
  duplicatePolicy: "rename",
  concurrency: 2,
  avoidSameRecorder: true,
  checksumMode: "md5",
  mockMode: false
};

function settingsPath(): string {
  return path.join(app.getPath("userData"), "settings.json");
}

function normalizeRecorder(recorder: Partial<RecorderConfig>): RecorderConfig {
  return {
    id: recorder.id || randomUUID(),
    name: recorder.name?.trim() || "HyperDeck",
    model: recorder.model?.trim() || "",
    host: recorder.host?.trim() || "",
    port: Number.isFinite(recorder.port) ? Number(recorder.port) : 21,
    user: recorder.user?.trim() || "anonymous",
    password: recorder.password ?? ""
  };
}

export async function loadSettings(): Promise<AppSettings> {
  try {
    const raw = await fs.readFile(settingsPath(), "utf8");
    const parsed = JSON.parse(raw) as Partial<AppSettings>;
    const mockWasEnabled = parsed.mockMode === true;

    const loaded: AppSettings = {
      ...defaultSettings,
      ...parsed,
      recorders: Array.isArray(parsed.recorders) ? parsed.recorders.map(normalizeRecorder) : [],
      lastRecorderId: parsed.lastRecorderId ?? "",
      concurrency: Math.max(1, Number(parsed.concurrency ?? defaultSettings.concurrency)),
      duplicatePolicy: parsed.duplicatePolicy ?? defaultSettings.duplicatePolicy,
      destinationMode: parsed.destinationMode ?? defaultSettings.destinationMode,
      checksumMode: checksumModes.has(parsed.checksumMode ?? "md5") ? parsed.checksumMode ?? "md5" : defaultSettings.checksumMode,
      mockMode: false
    };

    if (mockWasEnabled) {
      writeLog("warn", "Mock/dev mode was enabled in saved settings and has been migrated to false for production startup.");
      await saveSettings(loaded);
    } else {
      writeLog("info", "Mock/dev mode loaded: false.");
    }

    return loaded;
  } catch {
    writeLog("info", "No saved settings found. Mock/dev mode default: false.");
    return defaultSettings;
  }
}

export async function saveSettings(settings: AppSettings): Promise<AppSettings> {
  const normalized: AppSettings = {
    ...defaultSettings,
    ...settings,
    recorders: settings.recorders.map(normalizeRecorder),
    lastRecorderId: settings.lastRecorderId ?? "",
    concurrency: Math.max(1, Number(settings.concurrency || defaultSettings.concurrency)),
    checksumMode: checksumModes.has(settings.checksumMode) ? settings.checksumMode : defaultSettings.checksumMode
  };

  await fs.mkdir(app.getPath("userData"), { recursive: true });
  await fs.writeFile(settingsPath(), JSON.stringify(normalized, null, 2), "utf8");
  return normalized;
}
