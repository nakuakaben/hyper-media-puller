import fs from "node:fs/promises";
import path from "node:path";

const packageJson = JSON.parse(await fs.readFile(path.join(process.cwd(), "package.json"), "utf8"));
const target = path.join(process.cwd(), "src", "shared", "version.ts");
const source = `export const APP_VERSION = ${JSON.stringify(packageJson.version)};\n`;

await fs.writeFile(target, source, "utf8");
console.log(`Version synced: ${packageJson.version}`);
