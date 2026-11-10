import fs from "node:fs/promises";
import path from "node:path";

const root = process.cwd();
const packagePath = path.join(root, "package.json");
const lockPath = path.join(root, "package-lock.json");

function isSemver(version) {
  const parts = version.split(".").map((part) => Number(part));
  if (parts.length !== 3 || parts.some((part) => !Number.isInteger(part) || part < 0)) {
    throw new Error(`Unsupported semver version: ${version}`);
  }
  return true;
}

function incrementPatch(version) {
  isSemver(version);
  const parts = version.split(".").map((part) => Number(part));
  parts[2] += 1;
  return parts.join(".");
}

async function readJson(filePath) {
  return JSON.parse(await fs.readFile(filePath, "utf8"));
}

async function writeJson(filePath, data) {
  await fs.writeFile(filePath, `${JSON.stringify(data, null, 2)}\n`, "utf8");
}

const packageJson = await readJson(packagePath);
const previousVersion = packageJson.version;
const targetVersion = process.argv[2];
const nextVersion = targetVersion ? targetVersion : incrementPatch(previousVersion);
isSemver(nextVersion);
packageJson.version = nextVersion;
await writeJson(packagePath, packageJson);

try {
  const lockJson = await readJson(lockPath);
  lockJson.version = nextVersion;
  if (lockJson.packages?.[""]) {
    lockJson.packages[""].version = nextVersion;
  }
  await writeJson(lockPath, lockJson);
} catch (error) {
  if (error?.code !== "ENOENT") {
    throw error;
  }
}

console.log(`Version bumped: ${previousVersion} -> ${nextVersion}`);
