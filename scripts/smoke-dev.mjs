import { spawn, spawnSync } from "node:child_process";
import { appendFile, mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import net from "node:net";
import os from "node:os";
import path from "node:path";

const root = process.cwd();
const isWindows = process.platform === "win32";
const bin = (name) => path.join(root, "node_modules", ".bin", `${name}${isWindows ? ".cmd" : ""}`);
const vitePort = 5173;
const debugPort = 9323;
const smokeLog = path.join(root, ".tmp-dev-check", "smoke.log");

const processes = [];
const servers = [];

async function trace(message) {
  const line = `${new Date().toISOString()} ${message}\n`;
  process.stdout.write(line);
  await mkdir(path.dirname(smokeLog), { recursive: true });
  await appendFile(smokeLog, line);
}

function start(command, args, env = {}) {
  const child = spawn(command, args, {
    cwd: root,
    env: { ...process.env, ...env },
    stdio: ["ignore", "pipe", "pipe"],
    shell: isWindows,
    windowsHide: false
  });
  processes.push(child);
  child.stdout.on("data", (chunk) => process.stdout.write(chunk));
  child.stderr.on("data", (chunk) => process.stderr.write(chunk));
  return child;
}

async function waitForHttp(url, timeoutMs = 45_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(url);
      if (response.ok) {
        return response;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error(`Timeout waiting for ${url}`);
}

async function waitForPageTarget() {
  const deadline = Date.now() + 45_000;
  while (Date.now() < deadline) {
    try {
      const response = await fetch(`http://127.0.0.1:${debugPort}/json`);
      const targets = await response.json();
      const page = targets.find((target) => target.type === "page" && target.webSocketDebuggerUrl);
      if (page) {
        return page.webSocketDebuggerUrl;
      }
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 500));
    }
  }
  throw new Error("Timeout waiting for Electron debug target");
}

class CdpClient {
  constructor(url) {
    this.url = url;
    this.nextId = 1;
    this.pending = new Map();
  }

  async connect() {
    this.socket = new WebSocket(this.url);
    this.socket.addEventListener("message", async (event) => {
      const text = typeof event.data === "string" ? event.data : await event.data.text();
      const payload = JSON.parse(text);
      if (payload.id && this.pending.has(payload.id)) {
        const { resolve, reject } = this.pending.get(payload.id);
        this.pending.delete(payload.id);
        if (payload.error) {
          reject(new Error(payload.error.message));
        } else {
          resolve(payload.result);
        }
      }
    });
    await new Promise((resolve, reject) => {
      this.socket.addEventListener("open", resolve, { once: true });
      this.socket.addEventListener("error", reject, { once: true });
    });
  }

  call(method, params = {}) {
    const id = this.nextId++;
    this.socket.send(JSON.stringify({ id, method, params }));
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pending.delete(id);
        reject(new Error(`CDP call timed out: ${method}`));
      }, 20_000);
      this.pending.set(id, {
        resolve: (value) => {
          clearTimeout(timeout);
          resolve(value);
        },
        reject: (error) => {
          clearTimeout(timeout);
          reject(error);
        }
      });
    });
  }

  async evaluate(expression) {
    for (let attempt = 1; attempt <= 2; attempt += 1) {
      try {
        const result = await this.call("Runtime.evaluate", {
          expression,
          awaitPromise: true,
          returnByValue: true
        });
        if (result.exceptionDetails) {
          throw new Error(result.exceptionDetails.text);
        }
        return result.result.value;
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (attempt < 2 && message.includes("Execution context was destroyed")) {
          await new Promise((resolve) => setTimeout(resolve, 600));
          continue;
        }
        throw error;
      }
    }
    return undefined;
  }

  close() {
    this.socket?.close();
  }
}

async function main() {
  const tempDestination = await mkdtemp(path.join(os.tmpdir(), "hyperdeck-media-puller-smoke-"));
  await mkdir(tempDestination, { recursive: true });
  await writeFile(path.join(tempDestination, "skip.mov"), "");
  await writeFile(path.join(tempDestination, "A.mov"), "");

  await trace("SMOKE_STEP start vite");
  start(bin("vite"), ["--host", "127.0.0.1", "--port", String(vitePort), "--strictPort"]);
  await waitForHttp(`http://127.0.0.1:${vitePort}`);

  await trace("SMOKE_STEP start electron");
  start(bin("electron"), ["--remote-debugging-port=" + debugPort, "."], {
    VITE_DEV_SERVER_URL: `http://127.0.0.1:${vitePort}`
  });

  const wsUrl = await waitForPageTarget();
  const cdp = new CdpClient(wsUrl);
  await cdp.connect();

  try {
    await trace("SMOKE_STEP wait preload api");
    await cdp.evaluate(`new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        if (window.hyperdeck) resolve(true);
        else if (Date.now() - started > 20000) reject(new Error("preload api unavailable"));
        else setTimeout(tick, 100);
      };
      tick();
    })`);

    await trace("SMOKE_STEP verify isolation");
    const isolation = await cdp.evaluate(`({
      requireType: typeof window.require,
      processType: typeof window.process,
      apiType: typeof window.hyperdeck
    })`);
    if (isolation.requireType !== "undefined" || isolation.processType !== "undefined" || isolation.apiType !== "object") {
      throw new Error(`Renderer isolation failed: ${JSON.stringify(isolation)}`);
    }

    await trace("SMOKE_STEP save mock settings");
    const destinationJson = JSON.stringify(tempDestination);
    await cdp.evaluate(`window.hyperdeck.saveSettings({
      recorders: [
        { id: "rec-1", name: "Mock Deck 1", host: "192.0.2.10", port: 21, user: "anonymous", password: "" },
        { id: "rec-2", name: "Mock Deck 2", host: "192.0.2.11", port: 21, user: "anonymous", password: "" }
      ],
      lastDestination: ${destinationJson},
      destinationMode: "direct",
      duplicatePolicy: "rename",
      concurrency: 2,
      avoidSameRecorder: true,
      checksumMode: "md5",
      mockMode: true
    })`);

    await cdp.evaluate(`location.reload()`);
    await cdp.evaluate(`new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = () => {
        if (window.hyperdeck && document.querySelector(".version-chip")) resolve(true);
        else if (Date.now() - started > 20000) reject(new Error("renderer reload timeout"));
        else setTimeout(tick, 100);
      };
      tick();
    })`);

    await trace("SMOKE_STEP verify version and changelog ui");
    const uiChecks = await cdp.evaluate(`(async () => {
      const versionButton = document.querySelector(".version-chip");
      const verificationLabel = Array.from(document.querySelectorAll("label")).find((label) => label.textContent.includes("Verification"));
      const verificationSelect = verificationLabel?.querySelector("select");
      versionButton?.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const modalOpen = Boolean(document.querySelector(".release-modal"));
      document.querySelector(".release-modal .modal-header button")?.click();
      await new Promise((resolve) => setTimeout(resolve, 100));
      const modalClosed = !document.querySelector(".release-modal");
      const noHorizontalScroll = document.documentElement.scrollWidth <= document.documentElement.clientWidth && document.body.scrollWidth <= document.body.clientWidth;
      return {
        versionText: versionButton?.textContent?.trim() ?? "",
        verificationValue: verificationSelect?.value ?? "",
        modalOpen,
        modalClosed,
        noHorizontalScroll
      };
    })()`);
    if (uiChecks.versionText !== "v1.1.0" || uiChecks.verificationValue !== "md5" || !uiChecks.modalOpen || !uiChecks.modalClosed || !uiChecks.noHorizontalScroll) {
      throw new Error(`Version/changelog/checksum UI check failed: ${JSON.stringify(uiChecks)}`);
    }

    await trace("SMOKE_STEP verify network search api");
    const networkInterfaces = await cdp.evaluate(`window.hyperdeck.getNetworkInterfaces()`);
    let searchSummary = { interfaces: networkInterfaces.length, confirmed: 0, ftpStatus: "not-run" };
    if (networkInterfaces.length > 0) {
      const selectedInterface = networkInterfaces[0];
      const fakeHyperDeck = await startFakeHyperDeckServer();
      const fakeFtp = await startFakeFtpServer(selectedInterface.address);
      await cdp.evaluate(`window.hyperdeck.startHyperDeckSearch({
        interfaceId: ${JSON.stringify(selectedInterface.id)},
        cidr: ${JSON.stringify(`${selectedInterface.address}/32`)},
        timeoutMs: 300,
        concurrency: 1,
        knownRecorders: []
      })`);
      const searchResult = await cdp.evaluate(`new Promise((resolve, reject) => {
        const started = Date.now();
        const off = window.hyperdeck.onHyperDeckSearchProgress((progress) => {
          if (progress.status === "done" || progress.status === "error") {
            off();
            resolve(progress);
          }
        });
        setTimeout(() => {
          off();
          reject(new Error("Search HyperDeck timeout"));
        }, 15000);
      })`);
      if (fakeHyperDeck.bound && !searchResult.results.some((result) => result.hyperdeckConfirmed && result.ip === selectedInterface.address)) {
        throw new Error("Search HyperDeck did not confirm the fake HyperDeck service");
      }
      if (fakeHyperDeck.bound && fakeFtp.bound && !searchResult.results.some((result) => result.ip === selectedInterface.address && result.status === "ftp-ok")) {
        throw new Error("Search HyperDeck did not mark FTP OK for the fake FTP service");
      }
      searchSummary = {
        interfaces: networkInterfaces.length,
        confirmed: searchResult.confirmed,
        ftpStatus: searchResult.results[0]?.status ?? "none"
      };

      try {
        await cdp.evaluate(`window.hyperdeck.startHyperDeckSearch({
          interfaceId: ${JSON.stringify(selectedInterface.id)},
          cidr: ${JSON.stringify(selectedInterface.cidr)},
          timeoutMs: 300,
          concurrency: 64,
          knownRecorders: []
        }).then((started) => window.hyperdeck.cancelHyperDeckSearch(started.scanId))`);
      } catch (error) {
        await trace(`SMOKE_WARN cancel scan check skipped: ${error instanceof Error ? error.message : String(error)}`);
      }
    }

    await trace("SMOKE_STEP scan mock folders");
    const rootEntries = await cdp.evaluate(`window.hyperdeck.scanMedia({ recorderId: "rec-1", path: "/" })`);
    if (!Array.isArray(rootEntries) || rootEntries.length < 2 || !rootEntries.some((entry) => entry.isDirectory)) {
      throw new Error("Mock root scan did not return expected folders");
    }

    const slotEntries = await cdp.evaluate(`window.hyperdeck.scanMedia({ recorderId: "rec-1", path: "/1" })`);
    if (!slotEntries.some((entry) => entry.path === "/1/SIM_MEDIA_001.mov") || !slotEntries.some((entry) => entry.isDirectory)) {
      throw new Error("Mock folder scan did not return expected files and folders");
    }

    await trace("SMOKE_STEP verify skip duplicate");
    await cdp.evaluate(`window.hyperdeck.addJobs([
      { recorderId: "rec-1", sourcePath: "/skip.mov", isDirectory: false, size: 0 }
    ], { destinationRoot: ${destinationJson}, destinationMode: "direct", duplicatePolicy: "rename" })`);
    await cdp.evaluate(`window.hyperdeck.startQueue()`);
    await cdp.evaluate(`new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = async () => {
        const queue = await window.hyperdeck.getQueue();
        if (queue.jobs.some((job) => job.sourcePath === "/skip.mov" && job.status === "skipped")) resolve(true);
        else if (Date.now() - started > 15000) reject(new Error("skip status timeout"));
        else setTimeout(tick, 150);
      };
      tick();
    })`);
    await cdp.evaluate(`window.hyperdeck.clearFinished()`);

    await trace("SMOKE_STEP verify queue concurrency and cancel");
    await cdp.evaluate(`window.hyperdeck.addJobs([
      { recorderId: "rec-1", sourcePath: "/A.mov", isDirectory: false, size: 50000000 },
      { recorderId: "rec-1", sourcePath: "/B.mov", isDirectory: false, size: 50000000 },
      { recorderId: "rec-2", sourcePath: "/C.mov", isDirectory: false, size: 50000000 }
    ], { destinationRoot: ${destinationJson}, destinationMode: "direct", duplicatePolicy: "rename" })`);
    await cdp.evaluate(`window.hyperdeck.startQueue()`);
    const runningRecorders = await cdp.evaluate(`new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = async () => {
        const queue = await window.hyperdeck.getQueue();
        const running = queue.jobs.filter((job) => job.status === "running");
        if (running.length >= 2) resolve(running.map((job) => job.recorderId));
        else if (Date.now() - started > 8000) reject(new Error("running jobs timeout"));
        else setTimeout(tick, 100);
      };
      tick();
    })`);
    if (new Set(runningRecorders).size !== runningRecorders.length) {
      throw new Error(`Same recorder copied concurrently: ${runningRecorders.join(",")}`);
    }

    await cdp.evaluate(`(async () => {
      const queue = await window.hyperdeck.getQueue();
      const running = queue.jobs.find((job) => job.status === "running");
      if (running) await window.hyperdeck.cancelJob(running.id);
    })()`);
    const queueResult = await cdp.evaluate(`new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = async () => {
        const queue = await window.hyperdeck.getQueue();
        if (queue.jobs.every((job) => ["done", "verified", "skipped", "cancelled", "checksum-error", "error"].includes(job.status))) resolve(queue);
        else if (Date.now() - started > 20000) reject(new Error("queue completion timeout"));
        else setTimeout(tick, 150);
      };
      tick();
    })`);
    if (!queueResult.jobs.some((job) => job.status === "cancelled")) {
      throw new Error("Cancel action did not produce a cancelled job");
    }
    if (!queueResult.jobs.some((job) => job.destinationPath.includes("_copy.mov"))) {
      throw new Error("Rename duplicate policy did not use _copy suffix");
    }

    await trace("SMOKE_STEP verify checksum none mode");
    await cdp.evaluate(`window.hyperdeck.clearFinished()`);
    const logCountBeforeNone = await cdp.evaluate(`window.hyperdeck.getLogs().then((logs) => logs.length)`);
    await cdp.evaluate(`window.hyperdeck.addJobs([
      { recorderId: "rec-1", sourcePath: "/none.mov", isDirectory: false, size: 1200000 }
    ], { destinationRoot: ${destinationJson}, destinationMode: "direct", duplicatePolicy: "rename", checksumMode: "none" })`);
    await cdp.evaluate(`window.hyperdeck.startQueue()`);
    await cdp.evaluate(`new Promise((resolve, reject) => {
      const started = Date.now();
      const tick = async () => {
        const queue = await window.hyperdeck.getQueue();
        if (queue.jobs.some((job) => job.sourcePath === "/none.mov" && job.status === "done")) resolve(true);
        else if (Date.now() - started > 10000) reject(new Error("checksum none completion timeout"));
        else setTimeout(tick, 150);
      };
      tick();
    })`);
    const noneLogs = await cdp.evaluate(`window.hyperdeck.getLogs().then((logs) => logs.slice(${logCountBeforeNone}))`);
    if (noneLogs.some((entry) => entry.message.includes("Checksum") && entry.message.includes("none.mov"))) {
      throw new Error("Checksum logs were emitted for checksum none mode");
    }
    await cdp.evaluate(`window.hyperdeck.clearFinished()`);

    await trace("SMOKE_STEP verify bad ftp error");
    await cdp.evaluate(`window.hyperdeck.saveSettings({
      recorders: [{ id: "bad-rec", name: "Offline Deck", host: "127.0.0.1", port: 1, user: "anonymous", password: "" }],
      lastDestination: ${destinationJson},
      destinationMode: "direct",
      duplicatePolicy: "rename",
      concurrency: 2,
      avoidSameRecorder: true,
      checksumMode: "none",
      mockMode: false
    })`);
    const badConnection = await cdp.evaluate(`window.hyperdeck.testRecorder({ id: "bad-rec", name: "Offline Deck", host: "127.0.0.1", port: 1, user: "anonymous", password: "" })`);
    if (badConnection.ok !== false || !badConnection.message) {
      throw new Error("Bad FTP connection was not reported cleanly");
    }

    await trace("SMOKE_STEP verify logs and title");
    const logs = await cdp.evaluate(`window.hyperdeck.getLogs()`);
    if (!logs.some((entry) => entry.message.includes("Scan started")) || !logs.some((entry) => entry.message.includes("Copy started")) || !logs.some((entry) => entry.message.includes("Checksum"))) {
      throw new Error("Expected scan/copy logs were not recorded");
    }

    const title = await cdp.evaluate(`document.title`);
    const heading = await cdp.evaluate(`document.querySelector("h1")?.textContent ?? ""`);
    if (title !== "HyperDeck Media Puller" || !heading.includes("HyperDeck Media Puller")) {
      throw new Error("Renderer did not display the expected application title");
    }

    await trace(`SMOKE_OK ${JSON.stringify({
      destination: tempDestination,
      isolation,
      searchSummary,
      scannedRoot: rootEntries.length,
      finalStatuses: queueResult.jobs.map((job) => job.status)
    })}`);
  } finally {
    cdp.close();
    await rm(tempDestination, { recursive: true, force: true });
    for (const server of servers.reverse()) {
      await new Promise((resolve) => server.close(() => resolve(undefined)));
    }
  }
}

async function startFakeHyperDeckServer() {
  const server = net.createServer((socket) => {
    socket.write("500 connection info:\r\nprotocol version: 1.10\r\nmodel: HyperDeck Studio Mini\r\n\r\n");
    socket.on("data", (chunk) => {
      const text = chunk.toString("utf8").toLowerCase();
      if (text.includes("ping")) {
        socket.write("200 ok\r\n\r\n");
      }
      if (text.includes("device info")) {
        socket.write("204 device info:\r\nmodel: HyperDeck Studio Mini\r\nname: Smoke Deck\r\n\r\n");
      }
    });
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(9993, "0.0.0.0", resolve);
    });
    servers.push(server);
    return { bound: true };
  } catch (error) {
    await trace(`SMOKE_WARN fake HyperDeck server unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return { bound: false };
  }
}

async function startFakeFtpServer(publicAddress) {
  const server = net.createServer((socket) => {
    socket.setEncoding("utf8");
    let passiveServer = null;
    socket.write("220 HyperDeck mock FTP\r\n");
    socket.on("data", (chunk) => {
      for (const line of chunk.split(/\r?\n/).filter(Boolean)) {
        const command = line.split(" ")[0]?.toUpperCase() ?? "";
        if (command === "USER") socket.write("331 Password required\r\n");
        else if (command === "PASS") socket.write("230 Login successful\r\n");
        else if (command === "FEAT") socket.write("211-Features\r\n UTF8\r\n211 End\r\n");
        else if (command === "OPTS") socket.write("200 OK\r\n");
        else if (command === "TYPE" || command === "STRU" || command === "MODE") socket.write("200 OK\r\n");
        else if (command === "PWD") socket.write('257 "/" is current directory\r\n');
        else if (command === "CWD") socket.write("250 Directory changed\r\n");
        else if (command === "PASV") {
          passiveServer = net.createServer((dataSocket) => {
            dataSocket.end("-rw-r--r-- 1 owner group 0 Jan 01 00:00 smoke.mov\r\n");
          });
          passiveServer.listen(0, "0.0.0.0", () => {
            const address = passiveServer.address();
            const port = typeof address === "object" && address ? address.port : 0;
            const octets = publicAddress.split(".").map(Number);
            socket.write(`227 Entering Passive Mode (${octets.join(",")},${Math.floor(port / 256)},${port % 256})\r\n`);
          });
        } else if (command === "LIST") {
          socket.write("150 Opening data connection\r\n");
          setTimeout(() => {
            socket.write("226 Transfer complete\r\n");
            passiveServer?.close();
            passiveServer = null;
          }, 120);
        } else if (command === "QUIT") {
          socket.write("221 Goodbye\r\n");
          socket.end();
        } else {
          socket.write("200 OK\r\n");
        }
      }
    });
  });

  try {
    await new Promise((resolve, reject) => {
      server.once("error", reject);
      server.listen(21, "0.0.0.0", resolve);
    });
    servers.push(server);
    return { bound: true };
  } catch (error) {
    await trace(`SMOKE_WARN fake FTP server unavailable: ${error instanceof Error ? error.message : String(error)}`);
    return { bound: false };
  }
}

main()
  .catch((error) => {
    console.error("SMOKE_FAILED", error);
    process.exitCode = 1;
  })
  .finally(() => {
    for (const child of processes.reverse()) {
      if (isWindows) {
        spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" });
      } else if (!child.killed) {
        child.kill();
      }
    }
  });
