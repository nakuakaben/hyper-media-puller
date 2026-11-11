import test from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { loadService, recorder, settings, temporaryDirectory } from "./helpers.mjs";

test("CONFIG-01 defaults, normalization, persistence and restart disables simulation", async t => {
  const directory = await temporaryDirectory(t);
  const electron = { app: { getPath(name) { assert.equal(name, "userData"); return directory; } } };
  const c = loadService("config-store", { electron });
  const initial = await c.loadSettings();
  assert.equal(initial.mockMode, false); assert.equal(initial.checksumMode, "md5");
  await c.saveSettings(settings({ recorders: [{ ...recorder(), name: "  Test Deck  ", host: " 192.0.2.10 " }], mockMode: true, concurrency: 0, checksumMode: "invalid" }));
  const persisted = JSON.parse(await readFile(path.join(directory, "settings.json"), "utf8"));
  assert.equal(persisted.recorders[0].name, "Test Deck");
  assert.equal(persisted.recorders[0].host, "192.0.2.10");
  assert.equal(persisted.mockMode, true); assert.equal(persisted.checksumMode, "md5");
  assert.equal((await c.loadSettings()).mockMode, false);
  assert.equal(JSON.parse(await readFile(path.join(directory, "settings.json"), "utf8")).mockMode, false);
});

test("CONFIG-02 malformed settings silently fall back; invalid enum and high concurrency are retained", async t => {
  const directory = await temporaryDirectory(t);
  const c = loadService("config-store", { electron: { app: { getPath: () => directory } } });
  await writeFile(path.join(directory, "settings.json"), "{broken");
  assert.deepEqual((await c.loadSettings()).recorders, []);
  await writeFile(path.join(directory, "settings.json"), JSON.stringify(settings({ duplicatePolicy: "unknown", concurrency: 999 })));
  const result = await c.loadSettings();
  assert.equal(result.duplicatePolicy, "unknown"); assert.equal(result.concurrency, 999);
});

test("IPC-01 preload invocation envelope and listener unsubscribe", async () => {
  let api;
  const invokes = [], bus = new EventEmitter();
  loadService("preload", { electron: {
    contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, "hyperdeck"); api = value; } },
    ipcRenderer: { invoke: async (...args) => { invokes.push(args); return "synthetic-result"; }, on: bus.on.bind(bus), removeListener: bus.removeListener.bind(bus) }
  } });
  const cases = [
    ["getSettings", [], ["settings:get"]], ["saveSettings", [{}], ["settings:save", {}]],
    ["testRecorder", [{}], ["recorder:test", {}]], ["scanMedia", [{}], ["media:scan", {}]],
    ["chooseDestination", [], ["destination:choose"]], ["addJobs", [[], {}], ["queue:add-jobs", { sources: [], options: {} }]],
    ["startQueue", [], ["queue:start"]], ["pauseQueue", [], ["queue:pause"]],
    ["cancelJob", ["job"], ["queue:cancel-job", "job"]], ["retryJob", ["job"], ["queue:retry-job", "job"]],
    ["clearFinished", [], ["queue:clear-finished"]], ["getQueue", [], ["queue:get"]],
    ["getLogs", [], ["log:get"]], ["getNetworkInterfaces", [], ["network:get-interfaces"]],
    ["startHyperDeckSearch", [{}], ["network:hyperdeck-search:start", {}]], ["cancelHyperDeckSearch", ["scan"], ["network:hyperdeck-search:cancel", "scan"]]
  ];
  for (const [method, args, expected] of cases) {
    assert.equal(await api[method](...args), "synthetic-result"); assert.deepEqual(invokes.at(-1), expected);
  }
  for (const [method, event] of [["onQueueUpdated", "queue:updated"], ["onLogEntry", "log:entry"], ["onHyperDeckSearchProgress", "network:hyperdeck-search:progress"]]) {
    const received = []; const off = api[method](payload => received.push(payload));
    bus.emit(event, {}, { value: 1 }); off(); bus.emit(event, {}, { value: 2 });
    assert.deepEqual(received, [{ value: 1 }]); assert.equal(bus.listenerCount(event), 0);
  }
});

test("IPC-02 main error shapes, destination guard and cancellation return", async () => {
  const handlers = new Map(); let config = settings();
  class QueueService {
    setSnapshotListener() {} snapshot() { return { jobs: [] }; }
  }
  const ipc = loadService("ipc", {
    electron: { ipcMain: { handle(k, handler) { assert.ok(!handlers.has(k)); handlers.set(k, handler); } }, dialog: { showOpenDialog: async () => ({ canceled: true, filePaths: [] }) } },
    "./config-store": { loadSettings: async () => config, saveSettings: async x => { config = x; return x; } },
    "./queue-service": { QueueService },
    "./ftp-service": { testConnection: async () => { throw new Error("530 synthetic auth"); }, scanMedia: async () => { throw new Error("550 synthetic directory"); } },
    "./mock-service": {}, "./network-service": {}, "./logger": { writeLog() {}, getLogs: () => [] }
  });
  ipc.registerIpc({ webContents: { send() {} } });
  const call = (channel, ...args) => handlers.get(channel)({}, ...args);
  assert.equal(handlers.size, 16);
  assert.deepEqual(await call("recorder:test", recorder()), { ok: false, message: "530 synthetic auth" });
  await assert.rejects(call("media:scan", { recorderId: "absent", path: "/" }), /Recorder not found/);
  await assert.rejects(call("media:scan", { recorderId: "deck-a", path: "/" }), /550/);
  await assert.rejects(call("queue:add-jobs", { sources: [], options: { destinationRoot: "" } }), /Destination folder is required/);
  assert.equal(await call("destination:choose"), "");
});

function networkHarness(responses = {}) {
  const writes = [], connections = [];
  const net = { createConnection(options) {
    connections.push(options);
    const socket = new EventEmitter();
    socket.setTimeout = () => {};
    socket.destroy = () => { socket.destroyed = true; };
    socket.write = value => {
      writes.push(value);
      if (value.startsWith("ping")) socket.emit("data", Buffer.from(responses[options.host] ?? "unrelated service\r\n"));
    };
    queueMicrotask(() => { if (!socket.destroyed) socket.emit("connect"); });
    return socket;
  } };
  const ftpCalls = [];
  const service = loadService("network-service", {
    "node:net": net,
    "node:os": { networkInterfaces: () => ({ en0: [{ family: "IPv4", internal: false, address: "192.168.50.10", netmask: "255.255.0.0" }], lo0: [{ family: "IPv4", internal: true, address: "127.0.0.1", netmask: "255.0.0.0" }] }) },
    "./ftp-service": { testConnection: async r => { ftpCalls.push(r); return { legacyMode: false, entriesFound: 0 }; } }
  });
  return { ...service, writes, connections, ftpCalls };
}

const request = { interfaceId: "synthetic-interface", cidr: "192.168.50.0/30", timeoutMs: 300, concurrency: 2, knownRecorders: [] };
test("NET-01 private CIDR, interface inventory, two confirmed devices and known recorder", async () => {
  const banner = "500 connection info:\r\nprotocol version: 1.10\r\nmodel: HyperDeck Studio Mini\r\nname: Synthetic Deck\r\n\r\n";
  const n = networkHarness({ "192.168.50.1": banner, "192.168.50.2": banner });
  assert.equal(n.getNetworkInterfaces().length, 1); assert.equal(n.getNetworkInterfaces()[0].cidr, "192.168.50.0/24");
  const events = [];
  await n.startHyperDeckSearch({ ...request, knownRecorders: [{ host: "192.168.50.2" }] }, p => events.push(p)).done;
  const result = events.at(-1);
  assert.equal(result.status, "done"); assert.equal(result.confirmed, 2);
  assert.deepEqual(result.results.map(r => r.status).sort(), ["already-added", "ftp-ok"]);
  assert.ok(result.results.every(r => r.model === "HyperDeck Studio Mini"));
  assert.ok(n.writes.every(x => ["ping\r\n", "device info\r\n"].includes(x)));
  assert.equal(n.ftpCalls.length, 2);
  assert.ok(n.connections.every(x => x.localAddress === undefined));
});

test("NET-02 unknown service never triggers FTP validation", async () => {
  const n = networkHarness(), events = [];
  await n.startHyperDeckSearch({ ...request, cidr: "192.168.50.1/32" }, p => events.push(p)).done;
  assert.equal(events.at(-1).results[0].status, "unknown"); assert.equal(n.ftpCalls.length, 0);
});

test("NET-03 invalid networks rejected; immediate cancellation is terminal", async () => {
  const n = networkHarness();
  for (const cidr of ["192.168.50.0/23", "8.8.8.8/32", "999.1.1.1/24", "bad"]) assert.throws(() => n.startHyperDeckSearch({ ...request, cidr }, () => {}), /CIDR/);
  const events = []; const scan = n.startHyperDeckSearch(request, p => events.push(p)); scan.cancel(); await scan.done;
  assert.equal(events.at(-1).status, "cancelled");
});
