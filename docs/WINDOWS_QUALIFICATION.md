# Qualification Windows x64

La CI du bureau lance le véritable exécutable Tauri sur Windows x64. Le test se connecte au WebView2 embarqué au moyen de DevTools et confirme le dossier dans le dialogue Windows. Le dialogue de qualification s’ouvre dans le dossier temporaire de la fixture, puis la sélection est confirmée par son contrôle natif. Il vérifie le binaire PE x64, le redimensionnement de la fenêtre, la fermeture native et les interactions dans les quatre espaces. Le navigateur et le profil de données de la machine de CI sont isolés. Le binaire de qualification est compilé avec la feature `windows-qualification`. Elle appelle DevTools via le contrôleur COM sur le thread de la fenêtre et utilise un dossier de commande éphémère du runner. Aucun port DevTools n’est ouvert. La feature est désactivée dans le build normal.

Le banc expose un HyperDeck et un FTP de lecture sur l’adresse IPv4 privée de la machine de CI, aux ports standard. Il rejette les connexions provenant d’un autre hôte. Le parcours identifie l’appareil, ouvre `/sd2`, sélectionne deux médias, choisit une destination temporaire, démarre le lot et compare les fichiers et leurs SHA-256 indépendamment. Des scénarios séparés couvrent une annulation, une rupture FTP, un réessai et la fermeture de l’application pendant une copie. Les preuves sont consignées dans l’artefact **windows-webview2-qualification** de l’exécution de CI.

Les captures de Médias, Transferts, Rapports et Paramètres proviennent du WebView2 intégré à l’exécutable. Les captures 100 %, 150 % et 200 % utilisent les facteurs d’échelle de rendu DevTools. Le DPI Windows courant est relevé lors du redimensionnement natif. Le changement de mise à l’échelle système et le passage entre deux moniteurs restent des essais distincts. [Automatisation de WebView2](https://learn.microsoft.com/microsoft-edge/webview2/how-to/webdriver)

## Périmètre matériel

Le Studio HD Plus dispose d’un premier essai physique macOS. Le Studio Mini 2017 reste différé. Les résultats du banc Windows portent sur un appareil synthétique et sur les supports effectivement testés. [Qualification macOS](MACOS_QUALIFICATION.md) · [Résultats et limites du lot 7](LOT7_VALIDATION_REPORT.md)

## Images de test

Le job Rust Windows crée des images VHD jetables de 96 Mio dans le dossier temporaire du runner. Il vérifie un disque plein NTFS, le démontage pendant une écriture et le refus exFAT lorsqu’une image peut être formatée. Le fichier `storage.json` dans **windows-storage-qualification** donne le résultat par scénario. Les commandes de formatage et de démontage sont limitées aux images créées par le test.

## Choisir un dossier sur plusieurs volumes

Le sélecteur natif s’ouvre dans le dossier personnel Windows. Dans **Ce PC**, choisir un dossier inscriptible sur le disque voulu. Il est aussi possible de saisir son chemin absolu dans le dialogue. HMP vérifie le dossier sélectionné avec des fichiers témoins créés en exclusivité. Le message de refus indique le dossier testé et conserve la destination précédemment acceptée. La lettre du lecteur ne détermine pas sa compatibilité.

Le banc WebView2 standard sélectionne le dossier du runner puis deux dossiers sur des VHD NTFS distincts. Les lettres sont attribuées par Windows. Le banc teste aussi un VHD exFAT si celui-ci peut être créé et vérifie l’absence de fichiers après le refus. Consulter `picker-volumes.json` et `evidence.json` dans **windows-webview2-qualification** pour les lettres et résultats effectifs. Les volumes amovibles et réseau restent soumis à la même vérification de publication exclusive. Ces VHD ne constituent pas une qualification USB ou SMB.
