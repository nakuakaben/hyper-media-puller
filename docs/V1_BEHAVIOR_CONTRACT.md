# Contrat observable HMP V1 — lot 1

10 novembre 2026. Référence : **HMP 1.1.0**, commit `8881ec3c4ad4a79d145af0f3271343836d209dbb`. Le code de `src/` reste inchangé dans ce lot. Ce document distingue l'observation V1 de la [spécification de sécurité V2](TRANSFER_SAFETY_SPEC.md).

## Preuves et vocabulaire

**Exécuté** : assertion passée sur le code V1 compilé, avec la limite indiquée. **Implémenté** : constat de lecture, pas une validation matérielle. **À qualifier** : exige matériel, OS ou scénario absent de cette session. Les tests connus comme reproduisant un défaut doivent rester verts tant que la V1 conserve ce défaut : cela ne l'approuve pas pour V2.

Reproduction : Node 24 LTS, `npm ci`, `npm run build:app`, `npm run test:ftp-paths`, `npm run test:characterization`, `npm run smoke:dev`. Le dernier utilise désormais un profil temporaire. Les résultats datés sont dans [LOT1_VALIDATION_REPORT.md](LOT1_VALIDATION_REPORT.md).

## Modules, entrées, sorties et erreurs

| Module / entrée | Sortie / état / événement | Règles V1 et erreurs | Preuve |
| --- | --- | --- | --- |
| `network-service.getNetworkInterfaces()` | `NetworkInterfaceInfo[]`, nom/adresse/netmask/CIDR/type | IPv4 privé ou link-local, non interne ; /16 ramené à /24 ; en0 peut être classé other | NET-01, OS injecté |
| `startHyperDeckSearch(request, callback)` | `{scanId,cancel,done}`, événements running/done/cancelled/error | CIDR invalide/public ou < /24 : exception synchrone ; /24–/32, maximum 254 hôtes, concurrence 1–64 et timeout probe 300–800 ms | NET-01/03, sockets synthétiques |
| Identification TCP 9993 | modèle/nom/confirmation, résultats unknown/ftp-ok/ftp-error/already-added | `ping`, `device info` uniquement ; confirmation par texte HyperDeck/protocol version/device info ; 9993 ouvert ne suffit pas | NET-01/02 ; firmware non testé |
| Test FTP de découverte | port 21 puis `testConnection` anonymous, timeout >=2 s | FTP seulement après confirmation ; identifie déjà ajouté par host, pas port ; interfaceId n'impose pas de bind local | NET-01/02 + lecture |
| `ftp-service.testConnection(recorder, timeout=30000)` | `{legacyMode,entriesFound}` ou rejet | Login puis listing racine, fermeture finally ; `legacyMode` agrège fallback login/listing | AUTH-01…07, WIRE-06 |
| `scanMedia(recorder,path)` | `MediaEntry[]`, dossiers d'abord puis localeCompare | Filtre . et .., dates ISO/null, taille dossier null ; erreur journalisée puis rejetée ; aucune injection de volumes | LIST-01…06, WIRE-01…03 |
| `listFilesRecursive(recorder,path)` | fichiers développés, une session | Parcours séquentiel récursif ; pas de limite de profondeur/visited explicite | LIST-06 ; cycles non testés |
| `downloadFile(recorder,source,destination,onProgress,registerCancel,mode)` | `{transferHashes?}`, callbacks `{bytesOverall}` ; rejet FTP/disque | Nouvelle connexion, RETR, écriture au nom final ; cancel ferme client ; hash du flux si md5/sha256/both | WIRE-04…08 |
| `QueueService.addJobs(recorders,sources,options)` | `{added,skipped}`, snapshot | Recorder absent ignoré ; dossiers développés selon mockMode ; pas de déduplication de sélection ; checksum figé dans job | QUEUE-06, LIST-06 + lecture |
| `start(recorders)` / ordonnanceur | running=true, snapshots, jobs running | Settings lus au lancement ; concurrence globale, préférence un running par recorder ; défaut 2/true ; vérification non comptée comme running par ce filtre | QUEUE-01/02 ; limite verifying lue |
| `pause()` | paused=true, running=false | N'annule pas les actifs ; les départs suivants sont suspendus | QUEUE-01 |
| `cancelJob(id)` | pending/running/verifying/error/checksum-error → cancelled | Id absent et états terminés ignorés ; ferme FTP actif mais pas lecture hash ; course cancelled→verified reproduite | QUEUE-03, HASH-CANCEL |
| `retryJob(id)` | error/checksum-error/cancelled → pending | Compteurs/erreur/hash/timestamps réinitialisés ; conserve id et destination déjà résolue ; ne redémarre pas automatiquement une queue arrêtée | QUEUE-03 + lecture |
| `clearFinished()` | enlève done/verified/skipped/cancelled | Conserve error/checksum-error pour inspection/réessai | QUEUE-06 + lecture |
| `snapshot()` | jobs/running/paused/totalBytes/transferredBytes/progressPercent | Copie superficielle du tableau ; taille inconnue compte 0 au total ; skipped compte comme taille accomplie ; total 0 → null | DUP-SAME-*, QUEUE-06 |
| `config-store.loadSettings()` | AppSettings, JSON userData | Défauts si lecture/parse échoue ; mock forcé false et réécrit s'il était true ; normalisation partielle | CONFIG-01/02, disque temporaire |
| `saveSettings(settings)` | paramètres normalisés et écrits | JSON en clair ; user/host/name trim ; UUID si id absent ; pas de validation complète des enums/concurrence | CONFIG-01/02 |
| Logger | log fichier, log:entry, getLogs() | 1000 entrées mémoire, 500 exposées ; pas de rapport persistant de lot | Lecture ; smoke présence de logs |

`ftp-service` dépend de basic-ftp **5.3.1** dans le lockfile audité. La bibliothèque gère les sockets/parseurs : ses effets réels font partie de la référence V1, pas seulement les appels HMP. Voir la [matrice FTP](FTP_LEGACY_TEST_MATRIX.md) pour les dialogues synthétiques exécutés et ce qui manque sur matériel.

## Identités, navigation et sélection UI

`RecorderConfig.id` est un UUID conservé dans les paramètres ; host/name/model sont modifiables. Un recorder sans id reçoit un UUID à la normalisation. L'IP ne suffit donc pas comme identité future. La découverte signale `alreadyAdded` en comparant uniquement les hosts connus.

`MediaEntry.id` est un nouvel UUID à chaque listing ; il n'est pas stable entre deux scans (LIST-06). L'UI sélectionne un **Set de chemins**, pas ces UUID. `QueueSource` contient recorderId/path/isDirectory/size. Une source dossier est développée au moment de l'ajout. Il n'existe pas de TransferBatch V1 explicite ; les jobs ajoutés se mêlent dans un seul tableau.

Sources UI : `src/renderer/main.tsx` (`selectRecorder`, `scan`, `queueSelected`). Changer de recorder vide la sélection/liste et teste puis scanne `/`. Scanner un dossier avec succès vide aussi la sélection. Échec de navigation : état folder-not-found, chemin remis au dernier valide ; queue indépendante. Les réponses asynchrones ne sont pas marquées par une génération : le risque de résultat périmé demeure **lu, non reproduit dans un test UI de ce lot**.

États navigateur : idle/checking/scanning/ready/no-media/folder-not-found ; états connexion par recorder : offline/checking/connected/error. Le smoke teste le bridge, les vues de version et les scans mock via API ; il ne valide pas tous les clics/sélections ni les courses de navigation.

## Queue et transitions effectivement observées

```text
pending -> running -> done                            (sans hash)
                   -> verifying -> verified           (hash local/flux)
                                -> checksum-error
                   -> error                           (copie/disque)
pending/running/verifying/error/checksum-error -> cancelled
error/checksum-error/cancelled -> pending              (retryJob)
running -> skipped                                    (destination ignorée)
```

L'état running est fixé avant résolution de destination. `finishedAt` peut être défini à la fin de copie avant la fin de vérification. `running=false` signifie ordonnanceur arrêté ou pause, pas nécessairement « aucune I/O active ». La pause n'est pas un état de job. La course **verifying → cancelled → verified** est observée par HASH-CANCEL : la machine V1 n'est pas une référence de sécurité à reproduire en V2.

Le scheduler relit les settings au lancement ; les nouveaux jobs capturent le checksum mais pas la politique doublons. `QueueOptions.duplicatePolicy` est accepté par l'API mais ignoré par `addJobs`, puis `runJob` utilise la politique des settings (QUEUE-04). Pas de file durable, pas de reprise REST, pas d'auto-retry. Une nouvelle instance part vide (QUEUE-06) ; le comportement après kill d'un processus n'est pas testé ici.

## Destination, doublons, progression et intégrité

Modes : direct → basename ; recorder → nom assaini/basename ; recorderDate → nom/date UTC/basename. L'arborescence source n'est pas conservée. Deux sources distinctes peuvent partager la destination (DEST-01). Le test QUEUE-05 confirme que deux départs concurrents reçoivent le même chemin, sans réservation.

Ordre de `resolveDestination` : si le fichier existe et taille identique connue, **skip pour toutes les politiques**, même overwrite. Sinon skip ignore, overwrite réutilise le nom, rename et ask produisent `_copy`, puis `_copy_2` etc. `ask` ne provoque pas de dialogue. Une égalité de taille ne vérifie aucun contenu (DUP-SAME-*, DUP-DIFF-*).

Le callback FTP fixe transferred, débit instantané delta octets/delta temps, ETA si taille connue. À la fin de copie, transferred est forcé à la taille annoncée si connue ; le moteur ne confronte pas le stat local à cette taille. SIZE-MISMATCH le montre avec un adaptateur ayant retourné un succès et 4 octets pour 100 annoncés ; cela ne prétend pas qu'un recorder réel se comporte ainsi.

Mode none → done, sans hash. md5/sha256/both → hash streaming à l'entrée puis relecture locale avec comparaison aux hashes attendus. Mismatch ou erreur de relecture → checksum-error. Sans expectedHash, V1 calcule un hash local puis marque quand même verified (HASH-NO-EXPECTED), comme en mock. Cela n'est ni une preuve de checksum distant, ni une garantie de taille. Le test WIRE-04 exerce réellement le flux/écriture/hash basic-ftp ; HASH-* exerce la queue et la relecture, transport injecté.

## IPC Electron : contrats complets

`preload.ts` expose `window.hyperdeck` via contextBridge. **16 invocations + 3 abonnements**, aucun accès Node renderer. Tests IPC-01 : chaque envelope et unsubscribe ; IPC-02 : handlers d'erreurs principaux. Pas de validation runtime complète à l'entrée.

| API / canal | Argument sérialisé | Retour / erreur |
| --- | --- | --- |
| getSettings / settings:get | aucun | AppSettings, secrets FTP inclus en V1 |
| saveSettings / settings:save | AppSettings | AppSettings normalisés ; rejet d'écriture propagé |
| testRecorder / recorder:test | RecorderConfig | `{ok,message}` ; échecs capturés, pas rejetés |
| scanMedia / media:scan | `{recorderId,path}` | MediaEntry[] ; recorder absent / chemin / FTP rejettent |
| chooseDestination / destination:choose | aucun | chemin choisi et settings sauvegardés ; annuler → chaîne vide |
| addJobs / queue:add-jobs | `{sources:QueueSource[],options:QueueOptions}` | `{added,skipped}` ; destination vide rejetée |
| startQueue / queue:start | aucun | QueueSnapshot, settings.recorders utilisés |
| pauseQueue / queue:pause | aucun | QueueSnapshot |
| cancelJob / queue:cancel-job | jobId | QueueSnapshot |
| retryJob / queue:retry-job | jobId | QueueSnapshot |
| clearFinished / queue:clear-finished | aucun | QueueSnapshot |
| getQueue / queue:get | aucun | QueueSnapshot |
| getLogs / log:get | aucun | LogEntry[] |
| getNetworkInterfaces / network:get-interfaces | aucun | NetworkInterfaceInfo[] |
| startHyperDeckSearch / network:hyperdeck-search:start | HyperDeckSearchRequest | `{scanId}` ; exception validation CIDR propagée |
| cancelHyperDeckSearch / network:hyperdeck-search:cancel | scanId | void, id absent ignoré |
| onQueueUpdated / queue:updated | callback | snapshot complet ; fonction unsubscribe |
| onLogEntry / log:entry | callback | timestamp/level/message ; unsubscribe |
| onHyperDeckSearchProgress / network:hyperdeck-search:progress | callback | scanId/status/scanned/total/candidates/confirmed/message/results ; unsubscribe |

## Garanties à conserver et changements explicitement requis

Conserver : plusieurs appareils, ajout manuel, lecture seulement, anonymous et fallbacks legacy, chemins protocolaires `/`, listing réel sans volumes fictifs, multi-fichiers, plafonds de concurrence, pause des départs, réessai explicite, erreurs isolées par job, options de checksum et logs opérateur.

Corriger dans le futur moteur : collisions, partiels au nom final, statut verified ambigu, annulation du hash, contrôle de taille, perte d'identité `#/?`, validation des noms locaux et des paramètres. Ne pas faire passer les tests de défauts V1 pour des tests d'acceptation V2. Chaque différence prévue est reliée à une exigence dans [TRANSFER_SAFETY_SPEC.md](TRANSFER_SAFETY_SPEC.md).
