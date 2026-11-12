# Validation du lot 6 · macOS et retour terrain

Base `449ddfa`, après fusion du lot 5. Les opérations susceptibles d’interrompre une copie ont visé uniquement des données et volumes de test.

## Qualification physique — Studio HD Plus

Le test utilisateur du 12 novembre 2026 confirme un offload macOS de `/sd2/HyperDeck_0003.mp4`, 101,1 Mio en 10,2 s, SHA-256 du flux comparé à sa relecture locale, rapport JSON et lecture de la copie confirmée. Les quatre captures d’origine sont référencées dans la [qualification macOS](MACOS_QUALIFICATION.md). Aucun enregistrement ni transfert sur le recorder physique n’a été lancé pour les vérifications synthétiques du lot 6.

## Destinations

| Support ou situation | Résultat |
| --- | --- |
| APFS macOS | Publications sans remplacement et avec remplacement explicite, collisions et égalité de taille avec contenu différent. Dossier temporaire avec espaces et accents et fichier de 194 caractères ASCII. Refus effectif d’écriture par permissions Unix. |
| Disque plein | Image APFS jetable de 96 Mio. ENOSPC après 96 927 744 octets acceptés. Taille du partiel identique au compteur d’écriture, aucun fichier au nom final. |
| Retrait | Éjection forcée de la seule image APFS de test pendant une écriture du port de destination. EIO après 131 072 octets acceptés. Après remontage, partiel identifiable de 131 072 octets et nom final absent. Le test exerce le port disque, pas le retrait d’un support physique pendant un transfert HyperDeck. |
| exFAT macOS | Image montée en exFAT. Le système refuse le renommage exclusif requis. L’application refuse cette destination avec un diagnostic explicite. La sonde teste la collision et l’absence de collision sur ses seuls fichiers temporaires. Aucun remplacement ou mécanisme de repli non atomique. |
| SMB | Aucun montage SMB disponible pour les essais. Publication, ACL et récupération restent non qualifiées. |

## Transferts et interface

- Banc FTP de boucle locale et destination de production. Le scénario de grande taille transfère **4 296 015 872 octets** (4 Gio + 1 Mio), vérifie la taille du fichier et les trois compteurs, puis compare le SHA-256 attendu `117b24fae2fe12a5145b1b11ec31540994554977cf4a357f7cb602bc5c9b8de6`. Le motif est produit par blocs d’un Mio. Le profil de test optimise SHA-256 pour limiter le temps d’exécution.
- Les tests couvrent deux sources synthétiques et deux médias d’un même lot, une coupure ou un 426 FTP, une annulation en lecture, une annulation de vérification via la fixture SAFE et l’arrêt pendant une copie. Une pause du canal de données de 350 ms reprend avant le délai FTP. La veille et le réveil du Mac restent à tester.
- WKWebView natif sur Apple Silicon, Retina 2×. Fenêtre compacte 1280 × 760 points et large 1600 × 900 points. Une Preview instrumentée sur profil isolé a piloté un listing synthétique `/sd2`. Vérifications du filtre et de sa remise à zéro, du focus visible, de la flèche sur le séparateur, de la sélection groupée, du retour depuis un dossier système, des noms longs, de l’erreur FTP de démonstration et de l’isolation du mode réel. Le parcours complet au clavier et le lecteur d’écran restent à valider.
- Le test IPC Tauri vérifie que le listing brut contient toujours l’AppleDouble et que sa mise en file échoue. Cinq tests frontend couvrent la démonstration et le filtre. La CI native vérifie le moteur, les 32 tests SAFE, le corpus FTP legacy, la coque et Electron V1. [CI de la branche](https://github.com/nakuakaben/hyper-media-puller/actions/workflows/rust-core.yml?query=branch%3Afeat%2Frust-v2-macos-qualification)

Le test terrain ne qualifie ni la concurrence physique, ni les fichiers de plus de 4 Gio sur HyperDeck, ni le Studio Mini 2017. Les résultats synthétiques de macOS et la compilation Windows ne qualifient aucun autre appareil.
