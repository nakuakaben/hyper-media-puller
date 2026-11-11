# Developpement

Environnement valide : Windows, Node.js 24.19.0 et npm. Utiliser un Node.js 24 LTS et Git. Aucun fichier .env ni service externe n'est requis.

```powershell
git clone https://github.com/nakuakaben/hyper-media-puller.git
cd hyper-media-puller
npm ci
npm run build:app
npm run dev
```

`build:app` compile sans changement de version. `build` execute aussi le script version:bump configure avec 1.1.0 ; verifier ce comportement avant une release. `version:sync` synchronise les constantes partagees.

```powershell
npm run test:ftp-paths
npm run smoke:dev
npm run dist:portable
npm run dist:installer
```

Les executables sont generes dans `release/`. Depuis le lot 1, le smoke utilise un profil Electron temporaire (userData et sessionData) et une destination temporaire, nettoyes apres arret des processus. Il conserve les ports 5173 et 9323. Son ancien sondage LAN est desactive par defaut ; `HMP_SMOKE_NETWORK=1` l'active explicitement avec les ports 9993 et 21. Ce sondage ne constitue pas une validation de materiel reel.

Pour contribuer : creer une branche, effectuer un changement cible, executer build:app et les tests pertinents, puis ouvrir une pull request. Ne jamais committer les identifiants FTP, logs utilisateur ou sorties de build. Lire AGENTS.md et PROJECT_STATUS.md avant toute reprise Codex.

## Préparation V2 Rust (10 novembre 2026)

Documents de préparation préservés : [audit](RUST_MIGRATION_AUDIT.md), [architecture Rust](RUST_ARCHITECTURE_PROPOSAL.md), [refonte UI](UI_REDESIGN_PLAN.md), [roadmap et décisions](V2_MIGRATION_ROADMAP.md). L'utilisateur a validé Tauri 2 / Rust / React-TS-Vite, un moteur indépendant, RWA 0.8.1 et les lots 1/2. Electron reste à la racine ; le moteur simulé Rust est maintenant dans `v2/`. Le lot 3 reste soumis à validation ; aucune application Tauri ou interface V2 n'existe encore.

Sur macOS, utiliser une installation Node 24 LTS pour la validation Electron : Node 20 entraîne des avertissements de moteur avec Electron 43. Dans cette mission, Node 24.22.0, `npm ci`, `npm run build:app` et `npm run test:ftp-paths` ont réussi. Cela ne valide ni les transferts matériels ni le packaging macOS/Windows.

`npm ci` signale encore 25 vulnérabilités au 10 novembre 2026 ; les trier avant redistribution sans appliquer de mise à jour majeure automatique. Le lot 1 n'a modifié aucune dépendance ni le lockfile.

## Corpus du lot 1

```sh
npm run test:characterization
npm run smoke:dev
```

Le corpus compile le main V1 puis utilise Node test runner, des paramètres temporaires, des doubles de frontières explicites et un serveur FTP de lecture sur loopback/ports éphémères. Voir [tests/README.md](../tests/README.md) et [le rapport de validation](LOT1_VALIDATION_REPORT.md). Les tests qui exposent les défauts V1 ne doivent pas devenir des critères de sécurité V2 inchangés. Aucun HyperDeck physique n'est requis pour ce corpus ; les scénarios matériels restant à exécuter sont séparés dans [la matrice FTP](FTP_LEGACY_TEST_MATRIX.md).

## Moteur Rust — lot 2

Rust stable avec rustfmt/clippy, validé avec 1.99.1. Aucun prérequis Tauri pour le moteur. Depuis la racine :

```sh
cd v2
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo build --workspace --locked
cargo run --locked -p hmp-infra --example simulate
```

L'exemple et les tests utilisent uniquement des sources fictives et des répertoires temporaires privés ; ils n'ont pas besoin d'HyperDeck ni de paramètres utilisateur. Voir [v2/README.md](../v2/README.md), [l'implémentation](RUST_CORE_IMPLEMENTATION.md) et [le rapport lot 2](LOT2_VALIDATION_REPORT.md). Ne pas utiliser le sandbox comme adaptateur de destination opérateur. La CI Rust prévoit macOS et Windows sans installer Electron.

## FTP Rust et qualification matérielle

Depuis la racine, lancer le banc en boucle locale avec `cargo test --locked --manifest-path v2/Cargo.toml -p hmp-infra --test ftp_wire`. Il réutilise les fixtures V1 et le moteur de transfert Rust. Le workflow Rust core exécute le workspace Rust et les tests de caractérisation Electron sur macOS et Windows. Pour identifier un appareil et tester un média choisi en lecture seule, suivre la [procédure de qualification](RUST_FTP_IMPLEMENTATION.md).

### Tauri V2 Preview

Depuis `v2/desktop`, exécuter `npm ci`, `npm test`, `npm run build` et `npm run tauri -- dev`. Utiliser Node 24.22.0, Rust 1.99.1 et les prérequis natifs Tauri. Le workspace et les lockfiles de la coque sont indépendants du moteur et de la V1. Voir [l’implémentation Tauri](TAURI_UI_IMPLEMENTATION.md) pour construire l’exécutable macOS, la compilation Windows et le périmètre du bridge.

### Offload V2 réel

Le parcours de lancement Tauri reste le même. Depuis la racine, `cargo test --manifest-path v2/Cargo.toml --workspace --locked` exerce les garanties SAFE, le banc FTP et les destinations locales. Depuis `v2/desktop`, `npm test` et `cargo test --manifest-path src-tauri/Cargo.toml --locked` vérifient la démonstration et l’IPC Tauri. Pour cibler un volume de test compatible, définir `HMP_TEST_VOLUME` sur son dossier de test et lancer `cargo test --manifest-path v2/Cargo.toml --locked --test local_destination` depuis la racine. Les tests créent leurs propres sous-dossiers temporaires. Voir [le parcours et le format de rapport](REAL_TRANSFER_IMPLEMENTATION.md) et [la validation](LOT5_VALIDATION_REPORT.md).
