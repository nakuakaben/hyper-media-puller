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

Les executables sont generes dans `release/`. Le smoke utilise les ports 5173 et 9323, des services de test et la configuration utilisateur Electron : sauvegarder cette configuration avant un test sur un poste de production. Le port 9993 doit etre libre pour valider le faux HyperDeck.

Pour contribuer : creer une branche, effectuer un changement cible, executer build:app et les tests pertinents, puis ouvrir une pull request. Ne jamais committer les identifiants FTP, logs utilisateur ou sorties de build. Lire AGENTS.md et PROJECT_STATUS.md avant toute reprise Codex.

## Préparation V2 Rust (10 novembre 2026)

La V2 est au stade de proposition : [audit](RUST_MIGRATION_AUDIT.md), [architecture Rust](RUST_ARCHITECTURE_PROPOSAL.md), [refonte UI](UI_REDESIGN_PLAN.md), [roadmap et décisions](V2_MIGRATION_ROADMAP.md). Ne pas engager la migration avant validation utilisateur. Electron reste à la racine ; le futur dossier `v2/` et ses commandes n'existent pas encore.

Sur macOS, utiliser une installation Node 24 LTS pour la validation Electron : Node 20 entraîne des avertissements de moteur avec Electron 43. Dans cette mission, Node 24.22.0, `npm ci`, `npm run build:app` et `npm run test:ftp-paths` ont réussi. Cela ne valide ni les transferts matériels ni le packaging macOS/Windows.

`npm audit --json` signale 25 vulnérabilités au 10 novembre 2026 ; les trier avant redistribution sans appliquer de mise à jour majeure automatique. Ne pas lancer le smoke sur un profil de production : son isolation userData est un préalable proposé dans le premier lot V2.
