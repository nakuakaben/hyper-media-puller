# Caractérisation HMP 1.1.0

Avec Node 24 LTS, depuis la racine :

```sh
npm ci
npm run build:app
npm run test:ftp-paths
npm run test:characterization
npm run smoke:dev
```

Aucune nouvelle dépendance de test : `node:test`, `node:assert` et modules Node. `test:characterization` recompile le main avant exécution pour éviter de tester un build périmé. Les services sont chargés depuis `dist/main/` sans changer leur code ; `helpers.mjs` injecte les seules frontières nommées et interdit Electron/logger non isolés. Les tests de queue n'accèdent pas à leurs méthodes privées.

| Fichier | Périmètre | Limite |
| --- | --- | --- |
| `characterization/paths-ftp.test.mjs` | Chemins et décisions FTP avec client scénarisé | Pas de réseau ni firmware |
| `characterization/ftp-wire.test.mjs` | Vrai basic-ftp, TCP loopback, streams et petits fichiers | Serveur minimal synthétique, pas un HyperDeck |
| `characterization/queue.test.mjs` | Ordonnanceur réel, disque temporaire, transport contrôlé, erreurs et hash | ENOSPC/EIO injectés, pas de saturation matérielle |
| `characterization/settings-ipc-network.test.mjs` | Paramètres temporaires, envelopes IPC, découverte avec sockets injectées | Pas de scan LAN ni validation de routes |

Les tests WIRE ouvrent seulement `127.0.0.1` sur ports éphémères ; autoriser loopback dans l'environnement de test. Aucun test n'est silencieusement ignoré lorsque l'écoute est interdite. Les fichiers et paramètres utilisent `mkdtemp`, avec nettoyage après chaque cas. Les doublures de découverte ne créent aucune socket réelle.

Le smoke existant est isolé par un lanceur Electron temporaire qui fixe userData et sessionData **avant** chargement du main V1. Il vérifie ensuite l'écriture de settings.json dans ce profil, et arrête les enfants avant nettoyage. Vite/CDP utilisent encore 5173/9323. Le sondage LAN historique est opt-in via `HMP_SMOKE_NETWORK=1` ; il n'est pas nécessaire au corpus local, utilise 9993/21 et peut sonder le réseau sélectionné. Il n'a pas été exécuté dans ce lot. Les autres assertions du smoke (isolation renderer, version, scans mock, queue, annulation, doublons, logs, erreur FTP) sont conservées.

Les fixtures portent leur provenance synthétique. Les credentials anonymous/anonymous@hmp.local/guest@ proviennent des fallbacks applicatifs ; synthetic-test-password n'est pas un identifiant réel. Ne pas remplacer les fixtures par des paramètres utilisateur ou dialogues contenant des secrets. Pour ajouter des captures physiques, suivre [la matrice](../docs/FTP_LEGACY_TEST_MATRIX.md).

**Attention au sens des succès** : HASH-CANCEL, DUP-SAME-*, QUEUE-05, SIZE-MISMATCH et certains PATH-* reproduisent des défauts V1. Un test vert indique que le contrat actuel est caractérisé ; les critères V2 sont volontairement différents dans [la spécification de sécurité](../docs/TRANSFER_SAFETY_SPEC.md).
