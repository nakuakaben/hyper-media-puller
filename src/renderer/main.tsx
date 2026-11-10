import React, { useEffect, useMemo, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { AppSettings, ChecksumMode, CopyJob, DuplicatePolicy, HyperDeckSearchProgress, HyperDeckSearchResult, JobStatus, LogEntry, MediaEntry, NetworkInterfaceInfo, QueueSnapshot, RecorderConfig } from "../shared/types";
import { APP_VERSION } from "../shared/version";
import { RELEASE_NOTES } from "../shared/releaseNotes";
import hyperdeckExtreme8kIcon from "../../assets/devices/hyperdeck-extreme-8k.png";
import hyperdeckStudio4kProIcon from "../../assets/devices/hyperdeck-studio-4k-pro.png";
import hyperdeckStudioHdMiniIcon from "../../assets/devices/hyperdeck-studio-hd-mini.png";
import hyperdeckStudioHdPlusIcon from "../../assets/devices/hyperdeck-studio-hd-plus.png";
import "./styles.css";

const emptyQueue: QueueSnapshot = {
  jobs: [],
  running: false,
  paused: false,
  totalBytes: 0,
  transferredBytes: 0,
  progressPercent: null
};

type RecorderConnectionState = "offline" | "connected" | "error";
type BrowserState = "idle" | "checking" | "scanning" | "ready" | "folder-not-found" | "no-media" | "error";

const defaultRecorder = (): RecorderConfig => ({
  id: crypto.randomUUID(),
  name: "HyperDeck",
  host: "",
  port: 21,
  user: "anonymous",
  password: ""
});

function formatBytes(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return "Unknown";
  }
  const units = ["B", "KB", "MB", "GB", "TB"];
  let size = value;
  let unit = 0;
  while (size >= 1024 && unit < units.length - 1) {
    size /= 1024;
    unit += 1;
  }
  return `${size.toFixed(unit === 0 ? 0 : 2)} ${units[unit]}`;
}

function formatSpeed(value: number): string {
  return value > 0 ? `${formatBytes(value)}/s` : "-";
}

function formatEta(value: number | null): string {
  if (value === null || !Number.isFinite(value)) {
    return "-";
  }
  const seconds = Math.max(0, Math.round(value));
  const minutes = Math.floor(seconds / 60);
  const rest = seconds % 60;
  return minutes > 0 ? `${minutes}m ${rest}s` : `${rest}s`;
}

function fileProgress(job: CopyJob): number | null {
  if (!job.size || job.size <= 0) {
    return null;
  }
  return Math.min(100, (job.transferred / job.size) * 100);
}

function parentPath(sourcePath: string): string {
  const parts = sourcePath.split("/").filter(Boolean);
  parts.pop();
  return parts.length === 0 ? "/" : `/${parts.join("/")}`;
}

function fileIcon(entry: MediaEntry): string {
  if (entry.isDirectory) {
    return "folder";
  }
  const extension = entry.name.split(".").pop()?.toLowerCase() ?? "";
  if (["wav", "aif", "aiff", "mp3"].includes(extension)) {
    return "audio";
  }
  if (["mov", "mp4", "mxf", "avi"].includes(extension)) {
    return "video";
  }
  return "unknown";
}

const deviceIcons = {
  hdMini: hyperdeckStudioHdMiniIcon,
  hdPlus: hyperdeckStudioHdPlusIcon,
  fourKPro: hyperdeckStudio4kProIcon,
  extreme8k: hyperdeckExtreme8kIcon
};

function normalizeDeviceModel(value: string | undefined): string {
  return (value ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function getHyperDeckDeviceIcon(modelOrName: string | undefined): string | null {
  const normalized = normalizeDeviceModel(modelOrName);
  if (!normalized.includes("hyperdeck")) {
    return null;
  }
  if (normalized.includes("extreme") && normalized.includes("8k")) {
    return deviceIcons.extreme8k;
  }
  if (normalized.includes("studio") && normalized.includes("4k") && normalized.includes("pro")) {
    return deviceIcons.fourKPro;
  }
  if (normalized.includes("studio") && normalized.includes("hd") && normalized.includes("plus")) {
    return deviceIcons.hdPlus;
  }
  if (normalized.includes("studio") && normalized.includes("mini")) {
    return deviceIcons.hdMini;
  }
  return null;
}

function recorderDeviceIcon(recorder: RecorderConfig | null): string | null {
  if (!recorder) {
    return null;
  }
  return getHyperDeckDeviceIcon(recorder.model) ?? getHyperDeckDeviceIcon(recorder.name);
}

function jobStatusLabel(status: JobStatus): string {
  const labels: Record<JobStatus, string> = {
    pending: "Pending",
    running: "Copying",
    verifying: "Verifying",
    verified: "Verified",
    done: "Done",
    skipped: "Skipped",
    "checksum-error": "Checksum Error",
    error: "Error",
    cancelled: "Cancelled"
  };
  return labels[status];
}

function checksumSummary(job: CopyJob): string {
  if (!job.checksum || job.checksum.mode === "none") {
    return "";
  }
  if (job.status === "verified" && job.checksum.verified) {
    if (job.checksum.mode === "both") {
      return "MD5 + SHA-256 OK";
    }
    return `${job.checksum.mode === "sha256" ? "SHA-256" : "MD5"} OK`;
  }
  if (job.status === "checksum-error") {
    return "Checksum Error";
  }
  return "";
}

function App(): JSX.Element {
  const [settings, setSettings] = useState<AppSettings | null>(null);
  const [selectedRecorderId, setSelectedRecorderId] = useState("");
  const [editingRecorder, setEditingRecorder] = useState<RecorderConfig>(defaultRecorder());
  const [manualEditorOpen, setManualEditorOpen] = useState(false);
  const [developerOpen, setDeveloperOpen] = useState(false);
  const [scanPath, setScanPath] = useState("/");
  const [lastValidScanPath, setLastValidScanPath] = useState("/");
  const [entries, setEntries] = useState<MediaEntry[]>([]);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [queue, setQueue] = useState<QueueSnapshot>(emptyQueue);
  const [logs, setLogs] = useState<LogEntry[]>([]);
  const [logsOpen, setLogsOpen] = useState(false);
  const [releaseNotesOpen, setReleaseNotesOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [browserState, setBrowserState] = useState<BrowserState>("idle");
  const [connectionStates, setConnectionStates] = useState<Record<string, RecorderConnectionState>>({});
  const [searchOpen, setSearchOpen] = useState(false);
  const [interfaces, setInterfaces] = useState<NetworkInterfaceInfo[]>([]);
  const [selectedInterfaceId, setSelectedInterfaceId] = useState("");
  const [searchCidr, setSearchCidr] = useState("");
  const [searchProgress, setSearchProgress] = useState<HyperDeckSearchProgress | null>(null);
  const [searchBusy, setSearchBusy] = useState(false);
  const bootstrappedRef = useRef(false);

  const selectedRecorder = useMemo(
    () => settings?.recorders.find((recorder) => recorder.id === selectedRecorderId) ?? null,
    [settings, selectedRecorderId]
  );

  const selectedRecorderIcon = useMemo(
    () => recorderDeviceIcon(selectedRecorder),
    [selectedRecorder]
  );

  const selectedEntries = useMemo(
    () => entries.filter((entry) => selectedPaths.has(entry.path)),
    [entries, selectedPaths]
  );

  const selectedBytes = selectedEntries.reduce((sum, entry) => sum + (entry.size ?? 0), 0);
  const completedJobs = queue.jobs.filter((job) => job.status === "done" || job.status === "verified" || job.status === "skipped").length;
  const globalSpeed = queue.jobs.reduce((sum, job) => sum + (job.status === "running" ? job.speedBytesPerSecond : 0), 0);
  const currentFolders = entries.filter((entry) => entry.isDirectory);
  const connectionState = selectedRecorder ? connectionStates[selectedRecorder.id] ?? "offline" : "offline";
  const browserStatusLabel: Record<BrowserState, string> = {
    idle: selectedRecorder ? "Ready" : "No recorder selected",
    checking: "FTP Checking",
    scanning: "Scanning",
    ready: "Ready",
    "folder-not-found": "Folder not found",
    "no-media": "No media found",
    error: "FTP Error"
  };

  useEffect(() => {
    if (!bootstrappedRef.current) {
      bootstrappedRef.current = true;
      void Promise.all([window.hyperdeck.getSettings(), window.hyperdeck.getQueue(), window.hyperdeck.getLogs()]).then(
        ([loadedSettings, queueSnapshot, loadedLogs]) => {
          setSettings(loadedSettings);
          setQueue(queueSnapshot);
          setLogs(loadedLogs);
          const firstRecorder = loadedSettings.recorders.find((recorder) => recorder.id === loadedSettings.lastRecorderId) ?? loadedSettings.recorders[0];
          if (firstRecorder) {
            setSelectedRecorderId(firstRecorder.id);
            setEditingRecorder(firstRecorder);
            void connectAndScanRecorder(firstRecorder, loadedSettings, true);
          } else {
            setBrowserState("idle");
          }
        }
      );
    }

    const offQueue = window.hyperdeck.onQueueUpdated(setQueue);
    const offLog = window.hyperdeck.onLogEntry((entry) => setLogs((current) => [...current.slice(-299), entry]));
    const offSearch = window.hyperdeck.onHyperDeckSearchProgress((progress) => {
      setSearchProgress(progress);
      setSearchBusy(progress.status === "running");
      if (progress.status === "error") {
        setMessage(progress.message);
      }
    });
    return () => {
      offQueue();
      offLog();
      offSearch();
    };
  }, []);

  async function persist(nextSettings: AppSettings): Promise<void> {
    const saved = await window.hyperdeck.saveSettings(nextSettings);
    setSettings(saved);
  }

  async function connectAndScanRecorder(recorder: RecorderConfig, activeSettings = settings, auto = false): Promise<void> {
    if (!activeSettings) {
      return;
    }

    setBrowserState("checking");
    setMessage(auto ? "Connexion FTP..." : "");
    const result = await window.hyperdeck.testRecorder(recorder);
    setConnectionStates((current) => ({
      ...current,
      [recorder.id]: result.ok ? "connected" : "offline"
    }));

    if (!result.ok) {
      setBrowserState("idle");
      setEntries([]);
      setSelectedPaths(new Set());
      setScanPath("/");
      setLastValidScanPath("/");
      setMessage(result.message || "FTP Offline");
      return;
    }

    setBrowserState("scanning");
    setMessage("Scan média...");
    await scan("/", recorder, false);
  }

  async function selectRecorder(recorder: RecorderConfig, activeSettings = settings): Promise<void> {
    setSelectedRecorderId(recorder.id);
    setEditingRecorder(recorder);
    setEntries([]);
    setSelectedPaths(new Set());
    setScanPath("/");
    setLastValidScanPath("/");
    setBrowserState("checking");

    if (activeSettings) {
      void persist({ ...activeSettings, lastRecorderId: recorder.id });
      await connectAndScanRecorder(recorder, activeSettings, true);
    }
  }

  async function saveRecorder(): Promise<void> {
    if (!settings) {
      return;
    }

    const recorder = {
      ...editingRecorder,
      name: editingRecorder.name.trim() || "HyperDeck",
      model: editingRecorder.model?.trim() || "",
      host: editingRecorder.host.trim(),
      port: Number(editingRecorder.port) || 21,
      user: editingRecorder.user.trim() || "anonymous"
    };

    const exists = settings.recorders.some((item) => item.id === recorder.id);
    const recorders = exists
      ? settings.recorders.map((item) => (item.id === recorder.id ? recorder : item))
      : [...settings.recorders, recorder];

    const nextSettings = { ...settings, recorders, lastRecorderId: recorder.id };
    setSelectedRecorderId(recorder.id);
    setEditingRecorder(recorder);
    await persist(nextSettings);
    await connectAndScanRecorder(recorder, nextSettings, true);
    setManualEditorOpen(false);
    setMessage("Recorder saved.");
  }

  async function deleteRecorder(): Promise<void> {
    if (!settings || !selectedRecorder) {
      return;
    }

    const recorders = settings.recorders.filter((recorder) => recorder.id !== selectedRecorder.id);
    await persist({ ...settings, recorders, lastRecorderId: recorders[0]?.id ?? "" });
    const next = recorders[0] ?? defaultRecorder();
    setSelectedRecorderId(recorders[0]?.id ?? "");
    setEditingRecorder(next);
    setEntries([]);
    setSelectedPaths(new Set());
    setBrowserState(recorders.length > 0 ? "idle" : "idle");
  }

  async function openSearch(): Promise<void> {
    const detectedInterfaces = await window.hyperdeck.getNetworkInterfaces();
    setInterfaces(detectedInterfaces);
    const selected = detectedInterfaces.find((item) => item.id === selectedInterfaceId) ?? detectedInterfaces[0];
    if (selected) {
      setSelectedInterfaceId(selected.id);
      setSearchCidr(selected.cidr);
    }
    setSearchOpen(true);
    setMessage(detectedInterfaces.length === 0 ? "No private IPv4 network interface detected." : "");
  }

  async function startHyperDeckSearch(): Promise<void> {
    if (!settings) {
      return;
    }
    if (!selectedInterfaceId || !searchCidr.trim()) {
      setMessage("Choose a network interface and CIDR.");
      return;
    }

    try {
      setSearchBusy(true);
      setSearchProgress(null);
      const started = await window.hyperdeck.startHyperDeckSearch({
        interfaceId: selectedInterfaceId,
        cidr: searchCidr.trim(),
        timeoutMs: 500,
        concurrency: 64,
        knownRecorders: settings.recorders
      });
      setSearchProgress({
        scanId: started.scanId,
        status: "running",
        scanned: 0,
        total: 0,
        candidates: 0,
        confirmed: 0,
        message: "Network scan running...",
        results: []
      });
    } catch (error) {
      setSearchBusy(false);
      setMessage(error instanceof Error ? error.message : String(error));
    }
  }

  async function cancelHyperDeckSearch(): Promise<void> {
    if (searchProgress?.scanId) {
      await window.hyperdeck.cancelHyperDeckSearch(searchProgress.scanId);
    }
    setSearchBusy(false);
  }

  async function addDetectedRecorder(result: HyperDeckSearchResult): Promise<void> {
    if (!settings || !result.hyperdeckConfirmed || result.alreadyAdded || result.status === "unknown") {
      return;
    }

    const recorder: RecorderConfig = {
      id: crypto.randomUUID(),
      name: result.name || result.model || `HyperDeck ${result.ip}`,
      model: result.model,
      host: result.ip,
      port: 21,
      user: "anonymous",
      password: ""
    };
    const nextSettings = { ...settings, recorders: [...settings.recorders, recorder], lastRecorderId: recorder.id };
    await persist(nextSettings);
    setSelectedRecorderId(recorder.id);
    setEditingRecorder(recorder);
    await connectAndScanRecorder(recorder, nextSettings, true);
    setSearchProgress((current) => current ? {
      ...current,
      results: current.results.map((item) => item.ip === result.ip ? { ...item, alreadyAdded: true, status: "already-added" } : item)
    } : current);
    setMessage(`${recorder.name} added.`);
  }

  async function addAllDetectedRecorders(): Promise<void> {
    if (!settings || !searchProgress) {
      return;
    }

    const existingHosts = new Set(settings.recorders.map((recorder) => recorder.host));
    const additions = searchProgress.results
      .filter((result) => result.hyperdeckConfirmed && result.status !== "unknown" && !existingHosts.has(result.ip))
      .map((result) => ({
        id: crypto.randomUUID(),
        name: result.name || result.model || `HyperDeck ${result.ip}`,
        model: result.model,
        host: result.ip,
        port: 21,
        user: "anonymous",
        password: ""
      }));

    if (additions.length === 0) {
      setMessage("No new HyperDeck to add.");
      return;
    }

    const nextSettings = { ...settings, recorders: [...settings.recorders, ...additions], lastRecorderId: additions[0]?.id ?? settings.lastRecorderId };
    await persist(nextSettings);
    setSelectedRecorderId(additions[0]?.id ?? selectedRecorderId);
    setEditingRecorder(additions[0] ?? editingRecorder);
    if (additions[0]) {
      await connectAndScanRecorder(additions[0], nextSettings, true);
    }
    setSearchProgress({
      ...searchProgress,
      results: searchProgress.results.map((item) => additions.some((recorder) => recorder.host === item.ip) ? { ...item, alreadyAdded: true, status: "already-added" } : item)
    });
    setMessage(`${additions.length} HyperDeck added.`);
  }

  async function testRecorder(): Promise<void> {
    if (!selectedRecorder) {
      setMessage("No recorder selected.");
      return;
    }

    setBusy(true);
    const result = await window.hyperdeck.testRecorder(selectedRecorder);
    setBusy(false);
    setConnectionStates((current) => ({
      ...current,
      [selectedRecorder.id]: result.ok ? "connected" : "error"
    }));
    setMessage(result.message);
  }

  async function scan(pathToScan = scanPath, recorderOverride: RecorderConfig | null = selectedRecorder, markConnectionError = false): Promise<void> {
    if (!recorderOverride) {
      setMessage("Add or select a recorder.");
      setBrowserState("idle");
      return;
    }

    setBusy(true);
    setBrowserState("scanning");
    setMessage("");
    try {
      const result = await window.hyperdeck.scanMedia({ recorderId: recorderOverride.id, path: pathToScan });
      setEntries(result);
      setScanPath(pathToScan);
      setLastValidScanPath(pathToScan);
      setSelectedPaths(new Set());
      setBrowserState(result.length === 0 ? "no-media" : "ready");
      setConnectionStates((current) => ({ ...current, [recorderOverride.id]: "connected" }));
    } catch (error) {
      if (markConnectionError) {
        setConnectionStates((current) => ({ ...current, [recorderOverride.id]: "error" }));
      }
      setBrowserState("folder-not-found");
      setScanPath(lastValidScanPath);
      setMessage(`Folder not found or unavailable: ${pathToScan}`);
    } finally {
      setBusy(false);
    }
  }

  async function chooseDestination(): Promise<void> {
    if (!settings) {
      return;
    }

    const folder = await window.hyperdeck.chooseDestination();
    if (folder) {
      setSettings({ ...settings, lastDestination: folder });
    }
  }

  async function addSelectedToQueue(): Promise<void> {
    if (!settings || !selectedRecorder) {
      return;
    }

    if (!settings.lastDestination) {
      setMessage("Choisis un dossier de destination avant de lancer la copie");
      return;
    }

    if (selectedEntries.length === 0) {
      setMessage("Select at least one file or folder.");
      return;
    }

    const result = await window.hyperdeck.addJobs(
      selectedEntries.map((entry) => ({
        recorderId: entry.recorderId,
        sourcePath: entry.path,
        isDirectory: entry.isDirectory,
        size: entry.size
      })),
      {
        destinationRoot: settings.lastDestination,
        destinationMode: settings.destinationMode,
        duplicatePolicy: settings.duplicatePolicy,
        checksumMode: settings.checksumMode
      }
    );
    setMessage(`${result.added} job(s) added.`);
  }

  async function updateSetting<K extends keyof AppSettings>(key: K, value: AppSettings[K]): Promise<void> {
    if (!settings) {
      return;
    }
    await persist({ ...settings, [key]: value });
  }

  async function cancelAllJobs(): Promise<void> {
    const cancellable = queue.jobs.filter((job) => job.status === "pending" || job.status === "running" || job.status === "error");
    await Promise.all(cancellable.map((job) => window.hyperdeck.cancelJob(job.id)));
  }

  async function startAllJobs(): Promise<void> {
    if (!settings?.lastDestination) {
      setMessage("Choisis un dossier de destination avant de lancer la copie");
      return;
    }
    await window.hyperdeck.startQueue();
  }

  function togglePath(entry: MediaEntry): void {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(entry.path)) {
        next.delete(entry.path);
      } else {
        next.add(entry.path);
      }
      return next;
    });
  }

  if (!settings) {
    return <div className="loading">Loading HyperDeck Media Puller...</div>;
  }

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-row">
            <h1 className="brand-logo">
              H<span>M</span><em>P</em>
              <span className="sr-only">HyperDeck Media Puller</span>
            </h1>
            <button className="version-chip" onClick={() => setReleaseNotesOpen(true)} title="Release notes">
              v{APP_VERSION}
            </button>
          </div>
          <div className="brand-subtitle">HYPERDECK MEDIA PULLER</div>
        </div>

        <button className="search-hyperdeck-button" onClick={() => void openSearch()}>
          <span className="icon-broadcast" />
          Search HyperDeck
        </button>

        {settings.mockMode && <div className="simulation-badge">SIMULATION</div>}

        <div className="section-title-row">
          <span>RECORDERS</span>
          <strong>{settings.recorders.length}</strong>
        </div>

        <div className="recorder-list">
          {settings.recorders.map((recorder) => {
            const state = connectionStates[recorder.id] ?? "offline";
            const icon = recorderDeviceIcon(recorder);
            return (
              <button
                key={recorder.id}
                className={recorder.id === selectedRecorderId ? "recorder active" : "recorder"}
                onClick={() => void selectRecorder(recorder)}
                onDoubleClick={() => void connectAndScanRecorder(recorder, settings, true)}
              >
                <span className="recorder-device-frame">
                  {icon ? <img className="recorder-device-icon" src={icon} alt="" /> : <span className="recorder-icon" />}
                </span>
                <span className={`status-dot ${state}`} />
                <span className="recorder-copy">
                  <strong>{recorder.name}</strong>
                  <small>{recorder.host || "IP not set"}</small>
                  <em>{state === "connected" ? "FTP connected" : state === "error" ? "FTP error" : "FTP offline"}</em>
                </span>
              </button>
            );
          })}
          {settings.recorders.length === 0 && <p className="empty">No recorder configured.</p>}
        </div>

        <button
          className="manual-recorder-button"
          onClick={() => {
            setEditingRecorder(defaultRecorder());
            setManualEditorOpen((open) => !open);
          }}
        >
          <span>+</span>
          Add Recorder Manually
        </button>

        {manualEditorOpen && (
          <div className="manual-editor">
            <label>
              Name
              <input value={editingRecorder.name} onChange={(event) => setEditingRecorder({ ...editingRecorder, name: event.target.value })} />
            </label>
            <label>
              IP
              <input value={editingRecorder.host} onChange={(event) => setEditingRecorder({ ...editingRecorder, host: event.target.value })} placeholder="192.168.1.50" />
            </label>
            <div className="two-cols">
              <label>
                Port
                <input type="number" min="1" value={editingRecorder.port} onChange={(event) => setEditingRecorder({ ...editingRecorder, port: Number(event.target.value) })} />
              </label>
              <label>
                User
                <input value={editingRecorder.user} onChange={(event) => setEditingRecorder({ ...editingRecorder, user: event.target.value })} />
              </label>
            </div>
            <label>
              Password
              <input type="password" value={editingRecorder.password} onChange={(event) => setEditingRecorder({ ...editingRecorder, password: event.target.value })} />
            </label>
            <div className="button-row">
              <button className="primary" onClick={() => void saveRecorder()}>Save</button>
              <button className="danger" onClick={() => void deleteRecorder()} disabled={!selectedRecorder}>Delete</button>
            </div>
          </div>
        )}

        <div className="sidebar-footer">
          <button className="settings-button" onClick={() => setDeveloperOpen((open) => !open)}>Settings</button>
          {developerOpen && (
            <div className="developer-panel">
              <strong>Developer</strong>
              <label className="checkbox">
                <input type="checkbox" checked={settings.mockMode} onChange={(event) => void updateSetting("mockMode", event.target.checked)} />
                Mode simulation : n'utilise pas le FTP réel
              </label>
            </div>
          )}
        </div>
      </aside>

      <section className="main-area">
        <header className="topbar">
          <div className="selected-recorder-heading">
            <span className="selected-device-frame">
              {selectedRecorderIcon ? <img className="selected-device-icon" src={selectedRecorderIcon} alt="" /> : <span className="recorder-icon" />}
            </span>
            <span className={`status-dot ${connectionState}`} />
            <div>
              <strong>{selectedRecorder?.name ?? "No recorder selected"}</strong>
              <small>{selectedRecorder?.host ?? "Add or discover a HyperDeck"}</small>
            </div>
          </div>
          <div className="header-actions">
            <span className={`ftp-badge ${connectionState}`}>
              {connectionState === "connected" ? "FTP Connected" : connectionState === "error" ? "FTP Error" : "FTP Offline"}
            </span>
            <span className={`browser-badge ${browserState}`}>{browserStatusLabel[browserState]}</span>
            <button onClick={() => void testRecorder()} disabled={!selectedRecorder || busy}>Test FTP</button>
            <button onClick={() => selectedRecorder && void connectAndScanRecorder(selectedRecorder, settings, true)} disabled={!selectedRecorder || busy}>Rescan</button>
            <button className="icon-button" onClick={() => setLogsOpen((open) => !open)} title="Logs">Logs</button>
          </div>
        </header>

        <section className="content-grid">
          <section className="media-shell">
            <div className="media-toolbar">
              <div className="breadcrumb">
                <button onClick={() => void scan("/")} disabled={busy || !selectedRecorder}>Root</button>
                {scanPath.split("/").filter(Boolean).map((part, index, parts) => {
                  const pathToPart = `/${parts.slice(0, index + 1).join("/")}`;
                  return (
                    <React.Fragment key={pathToPart}>
                      <span>/</span>
                      <button onClick={() => void scan(pathToPart)} disabled={busy || !selectedRecorder}>{part}</button>
                    </React.Fragment>
                  );
                })}
              </div>
              <div className="scan-controls">
                <input value={scanPath} onChange={(event) => setScanPath(event.target.value || "/")} aria-label="Manual FTP path" />
                <button onClick={() => void scan(parentPath(scanPath))} disabled={busy || !selectedRecorder}>Up</button>
                <button onClick={() => void scan()} disabled={busy || !selectedRecorder}>Refresh</button>
              </div>
            </div>

            <div className="media-browser">
              <nav className="folder-tree">
                <button onClick={() => void scan("/")} disabled={!selectedRecorder || busy}>
                  <span className="folder-icon root" />
                  Root
                </button>
                {currentFolders.map((entry) => (
                  <button key={entry.path} onClick={() => void scan(entry.path)} disabled={busy}>
                    <span className="folder-icon" />
                    {entry.name}
                  </button>
                ))}
                {currentFolders.length === 0 && <span className="folder-empty">Aucun dossier chargé</span>}
              </nav>

              <div className="file-list">
                <div className="file-row table-head">
                  <span></span>
                  <span>Name</span>
                  <span>Size</span>
                  <span>Date Modified</span>
                </div>
                {entries.map((entry) => (
                  <div key={entry.id} className={selectedPaths.has(entry.path) ? "file-row selected" : "file-row"}>
                    <input type="checkbox" checked={selectedPaths.has(entry.path)} onChange={() => togglePath(entry)} />
                    <button className="file-name" onClick={() => entry.isDirectory ? void scan(entry.path) : togglePath(entry)}>
                      <span className={`file-type ${fileIcon(entry)}`} />
                      <span>{entry.name}</span>
                    </button>
                    <span>{entry.isDirectory ? "-" : formatBytes(entry.size)}</span>
                    <span>{entry.modifiedAt ? new Date(entry.modifiedAt).toLocaleString() : "-"}</span>
                  </div>
                ))}
                {entries.length === 0 && <div className="empty large">Scan a recorder to browse cards, folders and media files.</div>}
              </div>
            </div>

            <div className="selection-bar">
              <strong>{selectedEntries.length} selected ({formatBytes(selectedBytes)})</strong>
              <div>
                <button onClick={() => setSelectedPaths(new Set(entries.map((entry) => entry.path)))}>Select All</button>
                <button onClick={() => setSelectedPaths(new Set())}>Select None</button>
                <button className="primary" onClick={() => void addSelectedToQueue()}>Add to Queue</button>
              </div>
            </div>
          </section>

          <aside className="options-panel">
            <section className="option-section">
              <h2>DESTINATION</h2>
              <div className="destination-row">
                <div className="destination-path">{settings.lastDestination || "No destination selected"}</div>
                <button onClick={() => void chooseDestination()}>Browse</button>
              </div>
              <label className="checkbox">
                <input
                  type="checkbox"
                  checked={settings.destinationMode !== "direct"}
                  onChange={(event) => void updateSetting("destinationMode", event.target.checked ? "recorderDate" : "direct")}
                />
                Create subfolder per recorder
              </label>
              <label>
                Subfolder format
                <select value={settings.destinationMode} onChange={(event) => void updateSetting("destinationMode", event.target.value as AppSettings["destinationMode"])}>
                  <option value="direct">No subfolder</option>
                  <option value="recorder">Recorder name</option>
                  <option value="recorderDate">Recorder / YYYY-MM-DD</option>
                </select>
              </label>
            </section>

            <section className="option-section">
              <h2>COPY OPTIONS</h2>
              <label>
                Max concurrent transfers
                <input type="number" min="1" max="8" value={settings.concurrency} onChange={(event) => void updateSetting("concurrency", Math.max(1, Number(event.target.value)))} />
              </label>
              <label>
                Retry failed transfers
                <select value="manual" disabled>
                  <option value="manual">Manual retry</option>
                </select>
              </label>
              <label>
                If file exists
                <select value={settings.duplicatePolicy} onChange={(event) => void updateSetting("duplicatePolicy", event.target.value as DuplicatePolicy)}>
                  <option value="rename">Rename (add _copy)</option>
                  <option value="overwrite">Overwrite</option>
                  <option value="skip">Skip</option>
                </select>
              </label>
              <label>
                Verification
                <select value={settings.checksumMode} onChange={(event) => void updateSetting("checksumMode", event.target.value as ChecksumMode)}>
                  <option value="none">None</option>
                  <option value="md5">MD5</option>
                  <option value="sha256">SHA-256</option>
                  <option value="both">MD5 + SHA-256</option>
                </select>
              </label>
              <label className="checkbox">
                <input type="checkbox" checked={settings.avoidSameRecorder} onChange={(event) => void updateSetting("avoidSameRecorder", event.target.checked)} />
                Avoid same recorder in parallel
              </label>
            </section>

            <section className="option-section">
              <h2>JOB ACTIONS</h2>
              <div className="job-action-grid">
                <button className="primary action-big" onClick={() => void startAllJobs()}>Start All</button>
                <button className="warning action-big" onClick={() => void window.hyperdeck.pauseQueue()}>Pause</button>
                <button className="danger action-big" onClick={() => void cancelAllJobs()}>Cancel All</button>
              </div>
            </section>

            {message && <div className="message">{message}</div>}
          </aside>
        </section>

        <section className="transfer-queue">
          <div className="queue-header">
            <h2>TRANSFER QUEUE <span>{queue.jobs.length}</span></h2>
            <button onClick={() => void window.hyperdeck.clearFinished()}>Clear Finished</button>
          </div>
          <div className="queue-table">
            <div className="queue-row table-head">
              <span>Recorder</span>
              <span>Source</span>
              <span>Destination</span>
              <span>Size</span>
              <span>Progress</span>
              <span>Status</span>
              <span>Speed</span>
              <span>ETA</span>
              <span>Actions</span>
            </div>
            {queue.jobs.map((job) => {
              const progress = fileProgress(job);
              const checksum = checksumSummary(job);
              return (
                <div className={`queue-row ${job.status}`} key={job.id}>
                  <span className="queue-recorder"><i className={`status-dot ${job.status === "error" || job.status === "checksum-error" ? "error" : job.status === "running" || job.status === "verifying" || job.status === "verified" || job.status === "done" ? "connected" : "offline"}`} />{job.recorderName}</span>
                  <span title={job.sourcePath}>{job.sourcePath}</span>
                  <span title={job.destinationPath}>{job.destinationPath}</span>
                  <span>{formatBytes(job.size)}</span>
                  <span className="queue-progress">
                    <span className="progress-track"><span className="progress-fill" style={{ width: `${progress ?? (job.status === "running" ? 45 : 0)}%` }} /></span>
                    <em>{progress === null ? "Indeterminate" : `${progress.toFixed(0)}%`}</em>
                  </span>
                  <span className="queue-status">
                    <span className={`status-pill ${job.status}`}>{jobStatusLabel(job.status)}</span>
                    {checksum && <small>{checksum}</small>}
                  </span>
                  <span>{formatSpeed(job.speedBytesPerSecond)}</span>
                  <span>{formatEta(job.etaSeconds)}</span>
                  <span className="row-actions">
                    {job.status === "error" || job.status === "checksum-error" || job.status === "cancelled" ? (
                      <button onClick={() => void window.hyperdeck.retryJob(job.id)}>Retry</button>
                    ) : (
                      <button onClick={() => void window.hyperdeck.pauseQueue()} disabled={job.status !== "running"}>Pause</button>
                    )}
                    <button onClick={() => void window.hyperdeck.cancelJob(job.id)} disabled={job.status === "done" || job.status === "verified" || job.status === "skipped"}>Cancel</button>
                  </span>
                  {job.error && <strong className="job-error">{job.error}</strong>}
                </div>
              );
            })}
            {queue.jobs.length === 0 && <div className="empty large">No copy jobs queued.</div>}
          </div>
          <div className="queue-summary">
            <span>Total: {queue.jobs.length} jobs</span>
            <span>Completed: {completedJobs}</span>
            <span className="overall-progress">
              Overall Progress
              <span className="progress-track"><span className="progress-fill" style={{ width: `${queue.progressPercent ?? 0}%` }} /></span>
              <strong>{queue.progressPercent === null ? "0%" : `${queue.progressPercent.toFixed(0)}%`}</strong>
            </span>
            <span>{formatSpeed(globalSpeed)}</span>
            <button onClick={() => setLogsOpen((open) => !open)}>Logs</button>
          </div>
          {logsOpen && (
            <div className="logs">
              {logs.slice(-120).map((entry, index) => (
                <div className={`log ${entry.level}`} key={`${entry.timestamp}-${index}`}>
                  <time>{new Date(entry.timestamp).toLocaleTimeString()}</time>
                  <span>{entry.level}</span>
                  <p>{entry.message}</p>
                </div>
              ))}
            </div>
          )}
        </section>
      </section>

      {releaseNotesOpen && (
        <section className="modal-backdrop">
          <div className="modal release-modal">
            <div className="modal-header">
              <div>
                <h2>{RELEASE_NOTES.title}</h2>
                <p>Notes de mise a jour</p>
              </div>
              <button onClick={() => setReleaseNotesOpen(false)}>Close</button>
            </div>
            <div className="release-notes-body">
              <section>
                <h3>Nouveautes</h3>
                <ul>
                  {RELEASE_NOTES.highlights.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </section>
              <section>
                <h3>Added</h3>
                <ul>
                  {RELEASE_NOTES.added.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </section>
              <section>
                <h3>Changed</h3>
                <ul>
                  {RELEASE_NOTES.changed.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </section>
              <section>
                <h3>Fixed</h3>
                <ul>
                  {RELEASE_NOTES.fixed.map((item) => <li key={item}>{item}</li>)}
                </ul>
              </section>
            </div>
          </div>
        </section>
      )}

      {searchOpen && (
        <section className="modal-backdrop">
          <div className="modal search-modal">
            <div className="modal-header">
              <div>
                <h2>HyperDeck trouvés</h2>
                <p>Local TCP scan, no ICMP ping, safe HyperDeck commands only.</p>
              </div>
              <button onClick={() => setSearchOpen(false)} disabled={searchBusy}>Close</button>
            </div>
            <div className="search-grid">
              <label>
                Network interface
                <select
                  value={selectedInterfaceId}
                  onChange={(event) => {
                    const next = interfaces.find((item) => item.id === event.target.value);
                    setSelectedInterfaceId(event.target.value);
                    if (next) {
                      setSearchCidr(next.cidr);
                    }
                  }}
                >
                  {interfaces.map((item) => (
                    <option key={item.id} value={item.id}>{item.label}</option>
                  ))}
                </select>
              </label>
              <label>
                CIDR
                <input value={searchCidr} onChange={(event) => setSearchCidr(event.target.value)} placeholder="192.168.1.0/24" />
              </label>
              <div className="search-actions">
                <button className="primary" onClick={() => void startHyperDeckSearch()} disabled={searchBusy || interfaces.length === 0}>Relancer scan</button>
                <button className="warning" onClick={() => void cancelHyperDeckSearch()} disabled={!searchBusy}>Annuler scan</button>
                <button onClick={() => void addAllDetectedRecorders()} disabled={searchBusy || !searchProgress?.results.some((result) => result.hyperdeckConfirmed && !result.alreadyAdded)}>Ajouter tous</button>
              </div>
            </div>
            <div className="search-progress">
              <strong>{searchProgress?.message ?? "Ready to scan the selected local subnet."}</strong>
              <span>{searchProgress ? `${searchProgress.scanned}/${searchProgress.total} IP · ${searchProgress.candidates} candidates · ${searchProgress.confirmed} confirmed` : "No scan started."}</span>
            </div>
            <div className="search-results">
              <div className="search-row table-head">
                <span>Device</span>
                <span>IP</span>
                <span>Name</span>
                <span>Model</span>
                <span>9993</span>
                <span>FTP 21</span>
                <span>Status</span>
                <span></span>
              </div>
              {(searchProgress?.results ?? []).map((result) => {
                const resultIcon = getHyperDeckDeviceIcon(result.model);
                return (
                  <div className="search-row" key={result.ip}>
                    <span className="search-device-frame">
                      {resultIcon ? <img className="search-device-icon" src={resultIcon} alt="" /> : <span className="recorder-icon" />}
                    </span>
                    <span>{result.ip}</span>
                    <span>{result.name || "-"}</span>
                    <span>{result.model || "-"}</span>
                    <span className={result.hyperdeckPortOpen ? "status done" : "status error"}>{result.hyperdeckPortOpen ? "open" : "closed"}</span>
                    <span className={result.ftpPortOpen ? "status done" : "status error"}>{result.ftpPortOpen ? "open" : "closed"}</span>
                    <span className={`status-pill ${result.status === "ftp-ok" || result.status === "already-added" ? "done" : result.status === "unknown" || result.status === "ftp-error" ? "error" : "running"}`}>
                      {result.alreadyAdded ? "already added" : result.status}
                    </span>
                    <button onClick={() => void addDetectedRecorder(result)} disabled={!result.hyperdeckConfirmed || result.alreadyAdded || result.status === "unknown"}>
                      Ajouter
                    </button>
                    <small>{result.ftpMessage || result.protocolSummary}</small>
                  </div>
                );
              })}
              {searchProgress && searchProgress.results.length === 0 && <div className="empty large">No confirmed HyperDeck yet.</div>}
            </div>
          </div>
        </section>
      )}
    </main>
  );
}

createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
