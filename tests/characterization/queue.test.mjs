import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { createReadStream } from "node:fs";
import { PassThrough } from "node:stream";
import { createHash } from "node:crypto";
import path from "node:path";
import { loadService, recorder, source, settings, temporaryDirectory, until, deferred } from "./helpers.mjs";

async function harness(t, options = {}) {
  const directory = await temporaryDirectory(t);
  const config = settings(options.settings);
  const calls = [], snapshots = [];
  const { QueueService } = loadService("queue-service", {
    "./ftp-service": {
      listFilesRecursive: options.listFilesRecursive ?? (async () => []),
      downloadFile: async (...args) => {
        calls.push(args);
        if (options.download) return options.download(...args);
        await fs.writeFile(args[2], "DATA"); args[3]({ bytesOverall: 4 }); return {};
      }
    },
    "./mock-service": { mockDownloadFile() { throw new Error("Unexpected mock path"); } },
    "node:fs/promises": options.fs ?? fs,
    "node:fs": { createReadStream: options.createReadStream ?? createReadStream }
  });
  const queue = new QueueService(async () => config);
  queue.setSnapshotListener(s => snapshots.push(structuredClone(s)));
  const add = (sources = [source()], extra = {}) => queue.addJobs([recorder(), recorder("deck-b")], sources, { destinationRoot: directory, destinationMode: "direct", duplicatePolicy: "rename", checksumMode: "none", ...extra });
  const start = () => queue.start([recorder(), recorder("deck-b")]);
  const idle = () => until(() => !queue.snapshot().running, "queue idle");
  t.after(() => queue.pause());
  return { queue, config, calls, snapshots, directory, add, start, idle };
}

test("QUEUE-01 multi-recorder scheduling, pause drains active jobs, resume pending", async t => {
  const active = new Map();
  const h = await harness(t, { download: async (r, p, dest, progress, cancel) => {
    const gate = deferred(); active.set(p, { gate, r }); cancel(() => gate.reject(new Error("cancelled")));
    await gate.promise; await fs.writeFile(dest, "DATA"); progress({ bytesOverall: 4 }); return {};
  } });
  await h.add([source("a.mov"), source("b.mov"), source("c.mov", "deck-b")]);
  h.start();
  await until(() => active.size === 2, "two transfers");
  assert.deepEqual([...active.values()].map(v => v.r.id).sort(), ["deck-a", "deck-b"]);
  h.queue.pause();
  for (const v of active.values()) v.gate.resolve();
  await until(() => h.queue.snapshot().jobs.filter(j => j.status === "done").length === 2, "active copies finish");
  assert.equal(h.queue.snapshot().jobs[1].status, "pending");
  assert.equal(h.queue.snapshot().paused, true);
  h.start();
  await until(() => active.has("/1/b.mov")); active.get("/1/b.mov").gate.resolve();
  await h.idle();
  assert.ok(h.queue.snapshot().jobs.every(j => j.status === "done"));
  assert.ok(h.snapshots.every(s => s.jobs.filter(j => j.status === "running").length <= 2));
});

test("QUEUE-02 allow concurrent copies on same recorder when option disabled", async t => {
  const gates = [];
  const h = await harness(t, { settings: { avoidSameRecorder: false }, download: async (_r, _p, dest) => {
    const g = deferred(); gates.push(g); await g.promise; await fs.writeFile(dest, "DATA"); return {};
  } });
  await h.add([source("a.mov"), source("b.mov")]); h.start();
  await until(() => gates.length === 2);
  assert.equal(h.queue.snapshot().jobs.filter(j => j.status === "running").length, 2);
  gates.forEach(g => g.resolve()); await h.idle();
});

test("QUEUE-03 cancel running copy leaves partial; retry resets and starts from zero", async t => {
  let attempt = 0, ready = false;
  const h = await harness(t, { download: async (_r, _p, dest, progress, cancel) => {
    if (++attempt === 1) {
      const g = deferred(); cancel(() => g.reject(new Error("closed")));
      await fs.writeFile(dest, "PA"); progress({ bytesOverall: 2 }); ready = true; await g.promise;
    }
    await fs.writeFile(dest, "DATA"); progress({ bytesOverall: 4 }); return {};
  } });
  await h.add(); h.start(); await until(() => ready);
  const id = h.queue.snapshot().jobs[0].id;
  h.queue.cancelJob(id); await h.idle();
  assert.equal(h.queue.snapshot().jobs[0].status, "cancelled");
  assert.equal(await fs.readFile(path.join(h.directory, "clip.mov"), "utf8"), "PA");
  h.config.duplicatePolicy = "overwrite";
  h.queue.retryJob(id);
  assert.equal(h.queue.snapshot().jobs[0].transferred, 0);
  assert.equal(h.queue.snapshot().jobs[0].finishedAt, undefined);
  h.start(); await h.idle();
  assert.equal(h.queue.snapshot().jobs[0].status, "done");
  assert.equal(await fs.readFile(path.join(h.directory, "clip.mov"), "utf8"), "DATA");
});

for (const policy of ["overwrite", "rename", "skip", "ask"]) test(`DUP-SAME-${policy} same-size different content is skipped`, async t => {
  const h = await harness(t, { settings: { duplicatePolicy: policy } });
  await fs.writeFile(path.join(h.directory, "clip.mov"), "ELSE");
  await h.add(); h.start(); await h.idle();
  assert.equal(h.queue.snapshot().jobs[0].status, "skipped");
  assert.equal(h.calls.length, 0);
  assert.equal(await fs.readFile(path.join(h.directory, "clip.mov"), "utf8"), "ELSE");
  assert.equal(h.queue.snapshot().progressPercent, 100);
});

for (const policy of ["rename", "overwrite", "skip", "ask"]) test(`DUP-DIFF-${policy} different-size destination`, async t => {
  const h = await harness(t, { settings: { duplicatePolicy: policy } });
  await fs.writeFile(path.join(h.directory, "clip.mov"), "X");
  await h.add(); h.start(); await h.idle();
  const j = h.queue.snapshot().jobs[0];
  assert.equal(j.status, policy === "skip" ? "skipped" : "done");
  assert.equal(path.basename(j.destinationPath), ["rename", "ask"].includes(policy) ? "clip_copy.mov" : "clip.mov");
});

test("QUEUE-04 enqueue duplicate policy is ignored in favor of launch settings", async t => {
  const h = await harness(t, { settings: { duplicatePolicy: "overwrite" } });
  await fs.writeFile(path.join(h.directory, "clip.mov"), "X");
  await h.add([source()], { duplicatePolicy: "skip" }); h.start(); await h.idle();
  assert.equal(h.queue.snapshot().jobs[0].status, "done");
});

test("QUEUE-05 no reservation: two concurrent jobs receive identical destination", async t => {
  const gates = [];
  const h = await harness(t, { download: async () => { const g = deferred(); gates.push(g); await g.promise; return {}; } });
  await h.add([source("same.mov"), source("same.mov", "deck-b")]); h.start();
  await until(() => h.calls.length === 2);
  assert.equal(h.calls[0][2], h.calls[1][2]);
  gates.forEach(g => g.resolve()); await h.idle();
});

for (const code of ["ECONNRESET", "ENOSPC"]) test(`ERROR-${code} remains error and does not block another recorder`, async t => {
  const h = await harness(t, { download: async (r, _p, dest) => {
    if (r.id === "deck-a") { await fs.writeFile(dest, "PA"); throw Object.assign(new Error(code), { code }); }
    await fs.writeFile(dest, "DATA"); return {};
  } });
  await h.add([source("a.mov"), source("b.mov", "deck-b")]); h.start(); await h.idle();
  assert.deepEqual(h.queue.snapshot().jobs.map(j => j.status), ["error", "done"]);
  assert.equal(await fs.readFile(path.join(h.directory, "a.mov"), "utf8"), "PA");
});

for (const mode of ["md5", "sha256", "both"]) test(`HASH-${mode} compares transfer hashes and local readback`, async t => {
  const h = await harness(t, { download: async (_r, _p, dest) => {
    await fs.writeFile(dest, "DATA");
    return { transferHashes: Object.fromEntries(["md5", "sha256"].map(a => [a, createHash(a).update("DATA").digest("hex")])) };
  } });
  await h.add([source()], { checksumMode: mode }); h.start(); await h.idle();
  const j = h.queue.snapshot().jobs[0];
  assert.equal(j.status, "verified"); assert.equal(j.checksum.verified, true);
  assert.ok(h.snapshots.some(s => s.jobs[0].status === "verifying"));
});

test("HASH-MISMATCH wrong expected digest becomes checksum-error", async t => {
  const h = await harness(t, { download: async (_r, _p, dest) => { await fs.writeFile(dest, "DATA"); return { transferHashes: { md5: "wrong" } }; } });
  await h.add([source()], { checksumMode: "md5" }); h.start(); await h.idle();
  assert.equal(h.queue.snapshot().jobs[0].status, "checksum-error");
  assert.equal(h.queue.snapshot().jobs[0].checksum.verified, false);
});

test("HASH-READ-ERROR local read failure becomes checksum-error", async t => {
  const h = await harness(t, { createReadStream() {
    const stream = new PassThrough(); queueMicrotask(() => stream.destroy(new Error("EIO synthetic read"))); return stream;
  } });
  await h.add([source()], { checksumMode: "md5" }); h.start(); await h.idle();
  assert.equal(h.queue.snapshot().jobs[0].status, "checksum-error");
  assert.match(h.queue.snapshot().jobs[0].error, /EIO/);
});

test("HASH-CANCEL V1 can overwrite cancelled with verified during hash", async t => {
  const stream = new PassThrough(); let reading = false;
  const h = await harness(t, { createReadStream() { reading = true; return stream; } });
  await h.add([source()], { checksumMode: "md5" }); h.start(); await until(() => reading);
  h.queue.cancelJob(h.queue.snapshot().jobs[0].id);
  assert.equal(h.queue.snapshot().jobs[0].status, "cancelled");
  stream.end("DATA"); await h.idle();
  assert.equal(h.queue.snapshot().jobs[0].status, "verified");
});

test("HASH-NO-EXPECTED local hash alone is marked verified in V1", async t => {
  const h = await harness(t); await h.add([source()], { checksumMode: "md5" }); h.start(); await h.idle();
  assert.equal(h.queue.snapshot().jobs[0].status, "verified");
});

test("SIZE-MISMATCH successful adapter result does not enforce advertised size in V1", async t => {
  const h = await harness(t); await h.add([source("clip.mov", "deck-a", 100)]); h.start(); await h.idle();
  assert.equal(h.queue.snapshot().jobs[0].status, "done");
  assert.equal(h.queue.snapshot().jobs[0].transferred, 100);
  assert.equal((await fs.stat(path.join(h.directory, "clip.mov"))).size, 4);
});

test("QUEUE-06 unknown size, skipped source and no queue persistence", async t => {
  const h = await harness(t);
  assert.deepEqual(await h.add([source("a.mov", "absent"), source("b.mov", "deck-a", null)]), { added: 1, skipped: 1 });
  assert.equal(h.queue.snapshot().progressPercent, null);
  const fresh = await harness(t);
  assert.equal(fresh.queue.snapshot().jobs.length, 0);
  h.queue.cancelJob(h.queue.snapshot().jobs[0].id); h.queue.clearFinished();
  assert.equal(h.queue.snapshot().jobs.length, 0);
});
