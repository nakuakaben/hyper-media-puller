import { normalizeFtpPath } from "../dist/main/path-utils.js";

const cases = [
  ["", "/"],
  ["/", "/"],
  ["1", "/1"],
  ["/1", "/1"],
  ["HyperDeck Studio Mini:/", "/"],
  ["HyperDeck Studio Mini:/2", "/2"],
  ["ftp://192.168.1.50/2", "/2"]
];

for (const [input, expected] of cases) {
  const actual = normalizeFtpPath(input);
  if (actual !== expected) {
    throw new Error(`normalizeFtpPath(${JSON.stringify(input)}) returned ${JSON.stringify(actual)}, expected ${JSON.stringify(expected)}`);
  }
}

console.log("FTP path normalization checks OK");
