# Audit de préparation Rust V2

Audit du 10 novembre 2026. Base : commit [`8881ec3`](https://github.com/nakuakaben/hyper-media-puller/commit/8881ec3c4ad4a79d145af0f3271343836d209dbb), HMP 1.1.0. Cette mission produit des documents, pas une implémentation V2.

## Périmètre et niveau de preuve

Le dossier initial était vide. HTTPS Git sans identifiants et SSH sans clé utilisable ont échoué. Les 45 fichiers ont été récupérés via le connecteur GitHub et les URL de téléchargement GitHub ; l'arbre Git local reconstruit a exactement le SHA `53303315c63fb535e735251ddad7092f6a625e92` du commit source. Le commit original a également été reconstitué avec vérification de son SHA ; l'historique local est superficiel à cette base. Cela vérifie l'intégrité de l'export, sans prétendre disposer de tout l'historique.

« Implémenté » signifie qu'un chemin de code réel a été lu. « Partiel » indique une limitation identifiée. Aucun HyperDeck physique ni transfert réel n'a été testé pendant cette mission. Les validations antérieures de `PROJECT_STATUS.md` restent des preuves historiques distinctes.

## Architecture et dépendances

Le main Electron possède réseau, FTP, queue, configuration et disque. React appelle `window.hyperdeck` via `preload.ts` / `contextBridge` et les contrats `src/shared/{api,ipc,types}.ts`. `ipc.ts` enregistre les handlers et publie les snapshots. `main.ts:29-42` désactive Node dans le renderer et active l'isolation de contexte, mais conserve `sandbox: false`. Les arguments IPC sont typés TypeScript, sans validation exhaustive à l'exécution.

Le renderer est concentré dans `src/renderer/main.tsx` (~1 060 lignes) et `styles.css` ; les services main sont déjà séparés, ce qui fournit les frontières de migration. Aucun code Rust/Cargo ni workflow CI n'est présent dans l'arbre audité.

| Ensemble | Déclaration package.json | Rôle / implication |
| --- | --- | --- |
| Electron | ^43.1.0 | Fenêtre, bridge, dialogues, userData ; runtime à remplacer |
| React / React DOM | ^18.3.1 | Composants réutilisables conceptuellement avec Tauri |
| basic-ftp | ^5.0.5 | Connexion, listing, RETR, progression ; compatibilité à caractériser |
| electron-log | ^5.2.4 | Log fichier et notifications ; adaptateur Rust nécessaire |
| TypeScript / Vite | ^5.7.2 / ^6.0.6 | Compilation main / renderer ; Vite conservable |
| electron-builder | ^26.15.3 | NSIS et portable Windows ; pipeline distinct à conserver |
| concurrently / wait-on / cross-env | ^9.1.2 / ^8.0.1 / ^7.0.3 | Orchestration de développement |

Les versions effectivement installées sont celles de `package-lock.json` (par exemple Vite 6.4.3 dans le build), pas nécessairement les minima ci-dessus.

## État réel des fonctionnalités

| Fonction | État constaté | Preuve / limite |
| --- | --- | --- |
| CRUD plusieurs recorders | Implémenté | `config-store.ts`, handlers IPC, sidebar React ; paramètres JSON persistés |
| Découverte multiple | Implémentée, matériel non validé | `network-service.ts:309-417` : workers, résultats multiples, progression et annulation |
| Découverte réseau universelle | Partielle | IPv4 privé/link-local, /24 à /32, 254 hôtes maximum, aucun mDNS/IPv6 ; port 9993 requis pour confirmation automatique |
| Choix interface | Partiel | Inventaire OS et CIDR ; `interfaceId` est journalisé mais les sockets ne sont pas liés à l'adresse locale sélectionnée |
| Identification | Implémentée avec heuristiques | `ping` / `device info`, analyse de texte et statut inconnu ; pas une preuve d'identité cryptographique |
| Navigation FTP / volumes | Implémentée | `scanMedia`, tri dossiers avant fichiers, racine et breadcrumbs ; aucun `/1` ou `/2` fictif en mode réel |
| Anciens modèles | Fallbacks implémentés | Connexion et listing legacy ci-dessous ; Studio Mini 2017 à revalider physiquement |
| Sélection fichiers/dossiers | Implémentée | Sélection par chemin dans le navigateur courant, expansion récursive main ; changer de recorder efface la sélection courante |
| Queue multi-fichiers / recorders | Implémentée | `queue-service.ts:73-257` ; concurrence globale, option éviter le même recorder |
| Pause / annuler / réessayer | Partiel | Pause des nouveaux départs ; copie active continue. Réessai manuel repart à zéro, sans REST ni reprise persistante |
| Détection déjà copié | Partielle | Destination existante de même taille ignorée ; aucune identité fiable source/contenu |
| Progression / débit / ETA | Implémentés | Octets basic-ftp et snapshots ; octets inconnus et skipped rendent le total distinct des octets réellement copiés |
| Vérification MD5 / SHA-256 | Implémentée, portée limitée | Hash du flux entrant comparé à la relecture locale ; aucun hash distant indépendant |
| Erreurs réseau | Implémentées, couverture partielle | timeouts, fermeture des sessions, erreurs jobs et réessai manuel ; pas de reprise automatique robuste |
| Paramètres / logs | Implémentés | `settings.json`, log local, 500 entrées exposées en lecture ; mot de passe FTP en clair dans paramètres |
| Rapports de copie persistants/export | Absents | Queue et logs existent ; aucun modèle de rapport/export dans API/IPC/renderer audités |
| Version / notes de mise à jour | Implémentées | `src/shared/version.ts`, `releaseNotes.ts`, modal ; aucun updater automatique |
| Simulation | Implémentée explicitement | mock désactivé au démarrage ; ne constitue pas une validation réseau ou d'intégrité réelle |
| Packaging | Configuré surtout Windows | Scripts NSIS/portable ; icône macOS présente mais distribution macOS non validée ici |

## Contrat FTP legacy à préserver

Sources principales : `ftp-service.ts:45-88,102-129,148-199,220-274`, `path-utils.ts:3-46`.

1. Utilisateur vide devient `anonymous`. Pour anonymous sans mot de passe configuré : essayer successivement vide, `anonymous@hmp.local`, `guest@`. Chaque échec ferme le client et crée une nouvelle session. Fallback seulement sur les erreurs reconnues (501/530 ou texte d'authentification). Un mot de passe explicite reste l'unique tentative.
2. FTP actuel non chiffré (`secure: false`). Ne pas imposer FTPS aux modèles anciens. La stratégie passive effective de basic-ftp et les commandes de préparation de session doivent être capturées avant portage ; elles ne sont pas définies intégralement par HMP.
3. Lister avec les commandes candidates `LIST -a`, `LIST` (MLSD n'est pas imposé). Essayer le chemin normalisé ; si 501 ou échec à la racine, fallback legacy. Pour un sous-dossier : `CWD chemin` puis listing sans argument. Pour `/` : listing sans argument dans une session neuve. Conserver les dossiers réellement retournés et exclure `.` / `..`.
4. Normaliser vide → `/`, `1` → `/1`, préfixe `HyperDeck Studio Mini:/2` → `/2`, URL FTP → pathname ; convertir les antislashs et refuser le segment `..`. Ne pas utiliser les chemins Windows pour le protocole distant.
5. RETR uniquement pour les médias. L'adaptateur V2 ne doit exposer ni upload, ni suppression, ni renommage distant, ni commandes de transport. La découverte reste limitée aux requêtes d'information.

La normalisation actuelle supprime également les suffixes `?` et `#`, même pour un nom brut : risque de perte d'identité pour certains noms. Distinguer à l'avenir saisie d'URL et chemin FTP brut, avec tests de caractérisation et décision explicite sur les changements.

## Risques concrets à traiter par lots séparés

| Priorité | Constat de code | Conséquence / traitement proposé |
| --- | --- | --- |
| Haute | `downloadFile` écrit directement au nom final ; erreurs/annulations ne retirent pas les partiels | Un partiel peut être confondu avec un média complet ; proposer `.part` puis finalisation atomique après validation |
| Haute | `resolveDestination:413-435` ignore toujours une taille égale avant la politique overwrite/rename | Même taille ≠ même contenu ; afficher « existant, taille identique », jamais « vérifié » |
| Haute | `buildDestinationPath` ne conserve que le basename ; test d'existence et ouverture séparés | Collision entre sous-dossiers ou appareils en mode direct, course entre jobs ; réservation exclusive de destination nécessaire |
| Haute | `sanitizePathSegment` ne couvre pas les noms réservés Windows ; nom média peu assaini | Définir mapping réversible, confinement local, Unicode, casse et noms réservés sans modifier la source |
| Haute | `cancelJob` ferme le FTP, mais `checksumFile` n'est pas annulable ; `verifyChecksum` peut finir par verified | Tester l'annulation pendant vérification ; token d'annulation sur toutes les étapes et transitions terminales protégées |
| Moyenne | Queue uniquement dans `jobs[]` ; réessai efface compteurs | Fermeture perd l'état ; persistance et reprise éventuelle à décider, pas à présumer existantes |
| Moyenne | `QueueOptions.duplicatePolicy` n'est pas capturée dans chaque job | La politique utilisée est celle des settings au lancement ; figer les options de chaque lot en V2 |
| Moyenne | `nextPendingJobs` ne compte que running pour la contrainte recorder | Vérification locale peut coexister avec nouvelle copie : préciser la politique I/O voulue |
| Moyenne | `DuplicatePolicy` contient ask sans traitement dédié ni option UI | Ne pas annoncer de dialogue de résolution existant ; actuellement une taille différente suit le renommage |
| Moyenne | Réponses de scan UI appliquées sans garde de génération | Changement rapide de recorder : risque d'afficher une réponse ancienne sous le nouveau recorder ; tester et isoler les identités |
| Moyenne | Configuration JSON et secrets renvoyés au renderer | Import V1 en lecture seule, validation runtime, secrets côté backend et stockage OS à étudier |
| Moyenne | Callbacks snapshots envoient la queue complète à chaque progression | Coût croissant ; événements ciblés et limités en fréquence en V2 |
| Moyenne | Fenêtre macOS recréée via activate et IPC enregistrés dans createWindow | Risque de handlers déjà enregistrés ; cycle natif à tester séparément du build |

Ces constats sont des conclusions de lecture, pas des incidents reproduits. Aucun correctif fonctionnel n'est introduit par cette PR.

## Ressources, scripts et documentation

Quatre PNG réels conservés : `hyperdeck-studio-hd-mini.png`, `hyperdeck-studio-hd-plus.png`, `hyperdeck-studio-4k-pro.png`, `hyperdeck-extreme-8k.png` dans `assets/devices/`. Le matcher UI associe aussi « Studio Mini » au PNG HD Mini : il n'existe pas de PNG distinct 2017 dans cet inventaire. Demander une image exacte ou assumer explicitement un repère générique ; ne pas inventer une illustration de modèle.

`build/` contient ICO, ICNS et PNG applicatifs. `design/hmp-ui-reference.png` est une ancienne maquette, pas une capture d'application. La refonte autorisée remplace la direction cyan prescrite par l'ancien AGENTS.md, sans changer le code UI dans cette mission.

`build:app` synchronise la version sans incrément ; `build` lance `version:bump` et ne doit pas servir de simple contrôle. `verify-icons.mjs` affiche les absences sans échouer : sa réussite seule ne prouve pas la présence des icônes. Les notes de version sont des données embarquées.

README, architecture, développement et état antérieur sont utiles, mais « présent » n'y équivaut pas à « validé sur matériel ». Aucun manifeste de licence HMP n'est présent ; clarifier les droits des actifs avant redistribution.

## Vérifications effectuées dans cette mission

Environnement macOS ; Node 24.22.0 / npm fourni avec cette installation. Première tentative avec Node 20.19.0 : avertissements de moteurs (Electron exige >=22.12), puis erreur interne npm dans le sandbox ; remplacée par l'installation Node 24 réussie.

| Contrôle | Résultat de cette mission |
| --- | --- |
| Intégrité sources / binaires | Arbre Git exact et commit source vérifiés |
| `npm ci` avec Node 24 | Réussi : 376 packages ajoutés, 377 audités |
| `npm run build:app` | Réussi : TypeScript main/renderer, Vite, quatre PNG embarqués |
| `npm run test:ftp-paths` | Réussi : les sept cas existants de normalisation |
| `npm audit --json` | Exécuté : 25 vulnérabilités, 7 modérées / 17 hautes / 1 critique |
| `smoke:dev` | Non exécuté : modifie le profil Electron réel ; pas d'isolation userData dans le script existant |
| FTP matériel / gros volumes / interruption / checksum réel | Non exécutés |
| Exécution native UI / captures / packaging macOS et Windows | Non exécutés ; compilation seule validée |

Le smoke existant contient des assertions de bridge, mock queue, concurrence, annulation, renommage, logs et erreur FTP ; son faux HyperDeck dépend de 9993. Il ne remplace pas les tests de fallbacks FTP legacy, de collision ni d'arrêt pendant hash. Aucun nouveau test applicatif n'est ajouté à cette PR documentaire.

L'audit npm signale directement basic-ftp (parseur LIST, déni de service) et indirectement shell-quote (critique). Le score npm ne prouve pas l'exploitabilité de chaque chemin applicatif. Examiner séparément runtime/outillage avant distribution ; ne pas lancer de mise à jour majeure automatique. Avis : [basic-ftp](https://github.com/advisories/GHSA-c475-qrg2-pj4r), [shell-quote injection](https://github.com/advisories/GHSA-pqg4-j6r4-53mv). Les détails complets sont reproductibles avec `npm audit --json` ; aucun rapport contenant des chemins utilisateur n'est commité.

Suite : [architecture](RUST_ARCHITECTURE_PROPOSAL.md), [refonte UI](UI_REDESIGN_PLAN.md), [roadmap et validations](V2_MIGRATION_ROADMAP.md).
