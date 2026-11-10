import path from "node:path";

export function normalizeFtpPath(input?: string | null): string {
  let value = (input ?? "").trim();
  if (!value) {
    return "/";
  }

  value = value.replace(/\\/g, "/");

  if (/^ftp:\/\//i.test(value)) {
    try {
      value = new URL(value).pathname || "/";
    } catch {
      value = value.replace(/^ftp:\/\/[^/]*(?:\/)?/i, "/");
    }
  } else {
    value = value.replace(/^[^/]+:\/*/, "/");
  }

  value = value.split(/[?#]/, 1)[0] ?? "/";
  value = value.replace(/\/+/g, "/");
  if (!value.startsWith("/")) {
    value = `/${value}`;
  }
  if (value.length > 1) {
    value = value.replace(/\/+$/, "");
  }

  const parts = value.split("/").filter(Boolean);
  if (parts.includes("..")) {
    throw new Error("Invalid FTP path: parent traversal is not allowed.");
  }

  return value || "/";
}

export function joinFtpPath(...parts: string[]): string {
  const normalized = normalizeFtpPath(parts
    .filter(Boolean)
    .join("/")
    .replace(/\\/g, "/")
    .replace(/\/+/g, "/"));

  return normalized;
}

export function fileNameFromFtpPath(sourcePath: string): string {
  return normalizeFtpPath(sourcePath).split("/").filter(Boolean).pop() ?? "media";
}

export function sanitizePathSegment(value: string): string {
  const cleaned = value.replace(/[<>:"/\\|?*\x00-\x1F]/g, "_").trim();
  return cleaned.length > 0 ? cleaned : "Recorder";
}

export function datedFolderName(date = new Date()): string {
  return date.toISOString().slice(0, 10);
}

export function buildDestinationPath(
  destinationRoot: string,
  recorderName: string,
  sourcePath: string,
  mode: "direct" | "recorder" | "recorderDate"
): string {
  const fileName = fileNameFromFtpPath(sourcePath);
  const safeRecorderName = sanitizePathSegment(recorderName);

  if (mode === "direct") {
    return path.join(destinationRoot, fileName);
  }

  if (mode === "recorderDate") {
    return path.join(destinationRoot, safeRecorderName, datedFolderName(), fileName);
  }

  return path.join(destinationRoot, safeRecorderName, fileName);
}
