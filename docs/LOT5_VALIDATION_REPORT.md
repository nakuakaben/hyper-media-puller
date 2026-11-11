# Validation du lot 5 · Offloads réels

Base `5dd2389`, après fusion des lots précédents. Les essais écrivent uniquement dans des répertoires temporaires ou des images de disque jetables.

## Résultats locaux

| Contrôle | Résultat |
| --- | --- |
| Moteur Rust | 7 tests de domaine, 32 tests SAFE et 14 tests FTP sur sockets. Les scénarios couvrent les collisions entre deux sources, le FTP interrompu, l’annulation en lecture et en vérification, le checksum incorrect, le disque plein injecté, la finalisation en échec et l’arrêt. |
| Destination de production | 4 tests locaux. Deux noms réservés sans collision, même taille avec octets différents, skip explicite, overwrite explicite, apparition tardive d’un fichier final, substitution du temporaire, précontrôle d’espace, permissions Unix et refus d’un lien. |
| Tauri IPC | 2 tests. Validation de l’IPv4 et parcours IPC avec la capability réelle, un serveur FTP de boucle locale, deux dossiers, changement de réglages après création du lot, relecture du snapshot terminal et rapport JSON vérifié. |
| macOS WKWebView | Bundle natif Apple M1. Parcours piloté dans une build instrumentée temporaire vers un banc de boucle locale. Identification par saisie IPv4, listing, sélection, file, démarrage, progression, état Vérifié et rapport JSON. Le banc substitue des ports éphémères et présélectionne un dossier temporaire. L’instrumentation est retirée du bundle livré. |
| Octets et empreintes | 8 388 608 octets. Comparaison indépendante octet par octet avec la fixture, MD5 `ae4460d628a979c11fc20317172f74b8` et SHA-256 `91c52c6dc18fa04da1554aba56b28bf2b780d1f1b0019ebbeb93a6d20975f1e8`. |
| CI | Le workflow vérifie formatage, Clippy, tests et compilation du moteur et de la coque, ainsi que les contrôles Electron V1 sur macOS et Windows natifs. [Exécutions de la branche](https://github.com/nakuakaben/hyper-media-puller/actions/workflows/rust-core.yml?query=branch%3Afeat%2Frust-v2-transfers) |

## Volumes et situations

| Support | Qualification exécutée |
| --- | --- |
| APFS | Destinations temporaires sur macOS. Sur une image APFS de 96 Mio, une écriture a réellement renvoyé ENOSPC après 96 927 744 octets écrits. Les octets se trouvaient uniquement dans le partiel. |
| NTFS | Les tests du runner Windows s’exécutent dans son dossier temporaire. La CI enregistre le système de fichiers et teste un refus explicite de création par ACL ainsi que collision, remplacement, FTP et IPC. |
| exFAT | Image exFAT 64 Mio montée sur macOS. La sonde sans remplacement a renvoyé `Operation not supported`. Le dossier est refusé avant la mise en file. Le chemin Windows, qui utilise un hard link, exige également cette capacité. Aucun essai exFAT Windows. |
| Partage réseau et support amovible | Aucun test sur SMB/NFS ni retrait de périphérique pendant la copie. Les images locales ne reproduisent pas la perte d’un lien réseau ni une coupure d’alimentation. |

La sécurité de fermeture a été exercée avec un transfert réel synthétique actif et un autre vérifié, puis un appel à l’arrêt du moteur. Une annulation pendant la relecture et les erreurs de vérification sont exercées avec des points d’injection contrôlés. Aucun kill matériel, firmware HyperDeck ni WebView2 interactif n’a été qualifié. Le Studio Mini 2017 reste au backlog. [Détails d’implémentation](REAL_TRANSFER_IMPLEMENTATION.md)
