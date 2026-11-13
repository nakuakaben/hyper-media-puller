# HMP V2 0.1.0-beta.1

Candidate interne macOS ARM64 et Windows x64. Le pictogramme temporaire actuel est conservé et la refonte graphique est reportée. La décision de publication reste à prendre après les contrôles de la [checklist](BETA_RELEASE_CHECKLIST.md).

- Identification des HyperDeck sur le réseau local, navigation FTP en lecture seule, file de transferts, annulation et rapport JSON.
- Vérification des tailles et SHA-256 du flux reçu comparé à la relecture locale. Les rapports n’établissent pas une empreinte indépendante sur le recorder.
- Premier offload physique du Studio HD Plus sous macOS. Windows x64 a été qualifié avec WebView2 et un HyperDeck synthétique. Destinations APFS et NTFS éprouvées dans les scénarios documentés. Le logiciel refuse exFAT par sécurité. SMB, les autres modèles et le Studio Mini 2017 restent à qualifier.
- L’identité du profil Preview et le schéma de préférences sont conservés. Les packages utilisent la version bêta complète, avec les champs natifs numériques sur macOS.
- La signature macOS est ad hoc. L’installateur Windows utilise NSIS par utilisateur, WebView2 Evergreen et un bootstrapper téléchargé si nécessaire. Les réactions de Gatekeeper et de SmartScreen dépendent du canal de téléchargement et de la politique du poste. [Plan de distribution](BETA_DISTRIBUTION_PLAN.md)

## Provenance graphique

| Ressource | Origine et décision pour la candidate |
| --- | --- |
| Quatre images HyperDeck de `assets/devices` | Visuels historiques du dépôt. Aucune autorisation de redistribution trouvée dans les commits ou notices consultés. Le frontend V2 utilise le composant générique Server et les visuels historiques ne sont plus embarqués dans la V2. |
| Icônes historiques V1 et V2 Preview | Les icônes V2 provenaient du projet historique. Les droits de la source graphique restent à confirmer. Les packages V2 utilisent un pictogramme temporaire dérivé de Server, sous licence ISC, avec sa source SVG et la notice Lucide. Les fichiers et packages Electron V1 conservent leurs propres actifs. |
| Inter, Lucide, Resolve Workflow Assistant | Notices OFL, ISC/MIT et MIT disponibles dans `v2/desktop/licenses` et incluses avec la licence HMP. Le relevé des dépendances et les notices tierces à joindre sont décrits dans le rapport de qualification. |

[Source de Server dans Lucide](https://github.com/lucide-icons/lucide/blob/0.468.0/icons/server.svg) · [Notices dans le dépôt](../v2/desktop/licenses/)

[Installation et retrait](BETA_INSTALLATION.md) · [Qualification finale](BETA_FINAL_QUALIFICATION.md) · [Signalement de sécurité](../SECURITY.md)
