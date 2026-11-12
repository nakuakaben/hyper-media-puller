# Checklist de la bêta publique HMP V2

Candidate `0.1.0-beta.1` pour macOS ARM64 et Windows x64. Cette checklist sert à décider si une candidate peut être publiée. Les validations acquises sont datées et restent attachées à leur commit.

## Préparation de la candidate

- [x] **IMPORTANT** Confirmer la licence MIT publique et la règle active de `main` avec six contrôles et fusion Squash. [Règle GitHub](https://github.com/nakuakaben/hyper-media-puller/rules/27139736)
- [x] **IMPORTANT** Recenser les validations physiques et synthétiques des lots 6 et 7, et contrôler les deux fichiers Cargo.lock, les deux projets npm et l’historique Git accessible. [Audit](BETA_READINESS_AUDIT.md)
- [x] **IMPORTANT** Exclure les visuels historiques de provenance incertaine de la candidate V2. Embarquer les licences HMP, Inter, Lucide et RWA. [Provenance](BETA_RELEASE_NOTES.md)
- [ ] **BLOCKER** Finaliser l’inventaire des dépendances distribuées et contrôler les droits des actifs historiques avant toute redistribution du dépôt ou réintégration de ces visuels.
- [x] **IMPORTANT** Aligner les métadonnées Rust, Tauri et npm sur `0.1.0-beta.1`. Conserver l’identifiant et le schéma de préférences Preview.
- [ ] **BLOCKER** Tester l’installation sur un profil Preview existant et la progression entre deux candidates.
- [ ] **BLOCKER** Refaire le tri des avis sur le commit candidat. Corriger les alertes exploitables de la V2 ou de sa chaîne de fabrication, et consigner les exclusions par cible. Refaire Gitleaks sur le tree et les références concernées.
- [ ] **IMPORTANT** Mettre à jour le README public, rédiger le guide d’installation et de retrait et définir un canal privé de signalement dans `SECURITY.md`. Préparer les notes V2 et préciser la portée du SHA-256, les destinations prises en charge, le FTP en clair, les partiels et la confidentialité des rapports.
- [ ] **BLOCKER** Obtenir les six checks Rust, Electron et Desktop sur le SHA candidat, sur macOS et Windows. Enregistrer les preuves SAFE-01 à SAFE-12 et les rapports de qualification pertinents.

## Installation et vérification

- [x] **IMPORTANT** Construire et contrôler le `.app` ARM64 et le DMG. Vérifier la signature ad hoc et le minimum macOS 11.0.
- [ ] **BLOCKER** Sur macOS, tester le téléchargement avec quarantaine, l’ouverture avec la politique Gatekeeper intacte et le cycle complet sur un compte standard. Décider si la distribution publique accepte la confirmation par application, ou requiert Developer ID et notarisation.
- [ ] **BLOCKER** Vérifier le rapport CI du NSIS par utilisateur et le SHA-256 du package récupéré. Tester sur un Windows x64 propre sans WebView2, puis contrôler SmartScreen après téléchargement depuis le canal candidat. Tester la mise à jour depuis une installation antérieure.
- [ ] **BLOCKER** Vérifier sur les packages exacts la copie sans écrasement involontaire, l’annulation sans fichier final et la portée du rapport SHA-256. Confirmer l’absence de la feature de qualification Windows dans les binaires distribués.
- [ ] **IMPORTANT** Tester les comptes utilisateur avec des chemins contenant des espaces et des accents, et préciser les préférences et fichiers conservés après désinstallation.
- [ ] **LATER** Étendre la qualification à SMB, au Studio Mini 2017, aux HyperDeck physiques sous Windows et aux autres scénarios matériels annoncés dans l’audit.

## Contrôle des fichiers à distribuer

- [ ] **BLOCKER** Constituer le dossier candidat avec noms explicites, notes, SHA-256, licences et provenance du build. Calculer les empreintes après signature et agrafage du ticket. Vérifier les téléchargements avec un compte de test sur les deux plateformes.
- [ ] **BLOCKER** Obtenir la décision de publication après validation des packages et des limites. Associer la future préversion au commit approuvé. Vérifier ses fichiers téléchargés, leur intégrité et les instructions de signalement.
- [ ] **LATER** Étudier un MSI et la mise à jour automatique après le premier cycle de bêta.

[Plan de distribution](BETA_DISTRIBUTION_PLAN.md)
