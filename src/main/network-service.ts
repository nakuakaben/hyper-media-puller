import os from "node:os";
import net from "node:net";
import { randomUUID } from "node:crypto";
import type { HyperDeckSearchProgress, HyperDeckSearchRequest, HyperDeckSearchResult, NetworkInterfaceInfo } from "../shared/types";
import { writeLog } from "./logger";
import { testConnection } from "./ftp-service";

const MAX_HOSTS = 254;
const DEFAULT_TIMEOUT_MS = 500;
const DEFAULT_CONCURRENCY = 64;
const HYPERDECK_PORT = 9993;
const FTP_PORT = 21;

interface ProbeResult {
  ip: string;
  portOpen: boolean;
  response: string;
  model: string;
  name: string;
  confirmed: boolean;
  summary: string;
  error?: string;
}

interface FtpProbeResult {
  portOpen: boolean;
  ok: boolean;
  message: string;
}

function classifyInterface(name: string): NetworkInterfaceInfo["kind"] {
  const normalized = name.toLowerCase();
  if (normalized.includes("wi-fi") || normalized.includes("wifi") || normalized.includes("wireless") || normalized.includes("wlan")) {
    return "wifi";
  }
  if (normalized.includes("ethernet") || normalized.includes("lan") || normalized.includes("gbe")) {
    return "ethernet";
  }
  return "other";
}

function ipToInt(ip: string): number {
  return ip.split(".").reduce((value, part) => ((value << 8) + Number(part)) >>> 0, 0);
}

function intToIp(value: number): string {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join(".");
}

function prefixFromNetmask(netmask: string): number {
  const bits = netmask
    .split(".")
    .map((part) => Number(part).toString(2).padStart(8, "0"))
    .join("");
  return bits.replace(/0+$/, "").length;
}

function cidrFromInterface(address: string, netmask: string): string {
  const prefix = Math.max(24, prefixFromNetmask(netmask));
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = ipToInt(address) & mask;
  return `${intToIp(network)}/${prefix}`;
}

function isPrivateIp(ip: string): boolean {
  const [a = 0, b = 0] = ip.split(".").map(Number);
  return a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168) || (a === 169 && b === 254);
}

function parseCidr(cidr: string): { network: number; prefix: number; normalized: string; totalHosts: number } {
  const match = cidr.trim().match(/^(\d{1,3}(?:\.\d{1,3}){3})\/(\d{1,2})$/);
  if (!match) {
    throw new Error("CIDR invalide. Format attendu : 192.168.1.0/24.");
  }

  const ip = match[1] ?? "";
  const prefix = Number(match[2] ?? NaN);
  const octets = ip.split(".").map(Number);
  if (octets.some((part) => !Number.isInteger(part) || part < 0 || part > 255) || prefix < 24 || prefix > 32) {
    throw new Error("CIDR refusé. Utilisez un réseau privé entre /24 et /32.");
  }
  if (!isPrivateIp(ip)) {
    throw new Error("CIDR refusé. Le scan est limité aux réseaux locaux privés.");
  }

  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = ipToInt(ip) & mask;
  const addresses = 2 ** (32 - prefix);
  const totalHosts = prefix >= 31 ? addresses : Math.max(0, addresses - 2);
  if (totalHosts > MAX_HOSTS) {
    throw new Error("Réseau trop large. Le scan V1 est limité à 254 IP maximum.");
  }

  return {
    network,
    prefix,
    normalized: `${intToIp(network)}/${prefix}`,
    totalHosts
  };
}

function hostsFromCidr(cidr: string): string[] {
  const parsed = parseCidr(cidr);
  const count = 2 ** (32 - parsed.prefix);
  const startOffset = parsed.prefix >= 31 ? 0 : 1;
  const endOffset = parsed.prefix >= 31 ? count - 1 : count - 2;
  const hosts: string[] = [];
  for (let offset = startOffset; offset <= endOffset; offset += 1) {
    hosts.push(intToIp((parsed.network + offset) >>> 0));
  }
  return hosts;
}

function parseDeviceInfo(response: string): { model: string; name: string } {
  const lines = response.split(/\r?\n/);
  let model = "";
  let name = "";
  for (const line of lines) {
    const [rawKey, ...rawValue] = line.split(":");
    const key = rawKey?.trim().toLowerCase();
    const value = rawValue.join(":").trim();
    if (!key || !value) {
      continue;
    }
    if (key === "model") {
      model = value;
    }
    if (key === "name" || key === "device name" || key === "label") {
      name = value;
    }
  }
  return { model, name };
}

async function probeTcp(ip: string, port: number, timeoutMs: number, signal: AbortSignal): Promise<boolean> {
  return new Promise((resolve) => {
    if (signal.aborted) {
      resolve(false);
      return;
    }

    const socket = net.createConnection({ host: ip, port });
    let settled = false;
    const finish = (open: boolean) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(open);
    };

    const abort = () => finish(false);
    signal.addEventListener("abort", abort, { once: true });
    socket.setTimeout(timeoutMs);
    socket.once("connect", () => {
      signal.removeEventListener("abort", abort);
      finish(true);
    });
    socket.once("timeout", () => {
      signal.removeEventListener("abort", abort);
      finish(false);
    });
    socket.once("error", () => {
      signal.removeEventListener("abort", abort);
      finish(false);
    });
  });
}

async function readHyperDeck(ip: string, timeoutMs: number, signal: AbortSignal): Promise<ProbeResult> {
  return new Promise((resolve) => {
    const socket = net.createConnection({ host: ip, port: HYPERDECK_PORT });
    let settled = false;
    let response = "";

    const finish = (result: ProbeResult) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.destroy();
      resolve(result);
    };

    const finalize = () => {
      const info = parseDeviceInfo(response);
      const confirmed = /hyperdeck/i.test(response) || /protocol version/i.test(response) || /device info/i.test(response);
      finish({
        ip,
        portOpen: true,
        response,
        model: info.model,
        name: info.name,
        confirmed,
        summary: confirmed ? "Réponse protocole HyperDeck" : "Port 9993 ouvert, protocole non confirmé"
      });
    };

    const abort = () => finish({ ip, portOpen: false, response, model: "", name: "", confirmed: false, summary: "Scan annulé" });
    signal.addEventListener("abort", abort, { once: true });

    socket.setTimeout(Math.max(timeoutMs * 3, 1200));
    socket.on("data", (chunk) => {
      response += chunk.toString("utf8");
    });
    socket.once("connect", () => {
      socket.write("ping\r\n");
      setTimeout(() => {
        if (!settled) {
          socket.write("device info\r\n");
        }
      }, Math.min(180, timeoutMs));
      setTimeout(finalize, Math.max(timeoutMs * 2, 900));
    });
    socket.once("timeout", finalize);
    socket.once("error", (error) => {
      finish({
        ip,
        portOpen: false,
        response,
        model: "",
        name: "",
        confirmed: false,
        summary: "Port 9993 fermé ou inaccessible",
        error: error.message
      });
    });
    socket.once("close", () => {
      if (!settled && response) {
        finalize();
      }
    });
  });
}

async function probeFtp(ip: string, timeoutMs: number, signal: AbortSignal): Promise<FtpProbeResult> {
  const portOpen = await probeTcp(ip, FTP_PORT, timeoutMs, signal);
  if (!portOpen) {
    return { portOpen: false, ok: false, message: "FTP port 21 fermé ou inaccessible." };
  }

  try {
    if (signal.aborted) {
      return { portOpen, ok: false, message: "Scan annulé." };
    }
    const result = await testConnection({
      id: ip,
      name: `HyperDeck ${ip}`,
      host: ip,
      port: FTP_PORT,
      user: "anonymous",
      password: ""
    }, Math.max(timeoutMs * 4, 2000));
    return {
      portOpen,
      ok: true,
      message: result.legacyMode ? "FTP anonymous OK, racine listée en mode legacy." : "FTP anonymous OK, racine listée."
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return { portOpen, ok: false, message };
  }
}

async function runWithConcurrency<T>(items: T[], concurrency: number, signal: AbortSignal, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const workers = Array.from({ length: Math.min(concurrency, items.length) }, async () => {
    while (!signal.aborted) {
      const current = items[index];
      index += 1;
      if (current === undefined) {
        return;
      }
      await worker(current);
    }
  });
  await Promise.all(workers);
}

export function getNetworkInterfaces(): NetworkInterfaceInfo[] {
  const interfaces = os.networkInterfaces();
  const results: NetworkInterfaceInfo[] = [];

  for (const [name, addresses] of Object.entries(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family !== "IPv4" || address.internal || !address.netmask || !isPrivateIp(address.address)) {
        continue;
      }

      const cidr = cidrFromInterface(address.address, address.netmask);
      const kind = classifyInterface(name);
      results.push({
        id: `${name}-${address.address}`,
        name,
        label: `${kind === "wifi" ? "Wi-Fi" : kind === "ethernet" ? "Ethernet" : "Interface"} - ${name} (${address.address})`,
        address: address.address,
        netmask: address.netmask,
        cidr,
        family: "IPv4",
        kind
      });
    }
  }

  return results.sort((a, b) => a.kind.localeCompare(b.kind) || a.name.localeCompare(b.name));
}

export function startHyperDeckSearch(
  request: HyperDeckSearchRequest,
  onProgress: (progress: HyperDeckSearchProgress) => void
): { scanId: string; cancel: () => void; done: Promise<void> } {
  const scanId = randomUUID();
  const controller = new AbortController();
  const timeoutMs = Math.min(800, Math.max(300, Number(request.timeoutMs) || DEFAULT_TIMEOUT_MS));
  const concurrency = Math.min(DEFAULT_CONCURRENCY, Math.max(1, Number(request.concurrency) || DEFAULT_CONCURRENCY));
  const knownHosts = new Set(request.knownRecorders.map((recorder) => recorder.host.trim()).filter(Boolean));
  const hosts = hostsFromCidr(request.cidr);
  const results: HyperDeckSearchResult[] = [];
  let scanned = 0;
  let candidates = 0;
  let confirmed = 0;

  const emit = (status: HyperDeckSearchProgress["status"], message: string) => {
    onProgress({
      scanId,
      status,
      scanned,
      total: hosts.length,
      candidates,
      confirmed,
      message,
      results: [...results]
    });
  };

  const done = (async () => {
    writeLog("info", `Network scan started: interface=${request.interfaceId}, cidr=${request.cidr}, hosts=${hosts.length}, timeout=${timeoutMs}ms, concurrency=${concurrency}`);
    emit("running", `Scan réseau lancé sur ${request.cidr}.`);

    try {
      await runWithConcurrency(hosts, concurrency, controller.signal, async (ip) => {
        if (controller.signal.aborted) {
          return;
        }

        const portOpen = await probeTcp(ip, HYPERDECK_PORT, timeoutMs, controller.signal);
        scanned += 1;

        if (!portOpen) {
          if (scanned % 16 === 0 || scanned === hosts.length) {
            emit("running", `${scanned}/${hosts.length} IP testées.`);
          }
          return;
        }

        candidates += 1;
        const hyperdeck = await readHyperDeck(ip, timeoutMs, controller.signal);
        if (!hyperdeck.confirmed) {
          results.push({
            ip,
            name: `Inconnu ${ip}`,
            model: hyperdeck.model,
            hyperdeckPortOpen: true,
            ftpPortOpen: false,
            status: "unknown",
            alreadyAdded: false,
            hyperdeckConfirmed: false,
            protocolSummary: hyperdeck.summary,
            ftpMessage: "FTP non testé sur appareil non confirmé.",
            error: hyperdeck.error
          });
          emit("running", `Port 9993 ouvert mais protocole inconnu : ${ip}.`);
          return;
        }

        confirmed += 1;
        const ftp = await probeFtp(ip, timeoutMs, controller.signal);
        const alreadyAdded = knownHosts.has(ip);
        const name = hyperdeck.name || hyperdeck.model || `HyperDeck ${ip}`;
        const status: HyperDeckSearchResult["status"] = alreadyAdded ? "already-added" : ftp.ok ? "ftp-ok" : "ftp-error";
        results.push({
          ip,
          name,
          model: hyperdeck.model,
          hyperdeckPortOpen: true,
          ftpPortOpen: ftp.portOpen,
          status,
          alreadyAdded,
          hyperdeckConfirmed: true,
          protocolSummary: hyperdeck.summary,
          ftpMessage: ftp.message
        });
        writeLog("info", `HyperDeck detected: ${ip}, name=${name}, model=${hyperdeck.model || "unknown"}, ftp=${ftp.ok ? "OK" : ftp.message}`);
        emit("running", `HyperDeck détecté : ${ip}.`);
      });

      if (controller.signal.aborted) {
        writeLog("warn", `Network scan cancelled: scanId=${scanId}, scanned=${scanned}/${hosts.length}`);
        emit("cancelled", "Scan réseau annulé.");
        return;
      }

      writeLog("info", `Network scan completed: hosts=${hosts.length}, scanned=${scanned}, candidates=${candidates}, confirmed=${confirmed}`);
      emit("done", `Scan terminé : ${confirmed} HyperDeck confirmé(s).`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      writeLog("error", `Network scan error: ${message}`);
      emit("error", message);
    }
  })();

  return {
    scanId,
    cancel: () => controller.abort(),
    done
  };
}
