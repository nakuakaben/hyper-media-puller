import { Client, FileInfo } from "basic-ftp";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { once } from "node:events";
import { Transform } from "node:stream";
import type { ChecksumMode, MediaEntry, RecorderConfig } from "../shared/types";
import { joinFtpPath, normalizeFtpPath } from "./path-utils";
import { writeLog } from "./logger";

interface FtpSession {
  client: Client;
  legacyMode: boolean;
}

export interface FtpTestResult {
  legacyMode: boolean;
  entriesFound: number;
}

function createClient(timeoutMs = 30_000): Client {
  const client = new Client(timeoutMs);
  client.ftp.verbose = false;
  return client;
}

function isAnonymousUser(user: string): boolean {
  return user.trim().toLowerCase() === "anonymous";
}

function isRetryableAnonymousLoginError(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b(501|530)\b|login|auth|password|user/i.test(message);
}

function isFtp501(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  return /\b501\b/.test(message);
}

function safeHost(recorder: RecorderConfig): string {
  return `${recorder.host}:${recorder.port || 21}`;
}

async function connect(recorder: RecorderConfig, timeoutMs = 30_000): Promise<FtpSession> {
  const user = recorder.user?.trim() || "anonymous";
  const configuredPassword = recorder.password ?? "";
  const passwordAttempts = isAnonymousUser(user) && configuredPassword === ""
    ? [
        { password: "", label: "empty password" },
        { password: "anonymous@hmp.local", label: "anonymous@hmp.local" },
        { password: "guest@", label: "guest@" }
      ]
    : [{ password: configuredPassword, label: "configured password" }];

  writeLog("info", `FTP connect start: ip=${safeHost(recorder)}`);
  let lastError: unknown;

  for (const [index, attempt] of passwordAttempts.entries()) {
    const client = createClient(timeoutMs);
    try {
      if (isAnonymousUser(user)) {
        writeLog("info", index === 0
          ? "FTP anonymous login attempt: empty password"
          : `FTP anonymous fallback: ${attempt.label}`);
      }

      await client.access({
        host: recorder.host,
        port: recorder.port,
        user,
        password: attempt.password,
        secure: false
      });
      client.availableListCommands = ["LIST -a", "LIST"];
      writeLog("info", "FTP connected");
      return { client, legacyMode: index > 0 };
    } catch (error) {
      client.close();
      lastError = error;
      if (!isAnonymousUser(user) || !isRetryableAnonymousLoginError(error) || index === passwordAttempts.length - 1) {
        break;
      }
    }
  }

  throw lastError instanceof Error ? lastError : new Error(String(lastError));
}

function mapInfo(recorderId: string, basePath: string, info: FileInfo): MediaEntry {
  return {
    id: randomUUID(),
    recorderId,
    name: info.name,
    path: joinFtpPath(basePath, info.name),
    size: info.isDirectory ? null : info.size,
    modifiedAt: info.modifiedAt ? info.modifiedAt.toISOString() : null,
    isDirectory: info.isDirectory
  };
}

async function listDirectory(session: FtpSession, pathToList: string): Promise<{ files: FileInfo[]; usedLegacyFallback: boolean }> {
  const normalizedPath = normalizeFtpPath(pathToList);
  try {
    return { files: await session.client.list(normalizedPath), usedLegacyFallback: false };
  } catch (error) {
    const canUseLegacyFallback = isFtp501(error) || normalizedPath === "/";
    if (!canUseLegacyFallback) {
      throw error;
    }

    writeLog("warn", `FTP list failed${isFtp501(error) ? " with 501" : ""}, trying legacy fallback`);
    session.client.availableListCommands = ["LIST -a", "LIST"];

    if (normalizedPath !== "/") {
      try {
        await session.client.cd(normalizedPath);
        const files = await session.client.list();
        writeLog("info", "FTP legacy list OK");
        return { files, usedLegacyFallback: true };
      } catch (fallbackError) {
        throw fallbackError;
      }
    }

    const files = await session.client.list();
    writeLog("info", "FTP legacy list OK");
    return { files, usedLegacyFallback: true };
  }
}

export async function testConnection(recorder: RecorderConfig, timeoutMs = 30_000): Promise<FtpTestResult> {
  const session = await connect(recorder, timeoutMs);
  try {
    const listed = await listDirectory(session, "/");
    const entriesFound = listed.files.filter((entry) => entry.name !== "." && entry.name !== "..").length;
    const legacyMode = session.legacyMode || listed.usedLegacyFallback;
    if (legacyMode) {
      writeLog("info", "Legacy FTP fallback used");
    }
    writeLog("info", `FTP entries found: ${entriesFound}`);
    return { legacyMode, entriesFound };
  } finally {
    session.client.close();
  }
}

export async function scanMedia(recorder: RecorderConfig, sourcePath: string): Promise<MediaEntry[]> {
  const session = await connect(recorder);
  try {
    const normalizedPath = normalizeFtpPath(sourcePath);
    writeLog("info", `FTP normalize path: input="${sourcePath}" output="${normalizedPath}"`);
    writeLog("info", `FTP scan start: path="${normalizedPath}"`);
    const listed = await listDirectory(session, normalizedPath);
    const files = listed.files;
    if (session.legacyMode || listed.usedLegacyFallback) {
      writeLog("info", "Legacy FTP fallback used");
    }
    writeLog("info", `FTP entries found: ${files.filter((entry) => entry.name !== "." && entry.name !== "..").length}`);
    return files
      .filter((entry) => entry.name !== "." && entry.name !== "..")
      .map((entry) => mapInfo(recorder.id, normalizedPath, entry))
      .sort((a, b) => Number(b.isDirectory) - Number(a.isDirectory) || a.name.localeCompare(b.name));
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    writeLog("error", `FTP scan failed after all fallbacks: ${message}`);
    throw error;
  } finally {
    session.client.close();
  }
}

export async function listFilesRecursive(recorder: RecorderConfig, sourcePath: string): Promise<MediaEntry[]> {
  const session = await connect(recorder);
  const results: MediaEntry[] = [];

  async function walk(currentPath: string): Promise<void> {
    const normalizedPath = normalizeFtpPath(currentPath);
    const { files: list } = await listDirectory(session, normalizedPath);
    for (const entry of list) {
      if (entry.name === "." || entry.name === "..") {
        continue;
      }

      const mapped = mapInfo(recorder.id, normalizedPath, entry);
      if (mapped.isDirectory) {
        await walk(mapped.path);
      } else {
        results.push(mapped);
      }
    }
  }

  try {
    await walk(normalizeFtpPath(sourcePath));
    return results;
  } finally {
    session.client.close();
  }
}

export interface DownloadProgress {
  bytesOverall: number;
}

export interface DownloadResult {
  transferHashes?: Partial<Record<"md5" | "sha256", string>>;
}

function checksumAlgorithms(mode: ChecksumMode): Array<"md5" | "sha256"> {
  if (mode === "both") {
    return ["md5", "sha256"];
  }
  if (mode === "md5" || mode === "sha256") {
    return [mode];
  }
  return [];
}

export async function downloadFile(
  recorder: RecorderConfig,
  sourcePath: string,
  destinationPath: string,
  onProgress: (progress: DownloadProgress) => void,
  registerCancel: (cancel: () => void) => void,
  checksumMode: ChecksumMode = "none"
): Promise<DownloadResult> {
  const session = await connect(recorder);
  const client = session.client;
  registerCancel(() => client.close());

  try {
    const normalizedSourcePath = normalizeFtpPath(sourcePath);
    client.trackProgress((progress) => {
      onProgress({ bytesOverall: progress.bytesOverall });
    });
    const algorithms = checksumAlgorithms(checksumMode);
    if (algorithms.length === 0) {
      await client.downloadTo(destinationPath, normalizedSourcePath);
      return {};
    }

    const hashes = new Map(algorithms.map((algorithm) => [algorithm, createHash(algorithm)]));
    const fileStream = createWriteStream(destinationPath);
    const hashStream = new Transform({
      transform(chunk: Buffer, _encoding, callback) {
        for (const hash of hashes.values()) {
          hash.update(chunk);
        }
        callback(null, chunk);
      }
    });
    hashStream.pipe(fileStream);
    const finished = once(fileStream, "finish");

    try {
      await client.downloadTo(hashStream, normalizedSourcePath);
      await finished;
    } catch (error) {
      hashStream.destroy();
      fileStream.destroy();
      throw error;
    }

    return {
      transferHashes: Object.fromEntries(
        Array.from(hashes.entries()).map(([algorithm, hash]) => [algorithm, hash.digest("hex")])
      )
    };
  } finally {
    client.trackProgress();
    client.close();
  }
}
