# Validation du lot 7 · Windows x64

Base `5d4958d`. Les tests Electron V1, SAFE-01 à SAFE-12, FTP legacy, IPC Tauri et frontend restent dans la matrice macOS ARM64 et Windows x64.

Le job Tauri Windows lance le binaire issu de la compilation. Il joint les captures de WebView2 et un relevé JSON qui indique les contrôles effectivement terminés, les dimensions des images, les tailles transférées et les SHA-256. L’artefact est associé au commit vérifié par GitHub Actions. [Historique des exécutions du lot 7](https://github.com/nakuakaben/hyper-media-puller/actions/workflows/rust-core.yml?query=branch%3Afeat%2Frust-v2-windows-qualification)

Le premier parcours WebView2 complet jusqu’au réessai a produit deux copies vérifiées de 1 Mio et 512 Kio et un rapport SHA-256 concordant. Il a confirmé l’absence de final après annulation et après rupture FTP, puis la vérification du fichier au nouvel essai. Les captures ont révélé le préfixe Windows interne des chemins canoniques dans les panneaux. Les vues affichent désormais un chemin Windows lisible et le rapport JSON conserve le chemin du moteur. [Captures et relevé de ce passage](https://github.com/nakuakaben/hyper-media-puller/actions/runs/43221578434/artifacts/13947000121)

## Portée des essais

| Situation | Périmètre |
| --- | --- |
| NTFS | Le test natif choisit un dossier temporaire avec espaces et accents et transfère un nom de 194 caractères. La suite Rust vérifie le type de volume du runner, le refus ACL, les collisions et le précontrôle d’espace. |
| Noms réservés | Les tests du domaine vérifient la validation des composants Windows. |
| DPI et fenêtres | Redimensionnement et fermeture du HWND. Échelles WebView2 100/150/200 % contrôlées par émulation. Les changements de DPI système et multi-écrans restent à qualifier. |
| Disque plein et retrait | Le job Rust Windows utilise des images VHD NTFS jetables de 96 Mio. Il vérifie l’erreur de saturation et l’absence de final, puis démonte une autre image pendant une écriture et contrôle son contenu après remontage. |
| exFAT et SMB | Une troisième image VHD sert à tester le refus exFAT lorsque le formatage est disponible. Aucun partage SMB de test dans cet environnement. |
| Matériel physique | Studio HD Plus confirmé sur macOS dans le lot 6. Studio Mini 2017 et transferts physiques Windows à qualifier. |

Un passage Windows du banc de volumes a produit `DestinationFull` après 84 738 048 octets. Après démontage et remontage du second VHD NTFS, le partiel faisait 65 536 octets et le nom final était absent. Le VHD exFAT a été formaté et refusé avant la copie, faute de publication exclusive. [Preuve JSON des volumes](https://github.com/nakuakaben/hyper-media-puller/actions/runs/43215932851/artifacts/13944205983)

Les preuves de transfert indiquent la comparaison entre le flux reçu et sa relecture locale. Les essais synthétiques utilisent des données de fixture et des destinations temporaires. [Procédure Windows](WINDOWS_QUALIFICATION.md)
