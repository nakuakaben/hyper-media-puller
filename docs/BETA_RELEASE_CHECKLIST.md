# Checklist de la bêta publique HMP V2

Candidate `0.1.0-beta.1` pour macOS ARM64 et Windows x64. Cette checklist sert à décider si une candidate peut être publiée. Les validations acquises sont datées et restent attachées à leur commit.

Décision actuelle **NO-GO publication**. [Procédure et résultats d’acceptation](BETA_ACCEPTANCE.md)

## Préparation de la candidate

- [x] **IMPORTANT** Confirmer la licence MIT publique et la règle active de `main` avec six contrôles et fusion Squash. [Règle GitHub](https://github.com/nakuakaben/hyper-media-puller/rules/27139736)
- [x] **IMPORTANT** Recenser les validations physiques et synthétiques des lots 6 et 7, et contrôler les deux fichiers Cargo.lock, les deux projets npm et l’historique Git accessible. [Audit](BETA_READINESS_AUDIT.md)
- [x] **IMPORTANT** Exclure les visuels historiques de provenance incertaine de la candidate V2. Embarquer les licences HMP, Inter, Lucide et RWA. [Provenance](BETA_RELEASE_NOTES.md)
- [x] **IMPORTANT** Identifier les dépendances Rust par cible, les modules frontend et le contenu du NSIS.
- [x] **IMPORTANT** Joindre les notices tierces au dossier de remise, avec l’archive source MPL et les notices NSIS.
- [ ] **BLOCKER** Vérifier que le canal final remet les notices avec chaque téléchargement. Les droits des visuels historiques restent à établir avant leur réintégration.
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

- [ ] **BLOCKER** Vérifier les SHA-256 des candidats exacts depuis le canal de téléchargement final. Le manifeste de la remise locale couvre les configurations de test.
- [ ] **BLOCKER** Vérifier le canal de téléchargement final sur les deux plateformes.
- [ ] **BLOCKER** Obtenir la décision de publication après validation des packages et des limites. Associer la future préversion au commit approuvé. Vérifier ses fichiers téléchargés, leur intégrité et les instructions de signalement.
- [ ] **LATER** Étudier un MSI et la mise à jour automatique après le premier cycle de bêta.

[Plan de distribution](BETA_DISTRIBUTION_PLAN.md) · [Matrice et commandes de qualification finale](BETA_QUALIFICATION_RUNBOOK.md)
