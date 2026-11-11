# Implémentation du moteur Rust — lot 2

10 novembre 2026. Implémentation réelle sous `v2/`, indépendante d'Electron, Tauri et React. Les interfaces et garanties sont issues des contrats du lot 1 ; aucune commande d'écriture distante n'existe. Les [résultats exécutés](LOT2_VALIDATION_REPORT.md) sont séparés des qualifications futures.

## Base et préparation Git

Au début de session, GitHub `main` pointe sur `f69995301b040a7bb35157e3618115027fea7be3`, arbre `c068cd02844ea1ed037c6c7362461d92af61fca9`. La PR #1 est fusionnée. Contrairement au contexte fourni, la PR #2 est fermée avec `merged=false` ; ses cinq documents et tests manquent dans main. Son contenu a donc été repris dans un commit préalable sur **feat/rust-v2-core**, créée depuis ce véritable origin/main. Aucune ancienne branche n'est réutilisée, main n'est pas modifiée et aucune PR n'est fusionnée par cette mission.

L'accès Git CLI étant dépourvu d'authentification utilisable dans cet environnement, l'actualisation utilise le connecteur GitHub et des objets Git vérifiés par SHA, comme aux lots précédents. Le commit signé de main a été récupéré et vérifié localement ; l'historique reste superficiel à la base d'origine. La publication est effectuée par les API GitHub, sans force push.

## Architecture construite

| Crate / fichier | Contenu réellement implémenté |
| --- | --- |
| `hmp-domain/src/lib.rs` | UUID non nuls, Recorder, RemotePath, LocalName, MediaEntry, JobRequest, TransferBatch/Job, états, erreurs, progression u64, checksum et historique de tentatives |
| `hmp-core/src/lib.rs` | API async et acteur unique ; queue FIFO d'ajout, lots démarrés/pausés, concurrence globale/par recorder, snapshots, souscription et arrêt |
| `hmp-core/src/worker.rs` | Pipeline streaming, délais par opération, annulation, hashes d'entrée/relecture, contrôle EOF/fin protocole/tailles et handoff vers commit |
| `hmp-core/src/ports.rs` | DiscoveryPort, RemoteReadPort/Session/Reader, DestinationPort, LocalWriter/Reader, SettingsPort, EventSink, Clock et IdSource ; aucun type UI |
| `hmp-infra/src/simulation.rs` | Recorders et médias synthétiques, listing dérivé des médias réels de la simulation, gates manuelles, erreurs/timeouts, métriques ressources/concurrence, settings mémoire |
| `hmp-infra/src/sandbox.rs` | Fichiers temporaires exclusifs dans un TempDir privé, réservations, lecture locale, flush/sync, publication et erreurs injectables |
| `hmp-contract/src/lib.rs` | Entrée enqueue validante, DTO recorder/média/lot/job/erreur/hash/snapshot/événement, schéma version 1 et chaînes décimales sans perte JS |
| `v2/tests/safety.rs` | Tests de bout en bout ; les scénarios V1 dangereux sont inversés en exigences V2 |
| `hmp-infra/examples/simulate.rs` | Scénario lançable à deux recorders, collision résolue, MD5/SHA-256, snapshot JSON |

Le cœur dépend seulement du domaine, de Tokio, async-trait et des bibliothèques de hash. L'infrastructure implémente les ports du cœur ; les DTO dépendent des modèles/snapshots sans imposer la sérialisation au domaine. Les dépendances directes sont fixées et le graphe exact est dans Cargo.lock. async-trait 0.1.92 évite les attributs générés redondants signalés par Clippy 1.99 avec l'ancienne macro ; aucun lint général n'a été désactivé pour faire passer les contrôles.

## API et états

`Engine::spawn(ports, config)` démarre l'acteur dans un runtime Tokio. `enqueue_batch` valide les identités, fige les demandes et options du lot, puis retourne BatchId. Les paramètres sont distincts des settings ultérieurs. Les commandes sont `start`, `pause`, `cancel`, `retry`, `snapshot`, `subscribe`, `shutdown`.

La pause ne bloque que les nouveaux départs ; les actifs finissent. Une fois un lot entièrement terminé et nettoyé, son drapeau started revient à false. Réessayer un lot arrêté laisse donc le job pending jusqu'à start. Si le lot continue sur d'autres jobs, un retry manuel accepté peut être ordonnancé normalement. Un retry pendant le nettoyage de l'ancienne tentative retourne Busy. Le JobId reste stable, l'AttemptId change et l'historique conserve résultat, erreur et compteurs précédents.

Le flux normal est Pending → Running → Verifying (si hash) → Finalizing → Verified ; sans hash : Running → Finalizing → Done. Le worker reçoit Running dès sa réservation planifiée ; une politique skip peut donc produire Running → Skipped avant toute lecture distante. Erreurs et annulations sont terminales pour la tentative. Un callback avec l'ancienne tentative, une progression décroissante/impossible ou un état terminal est refusé ; une tentative passée ne peut pas être réutilisée.

Les jobs et options sont privés aux modèles avec getters ; les snapshots sont des clones détachés. Les structs de progression/erreur sont des valeurs, validées lors de leur application. Une clé de média est le couple RecorderId/RemotePath ; elle identifie un emplacement, pas un contenu immuable. La taille est optionnelle et jamais substituée aux octets effectivement écrits.

## Ordonnancement et vérification

Un acteur reçoit des commandes bornées et des messages workers bornés. Il possède seul les jobs et accepte leurs transitions. La limite globale compte tout pipeline actif, ce qui est volontairement conservateur. La limite par recorder compte la phase réseau ; elle est libérée après fin de lecture et fermeture de la session. Un sémaphore séparé limite les relectures/hash locaux. Défauts : deux pipelines globaux, un réseau par recorder, une vérification.

Chaque worker utilise un buffer de 64 Kio pour lecture, écriture et hash. Les fixtures distantes peuvent être en mémoire, mais le moteur ne charge jamais un média complet. Une opération de port attendue passe dans une sélection annulation/timeout ; le timeout est **par opération**, pas une durée maximale globale de lot. Les sessions et readers des adaptateurs doivent libérer leurs ressources au Drop, même lorsque leur future est abandonnée.

MD5 et SHA-256 sont calculés sur les octets reçus puis comparés à une relecture du temporaire. Le nombre d'octets relus est également comparé. LocalOnly est disponible via `calculate_local_checksum` et ne certifie pas une copie ; seul TransferStreamComparedToLocal produit Verified dans le moteur. Aucune empreinte indépendante distante n'est prétendue. EOF données, réponse de fin simulée, tailles attendue/reçue/écrite et métadonnée de fin sont contrôlés avant finalisation.

## Réservations, partiels et point de publication

Le nom local est un composant portable validé, distinct du chemin FTP. Le mapping automatique hex ASCII du basename est réversible et distingue casse/Unicode, # et ? sans les perdre. Le constructeur de nom local impose une longueur maximale de 200 octets ; un nom encodé trop long est refusé explicitement, avec possibilité de fournir un autre nom local valide. Aucune troncature ni empreinte silencieuse ne prétend préserver le nom.

Dans le bac à sable, les clés de réservation comparent les noms ASCII sans casse ; les noms Unicode bruts sont mappés en ASCII avant utilisation. Rename réserve un nom libre ; Skip ne signifie qu'existant non vérifié ; Overwrite est explicite et ne détruit pas l'ancien fichier pendant le transfert. Un nom déjà réservé ne peut pas être partagé par deux writers. Chaque tentative crée exclusivement `.hmp-<job>-<attempt>.part` avec create_new.

Le writer termine flush/sync et ferme avant relecture. `prepare_commit` peut attendre et être annulé. Ensuite le worker envoie Ready ; l'acteur vérifie job/tentative/état, passe Finalizing et appelle `commit` **sans await**. La publication et le statut terminal appartiennent ainsi au même tour. Une annulation traitée avant ce tour ferme la tentative ; un Ready tardif ne publie pas. Après publication, cancel retourne AlreadyTerminal et ne supprime rien.

Le sandbox utilise un hard link pour publication sans remplacement et un rename pour overwrite explicite, dans le même répertoire. Un échec de finalisation ne vaut pas succès. Une erreur ou annulation garde le partiel identifiable et libère la réservation ; chaque retry obtient un nouveau nom de partiel. `shutdown` attend les messages de nettoyage avant de retourner un snapshot actif=0. Abandon du dernier handle déclenche également l'arrêt ; cela ne constitue pas une reprise après crash.

## Événements et contrats UI futurs

Événements typés : création de lot, contrôle de lot, changement de job et changement de nombre d'actifs. Numéro de séquence et horodatage proviennent de l'acteur. `subscribe` renvoie, dans un même tour, snapshot et receiver associé : le watermark permet de reprendre sans trou. Le broadcast et le RecordingSink sont bornés à 256 événements ; un consommateur en retard reçoit explicitement Lagged et doit reprendre un snapshot. Les progrès sont actuellement publiés par chunk avec backpressure, sans agrégation à 5–10 Hz ; cette agrégation est à prévoir au bridge UI, avant une charge réelle.

Les compteurs sont u64 dans le domaine et chaînes décimales dans les DTO. Les entrées sérialisées sont reconstruites par les constructeurs validants ; une version de schéma, taille non décimale/hors plage, UUID nul, chemin ou nom invalide est refusé. Les DTO ne donnent ni handle, ni chemin arbitraire d'accès disque, ni secret, ni méthode de commande distante.

## Limites de cette implémentation

Le disque fourni est **un bac à sable de tests**, avec I/O synchrones courtes ; ce n'est pas un adaptateur de production vers une destination opérateur. Les protections sont qualifiées dans ce répertoire privé, pas face à un autre processus hostile remplaçant des composants par des liens, ni sur SMB/exFAT ou après coupure électrique. Le futur adaptateur local devra confirmer confinement par capacités OS, durabilité des répertoires et atomicité par filesystem. Un port de commit fourni au moteur doit rester court, atomique et non bloquant ; une implémentation qui attend arbitrairement bloquerait l'acteur.

Pas de FTP réel, parsing des listings firmware, import de settings V1, secrets OS, génération d'un rapport persistant, reprise REST/crash, UI/Tauri, packaging ou mise à jour. Les ports en erreur retournent TransferError ; une panique d'un adaptateur tiers n'est pas une erreur de transfert prise en charge et reste hors contrat. Débits/ETA ne sont pas calculés dans ce lot : la progression fiable porte sur octets reçus/écrits/vérifiés et total connu/inconnu.

La prochaine étape reste un adaptateur réseau/FTP réel comparé au corpus legacy, puis aux appareils physiques, notamment Studio Mini 2017. Ne pas déduire sa compatibilité des tests simulés du moteur.
