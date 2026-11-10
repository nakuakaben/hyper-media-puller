import { readFileSync } from "node:fs";
import { mkdtemp, rm } from "node:fs/promises";
import { createRequire } from "node:module";
import { runInThisContext } from "node:vm";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import assert from "node:assert/strict";

export const root = fileURLToPath(new URL("../../", import.meta.url));

// Execute the unchanged build output. Only explicitly named boundaries are replaced.
// Never import Electron/logger transitively from a headless test.
export function loadService(name, overrides = {}) {
  const filename = path.join(root, "dist/main", `${name}.js`);
  const realRequire = createRequire(filename);
  const require = (id) => {
    if (Object.hasOwn(overrides, id)) return overrides[id];
    if (id === "./logger") return { writeLog() {} };
    if (id === "electron" || id === "electron-log/main") throw new Error(`Unisolated dependency: ${id}`);
    return realRequire(id);
  };
  const module = { exports: {} };
  const wrapper = runInThisContext(`(function(exports, require, module, __filename, __dirname) {\n${readFileSync(filename, "utf8")}\n})`, { filename });
  wrapper(module.exports, require, module, filename, path.dirname(filename));
  return module.exports;
}

export async function temporaryDirectory(t) {
  const directory = await mkdtemp(path.join(tmpdir(), "hmp-lot1-"));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return directory;
}

export async function until(predicate, label = "condition", timeout = 4000) {
  const deadline = Date.now() + timeout;
  while (!predicate()) {
    assert.ok(Date.now() < deadline, `Timed out: ${label}`);
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
}

export function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

export const recorder = (id = "deck-a") => ({ id, name: id, host: "192.0.2.10", port: 21, user: "anonymous", password: "" });
export const source = (name = "clip.mov", id = "deck-a", size = 4) => ({ recorderId: id, sourcePath: `/1/${name}`, isDirectory: false, size });
export const settings = (extra = {}) => ({ recorders: [recorder()], lastRecorderId: "", lastDestination: "", destinationMode: "direct", duplicatePolicy: "rename", concurrency: 2, avoidSameRecorder: true, checksumMode: "none", mockMode: false, ...extra });
