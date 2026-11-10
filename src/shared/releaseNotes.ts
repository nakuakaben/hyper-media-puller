import { APP_VERSION } from "./version";

export const RELEASE_NOTES = {
  version: APP_VERSION,
  title: `HyperDeck Media Puller v${APP_VERSION}`,
  highlights: [
    "Verification checksum apres copie",
    "Modes MD5 et SHA-256",
    "Logs de verification",
    "Version visible dans l'interface"
  ],
  added: [
    "Added checksum verification after media copy.",
    "Added MD5 and SHA-256 verification modes.",
    "Added version label near HMP logo.",
    "Added in-app changelog modal.",
    "Added checksum results in transfer logs."
  ],
  changed: [
    "Improved transfer reporting for verified copies."
  ],
  fixed: [
    "Kept FTP legacy compatibility and real HyperDeck file browsing behavior."
  ]
};
