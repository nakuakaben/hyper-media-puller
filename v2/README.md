# HMP V2 — moteur Rust, lot 2

Workspace indépendant de l'application Electron. Aucun Tauri, frontend V2, adaptateur FTP réel ou accès aux paramètres utilisateur. Le moteur exécute des transferts simulés complets avec de vrais fichiers dans un bac à sable temporaire privé.

```sh
cd v2
cargo fmt --all --check
cargo clippy --workspace --all-targets --locked -- -D warnings
cargo test --workspace --locked
cargo build --workspace --locked
cargo run --locked -p hmp-infra --example simulate
```

Utiliser Rust stable avec rustfmt et clippy ; version de validation locale et CI : **1.99.1**. Cargo.lock est commité, les dépendances directes sont exactes. La version minimale déclarée n'a pas de qualification séparée : ne pas déduire un résultat MSRV d'un build avec le stable courant.

L'exemple transfère les médias de deux recorders fictifs, résout leur collision de destination, vérifie MD5/SHA-256 et imprime un snapshot JSON. Les octets et compteurs `u64` sont transmis sous forme de chaînes décimales dans les DTO. Le bac à sable et ses fichiers sont supprimés lorsque son adaptateur est détruit ; il n'écrit pas dans une destination opérateur.

| Crate | Responsabilité |
| --- | --- |
| hmp-domain | Identités UUID, chemins FTP et noms locaux distincts, lots immuables, états et invariants |
| hmp-core | Acteur ordonnanceur, commandes, streaming, annulation, vérification, finalisation, événements et ports |
| hmp-infra | Doubles déterministes, découverte/lecture simulées, réglages mémoire et destination temporaire réelle |
| hmp-contract | DTO versionnés, conversion validante des entrées et projections sans interface graphique |

Le port destination sépare la préparation annulable et le commit synchrone : le commit et le passage terminal ont lieu dans un seul tour de l'acteur. Une annulation acceptée avant commit interdit la publication ; après le commit, elle retourne AlreadyTerminal. Les fichiers partiels de chaque tentative restent identifiables pendant la vie du bac à sable.

`SandboxDestination` est un adaptateur de test, avec I/O synchrones bornées, répertoire privé et noms à un seul composant validés. Il ne constitue pas un adaptateur de production pour disque opérateur, partage réseau, liens symboliques hostiles ou récupération après crash. Les ports futurs devront respecter leurs contrats d'annulation, RAII, atomicité et exécution courte du commit.

Détails : [implémentation](../docs/RUST_CORE_IMPLEMENTATION.md), [validation](../docs/LOT2_VALIDATION_REPORT.md), [tests SAFE](tests/safety.rs). La compatibilité des HyperDeck et notamment du Studio Mini 2017 reste à qualifier au lot FTP réel.
