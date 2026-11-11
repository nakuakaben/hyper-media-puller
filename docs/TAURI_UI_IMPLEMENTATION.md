# HMP V2 Preview · Interface Tauri

La Preview fournit les espaces Médias, Transferts, Rapports et Paramètres dans une fenêtre native. Elle utilise Tauri 2, React 18, TypeScript et Vite. Le moteur Rust, ses ports, son lockfile et Electron V1 conservent leurs points d’entrée. Le workspace de la coque et ses deux lockfiles sont sous `v2/desktop`.

## Lancement local

Installer Node 24.22.0 et Rust 1.99.1. Sur macOS, installer les Command Line Tools de Xcode. Sur Windows, installer Visual Studio Build Tools avec le développement Desktop C++ et Microsoft Edge WebView2. [Prérequis Tauri](https://v2.tauri.app/start/prerequisites/)

Depuis la racine du dépôt.

```sh
cd v2/desktop
npm ci
npm test
npm run tauri -- dev
```

Vite écoute sur `127.0.0.1:1420` en développement. Avec `npm run dev`, ouvrir cette adresse dans un navigateur pour accéder à la démonstration sans bridge natif. Pour construire le bundle macOS et l’ouvrir depuis le même répertoire.

```sh
npm run tauri -- build --debug --bundles app -- --locked
open "src-tauri/target/debug/bundle/macos/HyperDeck Media Puller V2 Preview.app"
```

Sur Windows, `npm run tauri -- build --debug --no-bundle -- --locked` construit `src-tauri/target/debug/hmp-v2-preview.exe`. Les contrôles complémentaires sont `npm run build`, puis `cargo fmt --manifest-path src-tauri/Cargo.toml --check`, `cargo clippy --manifest-path src-tauri/Cargo.toml --locked --all-targets -- -D warnings` et `cargo test --manifest-path src-tauri/Cargo.toml --locked`.

## Frontière du bridge

| Commande locale | Contrat et limites |
| --- | --- |
| `preview_info` | Version du bundle, version de schéma Rust et identifiant du profil. |
| `identify_deck` | Une IPv4 privée ou link-local saisie explicitement. Sonde TCP 9993 par `device info` avec délai. Retourne un `RecorderDto` et le modèle identifié. |
| `list_media` | Valide `RecorderDto` et `RemotePath` dans Rust. Utilise l’adaptateur FTP anonyme sur le port 21, ferme la session et retourne des `MediaEntryDto` ou un `ErrorDto`. Les tailles sont des chaînes décimales. |

La capability `preview` est attachée à la fenêtre locale `main`. Les trois commandes sont déclarées dans le manifeste ACL. Les ressources sont embarquées et une CSP limite les origines de contenu. Le bridge transmet seulement des métadonnées. Aucun plugin de disque, shell ou réseau JavaScript n’est activé. Le profil natif porte l’identifiant `fr.tktprod.hyperdeck-media-puller.v2.preview`. L’application crée son dossier de données dédié. La disposition est mémorisée dans le stockage du WebView. Les appareils identifiés et les options restent en mémoire pour cette Preview. [Capabilities Tauri](https://v2.tauri.app/reference/acl/capability/) · [CSP Tauri](https://v2.tauri.app/security/csp/)

## Parcours et données

La Preview démarre en navigation FTP réelle sans appareil. Le bouton **Ouvrir la démonstration** affiche quatre appareils fictifs, les états de listing et une file multi-enregistreurs. La simulation peut avancer sur demande et gère la remise en file, l’annulation et la concurrence de démonstration. Elle conserve des sources et une file distinctes du mode réel. Les rapports sont explicitement fictifs et n’émettent ni checksum ni certificat. Le choix d’une destination locale, les écritures, la file de production et les rapports réels restent au lot 5.

À partir de 1450 px, Médias affiche trois panneaux et une file redimensionnable. En dessous, **Options** ouvre un volet modal. Les séparateurs prennent en charge le glisser et les flèches, ainsi que Début/Fin. Les tables défilent à l’intérieur des panneaux et gardent leurs en-têtes. La planche des composants s’ouvre depuis **Paramètres**. Le navigateur accepte les fichiers sélectionnés individuellement et utilise les dossiers effectivement retournés par FTP. Le Studio Mini 2017 utilise le pictogramme générique HMP.

## Attributions

Les tokens RWA 0.8.1 proviennent du fichier local validé `src/ui-contract/ui.tokens.css`. Son SHA-256 est `770a8d4ae3fff8ba02f6c49845d14eb551e3cb01f3823ac2c768986d40fc3a87`. Les composants et la grille sont implémentés pour HMP. Les PNG appareils et l’icône proviennent des actifs HMP existants. Inter est embarquée sous OFL et les icônes d’interface utilisent Lucide. Les textes de licence figurent dans [v2/desktop/licenses](../v2/desktop/licenses/). La [validation du lot 4](LOT4_VALIDATION_REPORT.md) documente les captures et les écarts.
