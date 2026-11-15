# Checklist de la bêta publique HMP V2

Candidate `0.1.0-beta.1` pour macOS ARM64 et Windows x64. Cette checklist sert à décider si une candidate peut être publiée. Les validations acquises sont datées et restent attachées à leur commit.

Décision actuelle **NO-GO publication**. [Procédure et résultats d’acceptation](BETA_ACCEPTANCE.md)

## Relevé complémentaire — 15 novembre 2026 (PR #21, `e73057d`)

Ce relevé complète les coches historiques ci-dessous, qui décrivent parfois des candidats antérieurs.

- **PUBLIC / PERSONAL** : quatre installateurs déclarés produits depuis `e73057d` ; les rapports de fabrication indiquent six contrôles CI réussis, 7 tests frontend et 70 tests Rust. PUBLIC utilise les illustrations V2 ; PERSONAL inclut les quatre photos V1 pour usage privé. Aucun code secret ni sélecteur de style.
- **Windows PERSONAL** : essai physique confirmé par captures sur HyperDeck Studio HD Mini `10.2.50.101`, transfert d’environ 18,4 Gio vers NTFS, copie et comparaison flux/local MD5 à 100 %, rapport produit (211,5 s). Cet essai ne prouve pas un SHA-256 indépendant du recorder.
- **macOS PERSONAL** : application ouverte et examinée sans HyperDeck disponible. DMG téléchargé via Vivaldi, attribut `com.apple.quarantine` présent, SHA-256 conforme. `spctl --assess` retourne `rejected` ; le lancement Finder a nécessité l’autorisation « Ouvrir quand même » et une authentification administrateur, puis HMP s’est ouvert.
- **Empreintes PERSONAL confirmées depuis les téléchargements utilisateur** : Windows `5bb4fb97c3c81aa49802c7f3366cc3643da6a893ff9865712ac4467346a3fef2` ; macOS `20376f36bc3d55964879a7ad8fa1548799c5bf2e1dedcaea3ed8b033b110bbee`.
- **Toujours ouverts** : téléchargements PUBLIC et empreintes finales, licences/notices effectivement jointes au canal final, signalement privé GitHub, SmartScreen sur téléchargement, installation sur Windows sans WebView2, remplacement/profil Preview, scénarios SAFE complets sur packages finaux. Transfert physique macOS sur ce commit reporté ; un test matériel macOS antérieur existe.
- **Gatekeeper** : comportement de blocage puis d’autorisation manuelle observé sur PERSONAL. Cela ne vaut pas validation de la distribution PUBLIC sur compte standard isolé ; signature/notarisation non fournies.


## Préparation de la candidate

- [x] **IMPORTANT** Confirmer la licence MIT publique et la règle active de `main` avec six contrôles et fusion Squash. [Règle GitHub](https://github.com/nakuakaben/hyper-media-puller/rules/27139736)
- [x] **IMPORTANT** Recenser les validations physiques et synthétiques des lots 6 et 7, et contrôler les deux fichiers Cargo.lock, les deux projets npm et l’historique Git accessible. [Audit](BETA_READINESS_AUDIT.md)
- [x] **IMPORTANT** Exclure les visuels historiques de provenance incertaine de la candidate V2. Embarquer les licences HMP, Inter, Lucide et RWA. [Provenance](BETA_RELEASE_NOTES.md)
- [x] **IMPORTANT** Identifier les dépendances Rust par cible, les modules frontend et le contenu du NSIS.
- [x] **IMPORTANT** Joindre les notices tierces au dossier de remise, avec l’archive source MPL et les notices NSIS.
- [ ] **BLOCKER** Vérifier que le canal final remet les notices avec chaque téléchargement. Les photos historiques sont exclues des variantes V2.
- [x] **IMPORTANT** Aligner les métadonnées Rust, Tauri et npm sur `0.1.0-beta.1`. Conserver l’identifiant et le schéma de préférences Preview.
- [ ] **BLOCKER** Tester l’installation sur un profil Preview existant et la progression entre deux candidates.
- [x] **IMPORTANT** Relancer npm audit, OSV et Gitleaks, et documenter les avis et exclusions par cible.
- [x] **IMPORTANT** Mettre à jour README, guide d’installation, politique de sécurité et notes V2.
- [ ] **BLOCKER** Confirmer le formulaire privé GitHub depuis un compte connecté et vérifier sa disponibilité pour un compte test.
- [x] **IMPORTANT** Les six checks de la candidate du lot 9 et les 32 tests moteur SAFE sont verts. [CI candidate](https://github.com/nakuakaben/hyper-media-puller/actions/runs/43286675811)

## Installation et vérification

- [x] **IMPORTANT** Validation du nom HMP et des captures de restauration par le propriétaire. [Restauration graphique](BETA_VISUAL_RESTORATION.md)
- [x] **IMPORTANT** Validation physique par le propriétaire du démarrage, du renommage, de la persistance, de la déconnexion, de la reconnexion automatique et de la suppression sur le build interne du correctif. [Périmètre des essais](BETA_ACCEPTANCE.md#correctif-des-enregistreurs--validation-physique-du-13-novembre-2026)

- [x] **IMPORTANT** Construire et contrôler le `.app` ARM64 et le DMG. Vérifier la signature ad hoc et le minimum macOS 11.0.
- [ ] **BLOCKER** Télécharger le DMG intégré via Safari et relever la quarantaine et Gatekeeper. L’essai du lot 10 reste historique.
- [ ] **BLOCKER** Exercer l’ouverture autorisée par application sur un compte macOS standard et vérifier le remplacement, le transfert et le retrait.
- [ ] **BLOCKER** Exercer le NSIS depuis un téléchargement réel sous compte Windows standard. Consulter le rapport d’intégration pour les essais du runner avec WebView2 présent.
- [ ] **BLOCKER** Tester sur un Windows x64 propre sans WebView2, contrôler SmartScreen après téléchargement et exercer la mise à jour manuelle.
- [x] **IMPORTANT** Contrôler l’absence de la feature de qualification dans les exécutables candidats.
- [ ] **BLOCKER** Vérifier dans les packages exacts la copie sans écrasement involontaire, l’annulation sans fichier final, le SHA-256 flux/local et la conservation des médias après remplacement et retrait.
- [ ] **IMPORTANT** Tester les comptes utilisateur avec des chemins contenant des espaces et des accents, et préciser les préférences et fichiers conservés après désinstallation.
- [ ] **LATER** Étendre la qualification à SMB, au Studio Mini 2017, aux HyperDeck physiques sous Windows et aux autres scénarios matériels annoncés dans l’audit.

## Contrôle des fichiers à distribuer

- [ ] **BLOCKER** Vérifier les quatre miniatures MIT et le repère générique dans chaque installateur V2 standard et interne sur macOS et Windows. Les photos historiques sont exclues.

- [ ] **BLOCKER** Vérifier les SHA-256 des candidats exacts depuis le canal de téléchargement final. Le manifeste de la remise locale couvre les configurations de test.
- [ ] **BLOCKER** Vérifier le canal de téléchargement final sur les deux plateformes.
- [ ] **BLOCKER** Obtenir la décision de publication après validation des packages et des limites. Associer la future préversion au commit approuvé. Vérifier ses fichiers téléchargés, leur intégrité et les instructions de signalement.
- [ ] **LATER** Étudier un MSI et la mise à jour automatique après le premier cycle de bêta.

[Plan de distribution](BETA_DISTRIBUTION_PLAN.md) · [Matrice et commandes de qualification finale](BETA_QUALIFICATION_RUNBOOK.md)
