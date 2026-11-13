# Restauration graphique de HMP V2

## Identité et droits

Le propriétaire du projet confirme avoir créé l’icône historique HMP. Tauri référence directement les trois fichiers d’origine dans `build/`. Le PNG et l’ICNS contiennent une image de 1024 × 1024 px. L’ICO contient une image de 256 × 256 px. Le bundler Windows utilise cet ICO pour l’application, l’installateur et le désinstallateur. Les raccourcis NSIS pointent vers l’exécutable et utilisent sa ressource d’icône.

Les quatre images de modèles dans `assets/devices/` proviennent d’Internet. Leur redistribution publique reste non autorisée. Le build Tauri normal utilise `dist` et affiche un repère générique dont l’infobulle indique que le visuel du modèle est indisponible dans ce build. Le build interne charge les PNG historiques et produit `dist-internal`. Les captures contenant ces images sont conservées localement pour validation.

## Build interne

Depuis `v2/desktop` après `npm ci` :

```sh
npm run tauri -- build --config src-tauri/tauri.internal.conf.json -- --locked
```

Les deux configurations affichent **HMP** dans la fenêtre et les menus système. Leurs identifiants Tauri et profils de données restent distincts et inchangés. Conserver les deux bundles dans des dossiers séparés, car ils portent le même nom `HMP.app`. Les quatre modèles sont visibles dans la démonstration interne. La liste du mode réel continue de présenter les appareils identifiés. Pour fabriquer un candidat destiné à la distribution, utiliser la configuration Tauri standard et vérifier le contenu de son frontend et de ses packages.

## Comparaison visuelle

La vue Médias a été capturée dans le bundle ARM64 interne, en démonstration à 1280 × 760 points sur écran Retina. Les images Studio HD Mini, Studio 4K Pro, Studio HD Plus et Extreme 8K reprennent le placement historique dans la colonne de 56 px et le cadre de 56 × 33 px avec conservation du ratio. La référence HMP du lot 4 et les tokens de RWA 0.8.1 servent de comparaison. Le modèle Studio Mini 2017 conserve un repère générique, faute de visuel spécifique validé.

Les captures et l’aperçu sont disponibles dans `v2/desktop/beta-artifacts/lot12-visual/`. L’ICNS du bundle macOS a été comparé octet pour octet à l’original. Vérifier l’affichage Finder, Dock, Windows et les raccourcis dans le parcours de qualification de chaque candidat. Les captures de démonstration qualifient le rendu et les associations d’images.

## Acceptation de la bêta

Attendre la validation graphique explicite avant de reprendre les essais de [BETA_ACCEPTANCE.md](BETA_ACCEPTANCE.md). Les installateurs des lots précédents restent des preuves historiques. Construire les nouveaux candidats en configuration standard, contrôler l’icône et l’absence des quatre photos, puis calculer leurs SHA-256. Refaire Gatekeeper sur compte standard et SmartScreen sous Windows x64 avec WebView2 absent puis présent. Exercer le FTP, le SHA-256, l’annulation, la collision, le remplacement ou la réinstallation, puis vérifier la conservation des médias et préférences. Reporter les preuves dans la [checklist](BETA_RELEASE_CHECKLIST.md).
