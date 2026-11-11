# Validation du moteur Rust — lot 2

Session du 10 novembre 2026, Europe/Luxembourg. Branche `feat/rust-v2-core`, créée depuis `origin/main` **f69995301b040a7bb35157e3618115027fea7be3**. Le lot 1 a été repris dans un commit préalable car GitHub indiquait PR #2 fermée sans fusion et ses documents absents de main. Ce point est décrit dans [l'implémentation](RUST_CORE_IMPLEMENTATION.md) ; aucune fusion ni modification de main n'est effectuée ici.

## Architecture et périmètre livrés

Quatre crates sous `v2/` : domaine validant, cœur acteur/ordonnanceur, infrastructure simulée et DTO sérialisables versionnés. Les ports ne dépendent d'aucune UI et ne permettent aucune écriture distante. Les scénarios utilisent des recorders fictifs et des fichiers locaux réels dans des répertoires temporaires privés. Aucun adaptateur FTP réel, application Tauri, refonte React, packaging, updater ou reprise persistante après crash.

Le moteur gère des lots immuables, plusieurs recorders, budgets global/par recorder/vérification, pause des départs, annulation, réessai avec AttemptId neuf et historique, progrès u64, MD5/SHA-256, taille et fin effective, publication, arrêt contrôlé, snapshots et événements bornés. Un exemple lançable réalise deux copies vérifiées avec collision de noms résolue.

## Résultats locaux exécutés

Environnement : **macOS 26.1, arm64**, rustc **1.99.1** et cargo **1.99.1**, Node **24.22.0**. L'outillage Rust stable préexistant a été utilisé avec un cache de dépendances temporaire dédié ; aucune installation système. Les dépendances directes sont exactes et Cargo.lock est commité.

| Contrôle | Résultat exécuté | Portée |
| --- | --- | --- |
| `cargo fmt --all --check` | Réussi | Workspace entier |
| `cargo clippy --workspace --all-targets --locked -- -D warnings` | Réussi | Bibliothèques, tests et exemple ; aucun lint général désactivé |
| `cargo test --workspace --locked` | **39 tests réussis**, 0 échec, 0 ignoré | 7 domaine + 32 intégration ; scénarios décrits ci-dessous |
| `cargo build --workspace --locked` | Réussi | Build natif macOS ARM64 |
| `cargo run --locked -p hmp-infra --example simulate` | Réussi | Deux jobs verified, destinations distinctes, scope flux/local dans le JSON |
| `npm run build:app` | Réussi | Electron V1 main/renderer + Vite et PNG originaux |
| `npm run test:ftp-paths` | Réussi | Sept cas V1 historiques |
| `npm run test:characterization` | **72/72 réussis**, 0 skip | Corpus lot 1 restauré, écoute FTP uniquement loopback |
| Diff production | `src/`, assets, icônes et lockfile npm inchangés | Le lot Rust ne modifie pas le moteur Electron |

La première compilation a exposé une erreur de signature d'alias Result dans les macros d'identité, corrigée avant validation. Le premier Clippy a relevé le double must_use généré par async-trait 0.1.89 avec Rust 1.99 ; passage verrouillé à 0.1.92, puis contrôles réussis. Aucun succès intermédiaire incomplet n'est compté comme résultat final.

Preuve expurgée : [v2/tests/lot2-macos.json](../v2/tests/lot2-macos.json), noms des 39 tests passés et empreintes SHA-256 des sources/lockfile/fixtures de cette exécution. Aucun chemin utilisateur ou log de credentials n'y est stocké. Le corpus réutilise les **19 cas** de `tests/fixtures/v1-paths.json`, avec corrections explicites des comportements V1 dangereux.

## Garanties SAFE-01 à SAFE-12 exercées

| Exigence | Test(s) exécuté(s) / résultat |
| --- | --- |
| SAFE-01 | Temporaire exclusif ; deuxième ouverture refusée ; réserve forgée rejetée ; final absent et partiel réel visible avant la gate de publication |
| SAFE-02 | Jobs simultanés Clip.mov/clip.mov réservés et renommés ; destinations et octets distincts ; fichier existant apparu tardivement jamais écrasé implicitement |
| SAFE-03 | Même taille/contenu différent : overwrite explicite copie, skip reste Skipped sans hash, rename produit une autre destination ; aucune taille égale ne crée Verified |
| SAFE-04 | Options du lot clonées et figées ; changements ultérieurs des valeurs externes/settings n'altèrent pas overwrite/checksum choisis |
| SAFE-05 | Interruption après un chunk : erreur et partiel PART, autre recorder terminé ; EOF sans succès de fin ne publie jamais ; timeout connexion typé |
| SAFE-06 | Écriture partielle ENOSPC injectée : compteur écrit 2, fichier DA, original intact ; erreurs d'ouverture, flush et commit interdisent le succès |
| SAFE-07 | Annulation pendant relecture et avant commit : jamais verified ; après commit : AlreadyTerminal ; **32 courses concurrentes** publication/cancel concordent avec l'acquittement et préservent l'ancien fichier si cancel accepté |
| SAFE-08 | Hash de relecture corrompu et erreur de lecture locale : ChecksumError et aucune publication |
| SAFE-09 | Calcul local seul explicitement LocalOnly ; copies vérifiées uniquement TransferStreamComparedToLocal, jamais « distant » |
| SAFE-10 | 4 octets reçus pour 100 attendus → SizeMismatch, pas done ; métadonnée de fin modifiée → SourceChanged ; zéro octet/taille inconnue couverts |
| SAFE-11 | /, /1, /2, préfixes et URLs connus conservés ; #/? bruts et Unicode préservés ; traversal/contrôles/noms Windows dangereux refusés ; mapping local ASCII réversible |
| SAFE-12 | Shutdown annule pending/actifs et retourne actifs=0, sessions/readers/réservations libérés, aucun final ; abandon du dernier handle nettoie sans callback UI ; partiels identifiables conservés pendant la vie du sandbox |

Autres preuves : limites de concurrence globale et recorder, pause/drain/reprise, budget de vérification indépendant, erreurs d'authentification isolées, discovery/listing synthétiques sans volumes inventés, identités média stables, sources simulées inchangées, nouvelles tentatives sans réutilisation d'ID, état terminal immuable face aux messages tardifs, snapshots détachés, entrée DTO validante et u64::MAX sans perte, événements bornés avec Lagged explicite.

## macOS et Windows

**macOS ARM64 local : exécuté et réussi** comme ci-dessus. Aucune machine Windows n'est utilisée localement. La CI `.github/workflows/rust-core.yml` prévoit des runners natifs **macos-latest / windows-latest**, Rust 1.99.1, fmt/clippy/test/build avec lockfile. Les actions sont référencées par leurs SHA vérifiés ; permissions contents:read et aucun secret requis.

**CI native exécutée et réussie avant la PR** : [run 42848553663](https://github.com/nakuakaben/hyper-media-puller/actions/runs/42848553663), commit moteur `2de4ba026bb07757563f0210afc1a1f42e0de86e`. Les journaux ont été lus, pas seulement le statut global. macOS utilise l'image `macos-26-arm64` / `aarch64-apple-darwin`, Windows l'image `windows-2025-vs2026` / `x86_64-pc-windows-msvc`, tous deux avec rustc 1.99.1.

| Runner natif | Format | Clippy strict | Tests | Build |
| --- | --- | --- | --- | --- |
| macOS ARM64 | Réussi | Réussi | 7 domaine + 32 intégration, 0 échec/ignoré | Réussi |
| Windows x64 MSVC | Réussi | Réussi | 7 domaine + 32 intégration, 0 échec/ignoré | Réussi |

La mise à jour finale après ce run est uniquement documentaire : le code, le lockfile, le workflow et les tests restent ceux du commit validé. La [preuve CI expurgée](LOT2_CI_RESULTS.json) conserve les IDs, résultats des étapes et comptes lus dans les logs. La validation d'installateurs, NTFS/exFAT/disques externes, Intel macOS/ARM Windows et appareils physiques reste distincte de cette CI simulée.

## Limites et réserves concrètes

- La destination est un **adaptateur de test** en répertoire privé, pas un accès de production à un dossier utilisateur. Les garanties de publication/réservation sont testées dans ce cadre ; confinement hostile, reparse points, filesystem réseau et durabilité après coupure électrique restent à qualifier.
- Les I/O du sandbox sont synchrones et courtes. Le port commit doit être court et atomique car l'acteur ne traite pas d'annulation pendant son exécution. Une panique d'un adaptateur tiers n'est pas une erreur normale couverte par ce contrat.
- Les partiels restent inspectables tant que le sandbox est détenu ; TempDir nettoie le bac à sable à sa destruction. Cela ne fournit ni journal durable, ni reprise après kill/crash, ni gestion de médias opérateur.
- La simulation distante stocke ses fixtures en mémoire ; le pipeline cœur utilise un buffer borné de 64 Kio. Aucun gros média physique >4 Gio n'est transféré ; u64::MAX est testé comme compteur/DTO.
- Les noms locaux sont limités à 200 octets ASCII ; un mapping automatique trop long échoue explicitement. La prise en charge des encodages firmware et un mapping complet des noms très longs restent au futur adaptateur.
- Les progrès sont des compteurs reçus/écrits/vérifiés, sans débit/ETA calculé et sans agrégation à fréquence UI. Le broadcast est borné et expose son retard ; aucun rapport persistant de copie n'est créé.
- Aucun HyperDeck, notamment Studio Mini 2017, n'a été contacté. Aucun résultat FTP réel, firmware, benchmark ou compatibilité matériel n'est déduit des doubles.

## Suite et point d'arrêt

Le moteur est compilable, indépendant de l'interface et exécute les scénarios simulés complets. Après publication de la PR en brouillon, **attendre validation avant le lot 3**. Prochaine étape recommandée : adaptateur de lecture FTP réel et qualification des stratégies legacy avec le corpus, puis Studio Mini 2017 et modèle récent ; prévoir aussi l'adaptateur de destination de production et sa qualification filesystem. Aucune fusion ni release automatique.
