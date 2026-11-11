# Validation du lot 4 · Tauri V2 Preview

## Contrôles et limites

| Vérification | Résultat |
| --- | --- |
| Bundle macOS natif | Construit et ouvert sur Apple M1, macOS 26.1, WKWebView. Démarrage sans simulation ni appareil. |
| Retina | Capture fenêtre seule 2732 × 1536 pixels pour 1366 × 768 points, échelle 2×. Les noms Unicode, les PNG appareils, les barres et les en-têtes ont été inspectés. |
| Tailles cibles | Chromium à 2× avec les viewports exacts 1366 × 768, 1920 × 1080 et 2560 × 1440. Pas de scroll de document. Navigation 44 px et barre d’état 28 px mesurées. |
| Tailles natives | Fenêtre Retina 1366 × 768 points, puis largeurs 1920 et 2560 points. macOS a limité ces deux fenêtres à 946 points de hauteur sur l’écran de test. |
| Parcours | Les quatre espaces, le volet compact, la sélection Unicode, l’ajout fictif, les filtres, le détail d’une erreur, le réessai fictif, le dossier vide, le hors ligne et la planche ont été vérifiés. Focus Tab, flèches, glisser, persistance du séparateur et fermeture de dialogue par Échap ont été contrôlés dans Chromium. |
| Tests locaux | Installation npm avec lockfile, TypeScript/Vite et trois tests de démonstration. Rust desktop avec formatage, Clippy strict et test du périmètre IPv4. L’audit npm V2 retourne zéro vulnérabilité au moment du contrôle. |
| CI native | Le workflow exécute les tests Rust du moteur, y compris SAFE-01 à SAFE-12 et le banc TCP legacy, Electron V1 et les contrôles de compilation Tauri sur macOS et Windows. [Exécutions de la branche](https://github.com/nakuakaben/hyper-media-puller/actions/workflows/rust-core.yml?query=branch%3Afeat%2Frust-v2-ui) |

La capture de démarrage provient du bundle normal. Pour les autres captures, une instrumentation locale a piloté les mêmes composants dans WKWebView et redimensionné la fenêtre. Cette instrumentation a été retirée du code livré. La capture Retina conserve ses pixels d’origine en JPEG. Les autres vues sont réduites pour consultation.

Le rendu Windows WebView2, les échelles Windows 100/150/200 %, les deux grandes hauteurs dans WKWebView, un audit lecteur d’écran et les seuils de contraste complets restent à valider. Aucun HyperDeck physique n’a été utilisé. Le Studio Mini 2017 est indisponible et reste au backlog. Les essais synthétiques legacy restent obligatoires. Toute future release doit préciser les modèles réellement qualifiés et ceux dont la compatibilité reste à vérifier.

## Captures natives

| Vue | Captures |
| --- | --- |
| Médias | [Démarrage](validation/lot4/demarrage.jpg) · [1366 points Retina](validation/lot4/medias-1366-retina.jpg) · [Options en mode compact](validation/lot4/medias-compact-options.jpg) · [Largeur 1920](validation/lot4/medias-1920.jpg) · [Largeur 2560](validation/lot4/medias-2560.jpg) |
| États du navigateur | [Dossier vide](validation/lot4/dossier-vide.jpg) · [FTP 550](validation/lot4/erreur-ftp.jpg) · [Hors ligne](validation/lot4/hors-ligne.jpg) |
| Transferts | [File multi-enregistreurs, progression et détail d’erreur](validation/lot4/transferts.jpg) |
| Rapports | [Rapport fictif et portée de vérification](validation/lot4/rapports.jpg) |
| Paramètres | [Connexions, destination, préférences et version](validation/lot4/parametres.jpg) |
| Composants | [Contrôles, sélection, états, progression, chargement et vide](validation/lot4/composants.jpg) |

## Écarts visuels par rapport à RWA 0.8.1

Comparaison avec les fichiers de référence approuvés et la fenêtre Tauri capturée. La copie RWA a été consultée en lecture seule.

| Primitive | Reprise et adaptation HMP |
| --- | --- |
| Palette et densité | Fond `#09090b`, panneaux `#18181b`, bordures `#27272a`, sélection `#1177d7`, en-têtes 40 px, boutons 30 px et champs 34 px. Le bleu marque le focus, la sélection et la copie. Le vert temporel RWA sert à la progression de vérification. |
| Typographie | Inter Variable est embarquée localement. La pile monospace locale reste la même que RWA. Les tailles FTP et la progression utilisent des chiffres tabulaires. |
| Navigation | Bande de 44 px avec icônes et soulignement actif, puis bande d’état de 28 px. Les quatre espaces HMP et l’en-tête de mode correspondent au parcours d’offload. |
| Disposition | Panneaux et prises de 5 px. HMP ajoute des contrôles clavier, des bornes, un volet compact, une liste d’appareils et une file persistante à l’écran Médias. |
| Tables et états | En-têtes fixes et rangées denses. La copie et la vérification sont séparées, les statuts ont des libellés, et la démonstration apparaît dans l’en-tête et la barre d’état. |
