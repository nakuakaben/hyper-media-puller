import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { loadService, recorder } from "./helpers.mjs";

const paths = JSON.parse(readFileSync(new URL("../fixtures/v1-paths.json", import.meta.url)));
const fixtures = JSON.parse(readFileSync(new URL("../fixtures/ftp-legacy.json", import.meta.url)));
const { normalizeFtpPath, buildDestinationPath } = loadService("path-utils");
for (const c of paths.cases) test(c.id, () => {
  if (c.error) assert.throws(() => normalizeFtpPath(c.input), new RegExp(c.error));
  else assert.equal(normalizeFtpPath(c.input), c.expected);
});

test("DEST-01 basenames collide across directories in V1", () => {
  assert.equal(buildDestinationPath("target", "Deck A", "/1/a/clip.mov", "direct"), buildDestinationPath("target", "Deck B", "/2/b/clip.mov", "direct"));
});

for (const c of fixtures.authentication) test(c.id, async () => {
  const clients = [], attempts = [];
  class Client {
    constructor(timeout) { this.ftp = {}; this.timeout = timeout; clients.push(this); }
    async access(options) { attempts.push(options); const error = c.errors[attempts.length - 1]; if (error) throw new Error(error); }
    async list() { return []; }
    close() { this.closed = true; }
  }
  const ftp = loadService("ftp-service", { "basic-ftp": { Client } });
  const operation = ftp.testConnection({ ...recorder(), user: c.user || "anonymous", password: c.password }, 77);
  if (c.reject) await assert.rejects(operation, new RegExp(c.reject));
  else assert.equal((await operation).legacyMode, c.legacy);
  assert.deepEqual(attempts.map(x => x.password), c.attempts);
  assert.ok(attempts.every(x => x.secure === false));
  assert.ok(clients.every(x => x.closed && x.timeout === 77));
});

for (const c of fixtures.listing) test(c.id, async () => {
  const calls = [];
  let closed = false, client;
  const entry = (name, isDirectory) => ({ name, isDirectory, size: 4, modifiedAt: null });
  class Client {
    constructor() { this.ftp = {}; client = this; }
    async access() {}
    async step(method, argument = null) {
      const expected = c.steps[calls.length];
      calls.push([method, argument]);
      assert.ok(expected, "Unexpected FTP operation");
      assert.deepEqual([method, argument], expected.slice(0, 2));
      if (expected[2]) throw new Error(expected[2]);
      return [entry(".", true), entry("..", true), entry("été plan 01.mov", false), entry("1", true)];
    }
    list(p) { return this.step("list", p); }
    cd(p) { return this.step("cd", p); }
    close() { closed = true; }
  }
  const ftp = loadService("ftp-service", { "basic-ftp": { Client } });
  const operation = ftp.scanMedia(recorder(), c.path);
  if (c.reject) await assert.rejects(operation, new RegExp(c.reject));
  else {
    const entries = await operation;
    assert.deepEqual(entries.map(x => x.name), ["1", "été plan 01.mov"]);
    assert.equal(entries[0].size, null);
    assert.equal(entries[1].recorderId, "deck-a");
  }
  assert.equal(calls.length, c.steps.length);
  assert.deepEqual(client.availableListCommands, ["LIST -a", "LIST"]);
  assert.ok(closed);
});

test("LIST-06 recursive expansion and unstable media UUIDs", async () => {
  const tree = { "/": [{ name: "1", isDirectory: true }], "/1": [{ name: "clip.mov", isDirectory: false, size: 4 }] };
  class Client {
    constructor() { this.ftp = {}; }
    async access() {}
    async list(p) { return tree[p]; }
    close() {}
  }
  const ftp = loadService("ftp-service", { "basic-ftp": { Client } });
  const a = await ftp.listFilesRecursive(recorder(), "/");
  const b = await ftp.listFilesRecursive(recorder(), "/");
  assert.deepEqual(a.map(x => x.path), ["/1/clip.mov"]);
  assert.notEqual(a[0].id, b[0].id);
});
