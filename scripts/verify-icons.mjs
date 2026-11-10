import { existsSync, statSync } from "node:fs";
import path from "node:path";

const root = process.cwd();
const icons = [
  { label: "Windows", file: "build/icon.ico", required: true },
  { label: "macOS", file: "build/icon.icns", required: false },
  { label: "Linux", file: "build/icon.png", required: false }
];

console.log("Icon verification:");

for (const icon of icons) {
  const absolutePath = path.join(root, icon.file);
  if (!existsSync(absolutePath)) {
    const level = icon.required ? "MISSING" : "optional missing";
    console.log(`- ${level}: ${icon.label} icon ${icon.file}`);
    continue;
  }

  const stat = statSync(absolutePath);
  console.log(`- Using ${icon.label} icon: ${icon.file} (${stat.size} bytes)`);
}
