import { randomUUID } from "node:crypto";
import type { MediaEntry, RecorderConfig } from "../shared/types";
import { joinFtpPath, normalizeFtpPath } from "./path-utils";

const mockTree = new Map<string, Array<{ name: string; size: number | null; isDirectory: boolean; daysAgo: number }>>([
  [
    "/",
    [
      { name: "1", size: null, isDirectory: true, daysAgo: 0 },
      { name: "2", size: null, isDirectory: true, daysAgo: 0 }
    ]
  ],
  [
    "/1",
    [
      { name: "SIM_MEDIA_001.mov", size: 2_850_000_000, isDirectory: false, daysAgo: 1 },
      { name: "SIM_MEDIA_002.mov", size: 3_125_000_000, isDirectory: false, daysAgo: 1 },
      { name: "TAKES", size: null, isDirectory: true, daysAgo: 1 }
    ]
  ],
  [
    "/1/TAKES",
    [
      { name: "SIM_TAKE_001.mov", size: 1_430_000_000, isDirectory: false, daysAgo: 1 },
      { name: "SIM_TAKE_002.mov", size: 1_520_000_000, isDirectory: false, daysAgo: 1 }
    ]
  ],
  [
    "/2",
    [
      { name: "SIM_CARD2_001.mov", size: 910_000_000, isDirectory: false, daysAgo: 2 },
      { name: "SIM_CARD2_002.mov", size: 1_180_000_000, isDirectory: false, daysAgo: 2 }
    ]
  ]
]);

function entry(recorder: RecorderConfig, basePath: string, item: { name: string; size: number | null; isDirectory: boolean; daysAgo: number }): MediaEntry {
  const modified = new Date(Date.now() - item.daysAgo * 86_400_000);
  return {
    id: randomUUID(),
    recorderId: recorder.id,
    name: item.name,
    path: joinFtpPath(basePath, item.name),
    size: item.size,
    modifiedAt: modified.toISOString(),
    isDirectory: item.isDirectory
  };
}

export async function mockScanMedia(recorder: RecorderConfig, sourcePath: string): Promise<MediaEntry[]> {
  const normalizedPath = normalizeFtpPath(sourcePath);
  await new Promise((resolve) => setTimeout(resolve, 250));
  return (mockTree.get(normalizedPath) ?? []).map((item) => entry(recorder, normalizedPath, item));
}

export async function mockListFilesRecursive(recorder: RecorderConfig, sourcePath: string): Promise<MediaEntry[]> {
  const files: MediaEntry[] = [];

  async function walk(currentPath: string): Promise<void> {
    const entries = await mockScanMedia(recorder, currentPath);
    for (const item of entries) {
      if (item.isDirectory) {
        await walk(item.path);
      } else {
        files.push(item);
      }
    }
  }

  await walk(normalizeFtpPath(sourcePath));
  return files;
}

export async function mockDownloadFile(
  size: number | null,
  onProgress: (bytes: number) => void,
  registerCancel: (cancel: () => void) => void
): Promise<void> {
  let cancelled = false;
  registerCancel(() => {
    cancelled = true;
  });

  const total = size ?? 120_000_000;
  const steps = 20;
  for (let index = 1; index <= steps; index += 1) {
    if (cancelled) {
      throw new Error("Copy cancelled");
    }
    await new Promise((resolve) => setTimeout(resolve, 120));
    onProgress(Math.floor((total / steps) * index));
  }
}
