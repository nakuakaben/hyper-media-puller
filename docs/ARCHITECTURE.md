# Architecture HyperSync

HyperSync est le nom du projet ; le produit Electron conserve le nom HyperDeck Media Puller et la version 1.1.0.

- `src/main/main.ts` : fenetre native, menu desactive et lancement Electron.
- `src/main/preload.ts`, `src/shared/api.ts`, `src/shared/ipc.ts` : pont contextBridge et contrats IPC.
- `src/main/ftp-service.ts` : connexions basic-ftp, listing et telechargements.
- `src/main/network-service.ts` : interfaces IPv4 privees et detection TCP HyperDeck (9993), verification FTP (21).
- `src/main/queue-service.ts` : planification, doublons, annulation, progression et checksums.
- `src/main/config-store.ts` : configuration dans userData Electron ; migration simulation vers false au lancement.
- `src/main/logger.ts` : logs locaux et notifications UI.
- `src/renderer/` : interface React et CSS ; aucun acces direct Node.
- `src/shared/` : types, version et notes de version.
- `assets/devices/`, `build/`, `design/` : PNG des appareils, icones applicatives et reference visuelle.
- `scripts/` : versions, verification icones, chemins FTP et smoke Electron.

Flux : React appelle le preload, qui invoque IPC dans le main. Le main effectue les operations reseau et disque puis publie les mises a jour de queue et logs. nodeIntegration est desactive et contextIsolation active.

La verification checksum compare le flux telecharge au fichier local relu ; elle ne constitue pas une empreinte independante fournie par le recorder.
