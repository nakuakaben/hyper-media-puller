import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import path from "node:path";
import { loadService, recorder, temporaryDirectory, until } from "./helpers.mjs";
import { ftpServer } from "./ftp-server.mjs";

const fixture = JSON.parse(readFileSync(new URL("../fixtures/ftp-legacy.json", import.meta.url)));
const ftp = loadService("ftp-service");
const localRecorder = port => ({ ...recorder(), host: "127.0.0.1", port });
const readOnly = commands => assert.ok(commands.every(line => /^(USER|PASS|FEAT|OPTS|TYPE|STRU|MODE|PWD|CWD|EPSV|PASV|LIST|RETR|QUIT)( |$)/.test(line)), JSON.stringify(commands));

test("WIRE-01 real basic-ftp: anonymous fallback, EPSV/PASV, LIST 501, CWD and volumes", { timeout: 8000 }, async t => {
  const s = await ftpServer(t, { password: "anonymous@hmp.local", legacyList: true, pasvOnly: true, listing: fixture.unixRoot });
  const entries = await ftp.scanMedia(localRecorder(s.port), "/1");
  assert.deepEqual(entries.map(e => e.path), ["/1/1", "/1/2"]);
  assert.ok(s.commands.includes("PASS ") && s.commands.includes("PASS anonymous@hmp.local"));
  assert.ok(s.commands.includes("EPSV") && s.commands.includes("PASV"));
  assert.ok(s.commands.includes("LIST -a /1") && s.commands.includes("LIST /1"));
  assert.ok(s.commands.includes("CWD /1") && s.commands.includes("LIST"));
  readOnly(s.commands);
});

test("WIRE-02 root has only actual server entries; UTF8 names and zero-byte media", { timeout: 8000 }, async t => {
  const s = await ftpServer(t, { listing: fixture.unixMedia });
  const entries = await ftp.scanMedia(localRecorder(s.port), "/");
  assert.equal(entries.length, 2);
  assert.ok(entries.every(e => !e.isDirectory));
  assert.ok(entries.some(e => e.name === "été plan 01.mov" && e.size === 4));
  assert.ok(entries.some(e => e.name === "empty.mov" && e.size === 0));
  readOnly(s.commands);
});

test("WIRE-03 DOS listing parser through V1", { timeout: 8000 }, async t => {
  const s = await ftpServer(t, { listing: fixture.dosMedia });
  assert.deepEqual((await ftp.scanMedia(localRecorder(s.port), "/2")).map(e => [e.path, e.size]), [["/2/clip.mov", 4]]);
});

test("WIRE-04 RETR with real streams and both transfer hashes", { timeout: 8000 }, async t => {
  const destination = path.join(await temporaryDirectory(t), "clip.mov");
  const payload = Buffer.from("synthetic media\n");
  const s = await ftpServer(t, { payload });
  const progress = [];
  let cancel;
  const result = await ftp.downloadFile(localRecorder(s.port), "/1/clip.mov", destination, p => progress.push(p.bytesOverall), c => { cancel = c; }, "both");
  assert.deepEqual(await readFile(destination), payload);
  for (const a of ["md5", "sha256"]) assert.equal(result.transferHashes[a], createHash(a).update(payload).digest("hex"));
  assert.equal(typeof cancel, "function");
  assert.ok(progress.includes(payload.length));
  assert.ok(s.commands.includes("RETR /1/clip.mov"));
  readOnly(s.commands);
});

test("WIRE-05 interrupted RETR rejects and leaves nonempty final-name partial", { timeout: 8000 }, async t => {
  const destination = path.join(await temporaryDirectory(t), "partial.mov");
  const s = await ftpServer(t, { payload: "PART", interrupt: true });
  await assert.rejects(ftp.downloadFile(localRecorder(s.port), "/1/partial.mov", destination, () => {}, () => {}, "none"), /426/);
  assert.equal((await readFile(destination)).toString(), "PART");
  assert.ok(s.commands.includes("RETR /1/partial.mov"));
});

test("WIRE-06 silent control server times out without credential fallback", { timeout: 4000 }, async t => {
  const s = await ftpServer(t, { silent: true });
  await assert.rejects(ftp.testConnection(localRecorder(s.port), 50), /timeout/i);
  assert.equal(s.commands.filter(x => x.startsWith("PASS")).length, 0);
});

test("WIRE-07 real FTP cancellation closes a held transfer and leaves partial", { timeout: 8000 }, async t => {
  const destination = path.join(await temporaryDirectory(t), "cancelled.mov");
  const s = await ftpServer(t, { holdTransfer: true });
  let cancel, transferred = 0;
  const operation = ftp.downloadFile(localRecorder(s.port), "/1/clip.mov", destination, p => { transferred = p.bytesOverall; }, c => { cancel = c; }, "none");
  const rejection = assert.rejects(operation, /closed|close|cancel/i);
  t.after(() => cancel?.());
  await until(() => transferred === 2, "partial transfer progress"); cancel(); await rejection;
  assert.equal(await readFile(destination, "utf8"), "PA");
  readOnly(s.commands);
});

test("WIRE-08 control connection dropped mid-RETR rejects", { timeout: 8000 }, async t => {
  const destination = path.join(await temporaryDirectory(t), "disconnected.mov");
  const s = await ftpServer(t, { disconnect: true, payload: "PART" });
  await assert.rejects(ftp.downloadFile(localRecorder(s.port), "/1/clip.mov", destination, () => {}, () => {}, "none"), /closed|close|FIN|disconnect/i);
  assert.equal(await readFile(destination, "utf8"), "PART");
});
