import { createReadStream } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import type { AddJobsResult, AppSettings, ChecksumMode, CopyJob, DuplicatePolicy, JobStatus, MediaEntry, QueueOptions, QueueSnapshot, QueueSource, RecorderConfig } from "../shared/types";
import { buildDestinationPath } from "./path-utils";
import { downloadFile, listFilesRecursive } from "./ftp-service";
import { mockDownloadFile, mockListFilesRecursive } from "./mock-service";
import { writeLog } from "./logger";

type SettingsProvider = () => Promise<AppSettings>;
type SnapshotListener = (snapshot: QueueSnapshot) => void;
type ChecksumAlgorithm = "md5" | "sha256";

function checksumAlgorithms(mode: ChecksumMode): ChecksumAlgorithm[] {
  if (mode === "both") {
    return ["md5", "sha256"];
  }
  if (mode === "md5" || mode === "sha256") {
    return [mode];
  }
  return [];
}

function checksumLabel(algorithm: ChecksumAlgorithm): string {
  return algorithm === "sha256" ? "SHA-256" : "MD5";
}

function checksumFile(filePath: string, algorithm: ChecksumAlgorithm): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash(algorithm);
    const stream = createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.once("error", reject);
    stream.once("end", () => resolve(hash.digest("hex")));
  });
}

export class QueueService {
  private jobs: CopyJob[] = [];
  private running = false;
  private paused = false;
  private activeJobs = new Set<string>();
  private cancelHandlers = new Map<string, () => void>();
  private listener: SnapshotListener | null = null;

  constructor(private readonly getSettings: SettingsProvider) {}

  setSnapshotListener(listener: SnapshotListener): void {
    this.listener = listener;
  }

  snapshot(): QueueSnapshot {
    const totalBytes = this.jobs.reduce((sum, job) => sum + (job.size ?? 0), 0);
    const transferredBytes = this.jobs.reduce((sum, job) => {
      if (job.status === "done" || job.status === "verified" || job.status === "skipped") {
        return sum + (job.size ?? 0);
      }
      return sum + Math.min(job.transferred, job.size ?? job.transferred);
    }, 0);

    return {
      jobs: [...this.jobs],
      running: this.running,
      paused: this.paused,
      totalBytes,
      transferredBytes,
      progressPercent: totalBytes > 0 ? Math.min(100, (transferredBytes / totalBytes) * 100) : null
    };
  }

  async addJobs(recorders: RecorderConfig[], sources: QueueSource[], options: QueueOptions): Promise<AddJobsResult> {
    const settings = await this.getSettings();
    const recorderMap = new Map(recorders.map((recorder) => [recorder.id, recorder]));
    let added = 0;
    let skipped = 0;

    for (const source of sources) {
      const recorder = recorderMap.get(source.recorderId);
      if (!recorder) {
        skipped += 1;
        continue;
      }

      const fileEntries = source.isDirectory
        ? await this.expandDirectory(recorder, source.sourcePath, settings.mockMode)
        : [
            {
              recorderId: recorder.id,
              path: source.sourcePath,
              size: source.size,
              isDirectory: false,
              id: randomUUID(),
              name: path.posix.basename(source.sourcePath),
              modifiedAt: null
            } satisfies MediaEntry
          ];

      for (const file of fileEntries) {
        const destinationPath = buildDestinationPath(options.destinationRoot, recorder.name, file.path, options.destinationMode);
        const checksumMode = options.checksumMode ?? settings.checksumMode;
        this.jobs.push({
          id: randomUUID(),
          recorderId: recorder.id,
          recorderName: recorder.name,
          sourcePath: file.path,
          destinationPath,
          size: file.size,
          transferred: 0,
          speedBytesPerSecond: 0,
          etaSeconds: null,
          status: "pending",
          checksum: { mode: checksumMode },
          createdAt: new Date().toISOString()
        });
        added += 1;
      }
    }

    writeLog("info", `Queue updated: ${added} job(s) added, ${skipped} source(s) skipped.`);
    this.emit();
    return { added, skipped };
  }

  start(recorders: RecorderConfig[]): void {
    if (this.running && !this.paused) {
      return;
    }

    this.running = true;
    this.paused = false;
    writeLog("info", "Queue started.");
    this.emit();
    void this.schedule(recorders);
  }

  pause(): void {
    this.paused = true;
    this.running = false;
    writeLog("info", "Queue paused. Running copies will finish unless cancelled.");
    this.emit();
  }

  cancelJob(jobId: string): void {
    const job = this.jobs.find((item) => item.id === jobId);
    if (!job) {
      return;
    }

    if (job.status === "running" || job.status === "verifying") {
      this.cancelHandlers.get(jobId)?.();
    }

    if (job.status === "pending" || job.status === "running" || job.status === "verifying" || job.status === "checksum-error" || job.status === "error") {
      job.status = "cancelled";
      job.finishedAt = new Date().toISOString();
      writeLog("warn", `Copy cancelled: ${job.sourcePath}`);
      this.emit();
    }
  }

  retryJob(jobId: string): void {
    const job = this.jobs.find((item) => item.id === jobId);
    if (!job || (job.status !== "error" && job.status !== "checksum-error" && job.status !== "cancelled")) {
      return;
    }

    job.status = "pending";
    job.error = undefined;
    job.transferred = 0;
    job.speedBytesPerSecond = 0;
    job.etaSeconds = null;
    job.checksum = { mode: job.checksum?.mode ?? "none" };
    job.startedAt = undefined;
    job.finishedAt = undefined;
    writeLog("info", `Job queued again: ${job.sourcePath}`);
    this.emit();
  }

  clearFinished(): void {
    this.jobs = this.jobs.filter((job) => !["done", "verified", "skipped", "cancelled"].includes(job.status));
    writeLog("info", "Finished jobs cleared.");
    this.emit();
  }

  private async expandDirectory(recorder: RecorderConfig, sourcePath: string, mockMode: boolean): Promise<MediaEntry[]> {
    writeLog("info", `Expanding folder path=${sourcePath} recorder=${recorder.name}`);
    return mockMode ? mockListFilesRecursive(recorder, sourcePath) : listFilesRecursive(recorder, sourcePath);
  }

  private async schedule(recorders: RecorderConfig[]): Promise<void> {
    const settings = await this.getSettings();
    const recorderMap = new Map(recorders.map((recorder) => [recorder.id, recorder]));

    while (this.running && !this.paused) {
      const availableSlots = Math.max(0, settings.concurrency - this.activeJobs.size);
      if (availableSlots === 0) {
        await this.sleep(150);
        continue;
      }

      const candidates = this.nextPendingJobs(settings, availableSlots);
      if (candidates.length === 0) {
        if (this.activeJobs.size === 0) {
          this.running = false;
          writeLog("info", "Queue completed.");
          this.emit();
          return;
        }
        await this.sleep(150);
        continue;
      }

      for (const job of candidates) {
        const recorder = recorderMap.get(job.recorderId);
        if (!recorder) {
          job.status = "error";
          job.error = "Recorder configuration not found.";
          job.finishedAt = new Date().toISOString();
          writeLog("error", `Missing recorder for ${job.sourcePath}`);
          continue;
        }

        this.activeJobs.add(job.id);
        void this.runJob(job, recorder, settings).finally(() => {
          this.activeJobs.delete(job.id);
          this.cancelHandlers.delete(job.id);
          this.emit();
        });
      }

      this.emit();
      await this.sleep(100);
    }
  }

  private nextPendingJobs(settings: AppSettings, maxCount: number): CopyJob[] {
    const selected: CopyJob[] = [];
    const activeRecorderIds = new Set(
      this.jobs.filter((job) => job.status === "running").map((job) => job.recorderId)
    );

    for (const job of this.jobs) {
      if (job.status !== "pending" || selected.length >= maxCount) {
        continue;
      }

      if (settings.avoidSameRecorder && (activeRecorderIds.has(job.recorderId) || selected.some((item) => item.recorderId === job.recorderId))) {
        continue;
      }

      selected.push(job);
    }

    return selected;
  }

  private async runJob(job: CopyJob, recorder: RecorderConfig, settings: AppSettings): Promise<void> {
    job.status = "running";
    job.startedAt = new Date().toISOString();
    job.error = undefined;
    job.transferred = 0;
    let lastBytes = 0;
    let lastTick = Date.now();

    try {
      const destinationPath = await this.resolveDestination(job.destinationPath, job.size, settings.duplicatePolicy);
      if (!destinationPath) {
        job.status = "skipped";
        job.transferred = job.size ?? 0;
        job.finishedAt = new Date().toISOString();
        writeLog("info", `File skipped: ${job.sourcePath}`);
        return;
      }

      job.destinationPath = destinationPath;
      await fs.mkdir(path.dirname(destinationPath), { recursive: true });
      writeLog("info", `Copy started: source=${job.sourcePath} recorder=${recorder.name}`);
      this.emit();
      const checksumMode = job.checksum?.mode ?? settings.checksumMode;
      let transferHashes: Partial<Record<ChecksumAlgorithm, string>> | undefined;

      if (settings.mockMode) {
        await mockDownloadFile(
          job.size,
          (bytes) => {
            const now = Date.now();
            const elapsedSeconds = Math.max(0.001, (now - lastTick) / 1000);
            job.transferred = bytes;
            job.speedBytesPerSecond = Math.max(0, (bytes - lastBytes) / elapsedSeconds);
            job.etaSeconds = job.size && job.speedBytesPerSecond > 0 ? Math.max(0, (job.size - bytes) / job.speedBytesPerSecond) : null;
            lastBytes = bytes;
            lastTick = now;
            this.emit();
          },
          (cancel) => this.cancelHandlers.set(job.id, cancel)
        );
        if (checksumMode !== "none") {
          await fs.writeFile(destinationPath, `Mock media for ${job.sourcePath}\n`, "utf8");
        }
      } else {
        const result = await downloadFile(
          recorder,
          job.sourcePath,
          destinationPath,
          (progress) => {
            const now = Date.now();
            const elapsedSeconds = Math.max(0.001, (now - lastTick) / 1000);
            job.transferred = progress.bytesOverall;
            job.speedBytesPerSecond = Math.max(0, (progress.bytesOverall - lastBytes) / elapsedSeconds);
            job.etaSeconds = job.size && job.speedBytesPerSecond > 0 ? Math.max(0, (job.size - job.transferred) / job.speedBytesPerSecond) : null;
            lastBytes = progress.bytesOverall;
            lastTick = now;
            this.emit();
          },
          (cancel) => this.cancelHandlers.set(job.id, cancel),
          checksumMode
        );
        transferHashes = result.transferHashes;
      }

      if ((job.status as JobStatus) === "cancelled") {
        return;
      }

      job.transferred = job.size ?? job.transferred;
      job.finishedAt = new Date().toISOString();
      writeLog("info", `Copy completed: ${job.sourcePath}`);
      if (checksumMode === "none") {
        job.status = "done";
      } else {
        const verified = await this.verifyChecksum(job, checksumMode, transferHashes);
        if (!verified) {
          return;
        }
      }
    } catch (error) {
      if ((job.status as JobStatus) === "cancelled") {
        return;
      }

      const message = error instanceof Error ? error.message : String(error);
      job.status = "error";
      job.error = message;
      job.finishedAt = new Date().toISOString();
      writeLog("error", `FTP copy error for ${job.sourcePath}: ${message}`);
    } finally {
      this.emit();
    }
  }

  private async verifyChecksum(
    job: CopyJob,
    mode: ChecksumMode,
    transferHashes?: Partial<Record<ChecksumAlgorithm, string>>
  ): Promise<boolean> {
    const algorithms = checksumAlgorithms(mode);
    if (algorithms.length === 0) {
      job.checksum = { mode };
      return true;
    }

    job.status = "verifying";
    job.checksum = { mode };
    this.emit();
    writeLog("info", `Checksum enabled: ${mode === "both" ? "MD5 + SHA-256" : checksumLabel(algorithms[0]!)}`);

    try {
      for (const algorithm of algorithms) {
        const label = checksumLabel(algorithm);
        writeLog("info", `Checksum ${label} started: ${path.basename(job.destinationPath)}`);
        const localHash = await checksumFile(job.destinationPath, algorithm);
        job.checksum = { ...job.checksum, [algorithm]: localHash };

        const expectedHash = transferHashes?.[algorithm];
        if (expectedHash && expectedHash !== localHash) {
          const message = `expected ${expectedHash} got ${localHash}`;
          job.checksum = { ...job.checksum, verified: false, error: message };
          job.status = "checksum-error";
          job.error = message;
          job.finishedAt = new Date().toISOString();
          writeLog("error", `Checksum error for ${path.basename(job.destinationPath)}: ${message}`);
          this.emit();
          return false;
        }

        if (expectedHash) {
          writeLog("info", `Checksum ${label} OK: ${path.basename(job.destinationPath)}`);
        } else {
          writeLog("info", `Local checksum calculated after copy: ${label} ${localHash}`);
        }
      }

      job.checksum = { ...job.checksum, verified: true };
      job.status = "verified";
      job.finishedAt = new Date().toISOString();
      this.emit();
      return true;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      job.checksum = { ...job.checksum, verified: false, error: message };
      job.status = "checksum-error";
      job.error = message;
      job.finishedAt = new Date().toISOString();
      writeLog("error", `Checksum failed: ${path.basename(job.destinationPath)}`);
      writeLog("error", `Checksum error for ${path.basename(job.destinationPath)}: ${message}`);
      this.emit();
      return false;
    }
  }

  private async resolveDestination(destinationPath: string, size: number | null, policy: DuplicatePolicy): Promise<string | null> {
    try {
      const stat = await fs.stat(destinationPath);
      if (size !== null && stat.size === size) {
        return null;
      }

      if (policy === "skip") {
        return null;
      }

      if (policy === "overwrite") {
        return destinationPath;
      }

      return this.findCopyName(destinationPath);
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") {
        return destinationPath;
      }
      throw error;
    }
  }

  private async findCopyName(destinationPath: string): Promise<string> {
    const parsed = path.parse(destinationPath);
    for (let index = 1; index < 10_000; index += 1) {
      const suffix = index === 1 ? "_copy" : `_copy_${index}`;
      const candidate = path.join(parsed.dir, `${parsed.name}${suffix}${parsed.ext}`);
      try {
        await fs.stat(candidate);
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          return candidate;
        }
        throw error;
      }
    }
    throw new Error("Unable to create a unique copy name.");
  }

  private emit(): void {
    this.listener?.(this.snapshot());
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }
}
