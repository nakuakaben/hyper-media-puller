# Audit de préparation à la bêta HMP V2

Audit du 12 novembre 2026 sur `f929cad3071cb2feefc0172e3d46e2bebe5632d6`, après le lot 7. La Preview a franchi la qualification fonctionnelle minimale pour préparer une candidate. La distribution publique de binaires macOS ARM64 et Windows x64 reste bloquée par la qualification des installateurs, la distribution de confiance sur macOS et la vérification des droits de redistribution des actifs.

**BLOCKER** empêche le lancement public proposé. **IMPORTANT** demande une correction ou une décision documentée. **LATER** peut attendre dans le périmètre annoncé.

## Technique et sécurité

| Niveau | Constat |
| --- | --- |
| IMPORTANT | React, TypeScript et Vite rendent l’interface dans Tauri 2. La capability `preview` est limitée à la fenêtre principale et à dix commandes métier explicites. Le Rust valide les DTO, conserve les destinations choisies par le dialogue natif et pilote FTP et disque. La CSP borne les sources au contenu embarqué et à l’IPC, avec une exception pour les styles inline. Revalider les capabilities, la CSP et l’absence du mode de qualification Windows sur les binaires candidats. |
| IMPORTANT | Les garanties SAFE-01 à SAFE-12 sont couvertes par le moteur, les tests synthétiques et les essais natifs ci-dessous. Les temporaires exclusifs, réservations, contrôles de taille, publication atomique et arrêt contrôlé protègent le nom final. L’écrasement est une option explicite. Un support incapable d’assurer la publication exclusive est refusé. |
| IMPORTANT | Le FTP legacy est en lecture seule. Les replis d’authentification anonyme et de listing, EPSV/PASV, les chemins et les réponses FTP sont exercés par le corpus. Le client limite la taille des listings et valide la réponse finale de transfert. FTP et l’identification HyperDeck circulent en clair. Documenter un réseau local de confiance et limiter le périmètre aux modèles et opérations effectivement testés. |
| IMPORTANT | Coupures, délais, annulation, taille incohérente et erreurs disque sont traités. Le réessai démarre une nouvelle tentative. Des partiels peuvent rester après une erreur ou un arrêt brutal. Les rapports sont projetés depuis la session et peuvent être copiés en JSON. Ils contiennent des noms de fichiers, des chemins locaux et des informations sur l’appareil. Expliquer l’export avant fermeture et l’expurgation avant partage. |
| IMPORTANT | Le SHA-256 compare le flux reçu à sa relecture locale. Un hash local et un fichier existant ignoré ont une portée distincte. Le rapport indique tailles, états et portée de vérification. La bêta doit décrire cette portée, y compris la possibilité de choisir MD5 pour des besoins historiques. |
| LATER | Reprise après crash, archivage durable des rapports, veille et réveil, qualification complète du lecteur d’écran, changement de DPI système et multi-écrans restent à traiter. |

Références internes [spécification SAFE](TRANSFER_SAFETY_SPEC.md), [FTP et legacy](RUST_FTP_IMPLEMENTATION.md), [matrice FTP](FTP_LEGACY_TEST_MATRIX.md) et [transferts et rapports](REAL_TRANSFER_IMPLEMENTATION.md).

## Dépendances, licences et historique

| Niveau | Constat |
| --- | --- |
| IMPORTANT | `npm audit` sur les fichiers verrouillés remonte 0 paquet signalé pour le frontend V2 et 25 pour la racine Electron V1 (1 critique, 17 élevés, 7 modérés). Parmi les avis V1 figurent `shell-quote` dans l’outillage et `basic-ftp` en production. Le packaging V2 utilise son propre projet npm. Séparer la correction V1 et vérifier que la chaîne de distribution V2 n’exécute pas l’outillage V1 affecté. [Avis shell-quote](https://github.com/advisories/GHSA-pqg4-j6r4-53mv) · [Avis basic-ftp](https://github.com/advisories/GHSA-c475-qrg2-pj4r) |
| IMPORTANT | OSV Scanner 2.7.1 signale dans le verrouillage Tauri `glib 0.18.5` et `proc-macro-error 1.0.4`. `cargo tree -i glib` ne trouve aucun chemin sur les deux cibles de la bêta. Le second avis concerne la maintenance d’une macro de compilation. Aucun résultat n’est remonté pour le verrouillage du moteur. Réexécuter les scans sur le SHA candidat et examiner toute nouvelle alerte atteignable à l’exécution ou pendant la fabrication. [Avis glib](https://rustsec.org/advisories/RUSTSEC-2024-0429.html) · [Avis proc-macro-error](https://rustsec.org/advisories/RUSTSEC-2024-0370.html) |
| BLOCKER | Le dépôt publie une licence MIT. Les notices Inter OFL, Lucide et RWA sont présentes dans les sources. Les quatre PNG d’appareils et l’icône de Preview ont été repris des actifs historiques. Leur droit de redistribution n’est pas établi par les fichiers consultés. Identifier les titulaires et les permissions de ces actifs, finaliser l’inventaire des composants réellement distribués et intégrer les notices applicables à chaque package. La lecture des licences npm est complète pour le verrouillage V2. Les manifestes Rust en cache couvrent 56 des 82 entrées externes du moteur et 286 des 449 entrées externes de Tauri, toutes plateformes confondues. |
| IMPORTANT | Gitleaks 8.30.1, règles par défaut et sorties expurgées, ne remonte aucune correspondance dans les 29 commits accessibles localement, les 30 commits accessibles par le miroir GitHub (branches et têtes de PR), ni dans l’archive des fichiers suivis de `f929cad`. Ce périmètre couvre les références Git accessibles et les signatures reconnues par l’outil. Refaire l’analyse sur la candidate et conserver les rapports d’analyse hors du dépôt. |

## Qualification et distribution

| Niveau | Validation acquise et portée |
| --- | --- |
| IMPORTANT | Studio HD Plus sur macOS ARM64. Un offload physique de 101,1 Mio, suivi d’une vérification SHA-256 flux/local, d’un rapport et de la lecture de la copie. Les gros fichiers et la concurrence entre appareils ont été validés avec des fixtures, pas sur ce recorder. [Qualification macOS](MACOS_QUALIFICATION.md) · [Rapport lot 6](LOT6_VALIDATION_REPORT.md) |
| IMPORTANT | Windows x64. Qualification WebView2 native et FTP synthétique, incluant deux copies NTFS, SHA-256, annulation, coupure et réessai. Les essais de disque plein et de retrait utilisent des volumes de test. APFS et NTFS ont des preuves distinctes. exFAT est refusé par sécurité et SMB reste non qualifié. [Captures et relevé Windows](https://github.com/nakuakaben/hyper-media-puller/actions/runs/43267064789/artifacts/13967076868) · [Essais des volumes](https://github.com/nakuakaben/hyper-media-puller/actions/runs/43267064789/artifacts/13965488997) |
| LATER | Studio Mini 2017 différé. Aucun résultat physique Windows ni autre modèle n’est revendiqué. |
| BLOCKER | macOS. Le build optimisé local produit un `.app` Mach-O ARM64, version 0.1.0. La signature ad hoc de l’exécutable ne permet pas de valider le bundle avec `codesign --verify --deep --strict`. Le minimum indiqué par le Mach-O est macOS 11.0 tandis que le plist indique 10.13. Aligner les métadonnées et tester le minimum annoncé. Un DMG simple créé avec `hdiutil` a passé la vérification d’image et le montage en lecture seule. La copie du bundle vers un dossier utilisateur temporaire a conservé le binaire à l’octet près. L’étape Finder du DMG Tauri a été interrompue après blocage. Le lancement depuis un téléchargement en quarantaine, la signature Developer ID, la notarisation, Gatekeeper et la désinstallation sur un compte standard restent à valider. |
| BLOCKER | Windows. Le binaire x64 standard compile en CI. Le workflow le construit avec `--no-bundle` et la configuration partagée cible `app`. Aucun NSIS/MSI candidat ni parcours installation, mise à jour, désinstallation et SmartScreen n’a été qualifié. |

## Dépôt et publication

| Niveau | Constat |
| --- | --- |
| IMPORTANT | Dépôt public, règle active sur la branche par défaut. Elle impose une PR Squash, un historique linéaire et les six checks GitHub Actions, à jour sur la base. Le dernier commit testé de la PR du lot 7 a six checks verts. Le filtre de chemins sur les PR excluait la documentation. Sa suppression permet aux mêmes contrôles obligatoires de s’exécuter sur toute PR. [Règle Protect main](https://github.com/nakuakaben/hyper-media-puller/rules/27139736) · [Matrice du lot 7](https://github.com/nakuakaben/hyper-media-puller/actions/runs/43267064789) |
| IMPORTANT | Le README racine et le changelog décrivent surtout Electron V1. Le guide de développement V2 existe. Préparer une entrée publique V2 avec installation, prérequis, désinstallation, limites, export des rapports et canal de signalement. Aucun `SECURITY.md` ni notes bêta dédiées dans le tree audité. L’état d’un canal privé de signalement GitHub n’a pas pu être confirmé. Le dépôt distant ne présentait aucun tag ni release pendant l’audit. |
| BLOCKER | La V2 affiche `0.1.0` Preview et possède une identité dédiée. Il reste à valider la version bêta et à préparer un processus qui associe le commit approuvé, les packages, leurs empreintes et les notes. Le workflow existant fournit des preuves de CI, les binaires finaux ont besoin d’une qualification et d’un circuit d’approbation propres. |
| LATER | Automatisation de la mise à jour, MSI pour déploiement administré et identité visuelle finale. Les formats sont documentés dans le plan de distribution. |

L’essai macOS a utilisé Rust 1.99.1, Node 24.22.0 et les dépendances en cache. Le linker a produit le binaire optimisé malgré un avertissement de stripping `rust-objcopy` lié au chargeur LLVM local. L’empreinte SHA-256 du DMG simple est `a253f457a2e1ec0b56a4e1961c554f661e417235f33214819165c1d3eb7efa70`.

Le lot 9 a retenu la version `0.1.0-beta.1` pour les packages internes. Les décisions actuelles sur les actifs et la distribution sans signature commerciale sont consignées dans les documents de la candidate.

[Checklist](BETA_RELEASE_CHECKLIST.md) · [Plan de distribution](BETA_DISTRIBUTION_PLAN.md)
