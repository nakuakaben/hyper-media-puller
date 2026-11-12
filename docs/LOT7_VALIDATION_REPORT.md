# Validation du lot 7 · Windows x64

Base `5d4958d`. Les tests Electron V1, SAFE-01 à SAFE-12, FTP legacy, IPC Tauri et frontend restent dans la matrice macOS ARM64 et Windows x64.

Le job Tauri Windows lance le binaire issu de la compilation. Il joint les captures de WebView2 et un relevé JSON qui indique les contrôles effectivement terminés, les dimensions des images, les tailles transférées et les SHA-256. L’artefact est associé au commit vérifié par GitHub Actions. [Historique des exécutions du lot 7](https://github.com/nakuakaben/hyper-media-puller/actions/workflows/rust-core.yml?query=branch%3Afeat%2Frust-v2-windows-qualification)

## Portée des essais

| Situation | Périmètre |
| --- | --- |
| NTFS | Le test natif choisit un dossier temporaire avec espaces et accents et transfère un nom de 194 caractères. La suite Rust vérifie le type de volume du runner, le refus ACL, les collisions et le précontrôle d’espace. |
| Noms réservés | Les tests du domaine vérifient la validation des composants Windows. |
| DPI et fenêtres | Redimensionnement et fermeture du HWND. Échelles WebView2 100/150/200 % contrôlées par émulation. Les changements de DPI système et multi-écrans restent à qualifier. |
| exFAT, SMB et retrait | Aucune compatibilité annoncée sans essai. Les tests du lot 6 sur une image APFS et exFAT macOS restent documentés séparément. |
| Matériel physique | Studio HD Plus confirmé sur macOS dans le lot 6. Studio Mini 2017 et transferts physiques Windows à qualifier. |

Les preuves de transfert indiquent la comparaison entre le flux reçu et sa relecture locale. Les essais synthétiques utilisent des données de fixture et des destinations temporaires. [Procédure Windows](WINDOWS_QUALIFICATION.md)
