# Validation du lot 3 FTP Rust

Le lot part de `origin/main` au commit `278db71a65a0d35f238bb0c9f77b79e52f50b85e`, qui contient la préparation, le corpus V1 et le moteur du lot 2.

## Vérifications exécutées localement

Environnement du 11 novembre 2026, macOS ARM64, Rust 1.99.1 et Node 24.22.0.

| Vérification | Résultat |
| --- | --- |
| Formatage Rust et Clippy strict toutes cibles | Réussis |
| Compilation Rust avec Cargo.lock | Réussie |
| Domaine Rust et sécurité du moteur | 7 tests de domaine et 32 scénarios de sécurité réussis |
| Banc TCP en boucle locale | 13 tests réussis, dont les 7 cas d’authentification et les 5 cas de listing rejoués depuis les fixtures du lot 1 |
| Installation du lockfile et compilation Electron V1 | Réussies |
| FTP Electron V1 | 7 cas historiques et 72 tests de caractérisation réussis |

Les 52 tests Rust incluent des échanges sur sockets TCP, le passage listing → sélection → RETR, deux recorders synthétiques, les deux modes passifs, les réponses 501/530/550, le rejet de chemins invalides et la conservation des noms. Les scénarios d’échec incluent un 426 suivi d’un 226, un EOF sans réponse finale, une réponse 200 à la place d’une fin de transfert, un timeout, une annulation en cours de lecture et une taille erronée. Le banc vérifie les checksums et l’absence de publication après échec. La sonde d’identification TCP utilise une réponse de banc qui porte le libellé Studio Mini. [Implémentation et procédure matérielle](RUST_FTP_IMPLEMENTATION.md)

Les jobs GitHub Actions utilisent macOS ARM64 et Windows x64. Ils exécutent formatage, Clippy, tests et compilation Rust, ainsi que l’installation, la compilation et les tests V1 sur chaque système. Les conclusions et journaux par commit sont accessibles dans la PR du lot 3 et dans [l’historique de CI de la branche](https://github.com/nakuakaben/hyper-media-puller/actions/workflows/rust-core.yml?query=branch%3Afeat%2Frust-v2-ftp).

## Comparaison des comportements

| Comportement observé | V1 | V2 |
| --- | --- | --- |
| Anonymous | Mot de passe vide, puis les deux valeurs historiques selon le refus | Même séquence pour 501/530, erreur structurée et nouvelle connexion par tentative |
| Listings legacy | LIST -a, LIST, CWD et listing sans argument, via basic-ftp | Même famille de stratégies, reprise limitée aux refus avant le début du listing |
| Dossiers et noms | Entrées FTP réelles, normalisation V1 tronquant certains noms avec # ou ? | Entrées FTP réelles, noms UTF-8 conservés, chemins dangereux refusés |
| Découverte | Ping et device info, puis vérification FTP | Device info sur une IPv4 locale explicitement sélectionnée, vérification FTP via le port de lecture |
| Passif | EPSV et PASV via basic-ftp | EPSV et fallback PASV IPv4, pair de contrôle utilisé pour le canal de données |
| Copie interrompue | Des octets peuvent subsister au nom final dans le corpus V1 | Partiel identifiable, nom final réservé jusqu’à confirmation de fin et vérifications |
| Checksums | MD5 et SHA-256 de la copie | Comparaison entre flux et relecture locale avec portée explicite |

## Matériel restant à qualifier

Le Studio Mini 2017 et un HyperDeck récent restent à tester sur le réseau réel. Le banc synthétique couvre les réponses historiques connues, avec un format de listing POSIX, un format DOS et une identification simulée. La qualification du firmware réel, des noms non UTF-8, du réseau multicarte, de la concurrence entre deux appareils physiques et des médias de plus de 4 Gio reste ouverte. La destination utilisée ici est le bac à sable de test du lot 2. La qualification définitive et la release dépendent du passage de ces essais matériels. [Scénarios HW-01 à HW-07](FTP_LEGACY_TEST_MATRIX.md)

**Suivi lot 4.** Le Studio Mini 2017 est indisponible. Les essais matériels restent au backlog de qualification et les lots de développement continuent sur le banc synthétique. Les futures releases distingueront les modèles réellement testés des modèles dont la compatibilité reste à vérifier.
