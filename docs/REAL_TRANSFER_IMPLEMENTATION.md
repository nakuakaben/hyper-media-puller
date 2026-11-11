# Offloads réels HMP V2

HMP V2 transfère les médias des HyperDeck vers un dossier choisi dans la fenêtre Tauri. Le moteur Rust reste indépendant de Tauri. Le WebView manipule des identifiants, des métadonnées et des snapshots. Les octets du média passent du canal FTP au temporaire local dans Rust.

## Utilisation

1. Dans **Médias**, identifier un HyperDeck avec son IPv4 locale. Ouvrir un dossier effectivement retourné par FTP.
2. Sélectionner les fichiers, ouvrir **Destination et options** et choisir un dossier avec le dialogue natif. En largeur compacte, ouvrir **Options**.
3. Choisir la politique de doublons et le checksum, puis ajouter la sélection. **Transferts** ouvre le lot en attente.
4. Démarrer le lot. Le détail affiche l’état, la progression de copie et de vérification, la taille, l’erreur éventuelle et la destination finale. Le débit et le temps restant sont affichés seulement si les échantillons d’écriture permettent de les estimer.
5. Dans **Rapports**, choisir le lot. **Afficher le JSON** donne le rapport versionné. Les rapports et la file restent consultables pendant la session.

La pause suspend les prochains départs du lot. Une copie active peut finir. Une annulation conserve les partiels éventuels. **Réessayer** crée une tentative neuve avec les mêmes options et destination. Après un réessai sur un lot arrêté, le bouton de démarrage reste nécessaire. Le mode démonstration garde ses propres appareils, sa propre file et ses propres rapports.

## Destination et publication

- Rust reçoit la sélection directement du dialogue natif. Le frontend ne fournit aucun chemin local à la commande de mise en file. La destination par défaut et les options enregistrées sont stockées dans le profil V2 dédié, dans `offload-settings-v1.json`. Le dossier enregistré est revalidé au premier ajout d’une nouvelle session. Chaque lot fige sa destination, sa politique de doublons, son checksum et ses limites de concurrence. Lorsque des lots actifs coexistent, la limite la plus stricte applicable prévaut.
- Un handle de répertoire confine les opérations aux dossiers ouverts. Un répertoire de staging exclusif `.hmp-<uuid>` du même volume contient les temporaires `.hmp-<job>-<tentative>.part`. Les noms locaux portables sont conservés. Les autres utilisent le mapping réversible hexadécimal `hmp-` du moteur. Un nom dépassant la limite de 200 octets après encodage est refusé.
- L’ouverture du dossier vérifie l’écriture et l’opération de publication sur des fichiers de sonde isolés. L’espace libre est consulté lorsqu’il est disponible. La taille attendue est contrôlée par job. La prévision reste indicative lorsque plusieurs jobs ou d’autres processus consomment de l’espace. Les erreurs effectives d’écriture, flush, sync et publication remontent au moteur.
- Sur macOS, le chemin sans remplacement utilise `renameatx_np` avec `RENAME_EXCL`, par handles de répertoire. Sur Windows, un hard link publie sans écrasement, puis le temporaire est supprimé. L’écrasement explicite d’un fichier existant utilise le renommage de remplacement sur le même volume. Si le nom était libre lors de la réservation, la publication reste sans écrasement. Un échec de renommage ne déclenche aucun remplacement par copie ni suppression de l’original.
- L’application exige la fin FTP valide, la taille annoncée lorsqu’elle est connue, le flush et le sync du temporaire, puis le contrôle demandé avant de publier. Les limites d’atomicité et de durabilité varient selon le volume. Un volume incapable de garantir l’opération sans écrasement est refusé lors de la sonde. L’exFAT de test macOS a été refusé. Les partages réseau et la coupure électrique restent à qualifier.

La fermeture normale demande l’arrêt du moteur et attend le nettoyage logique des tentatives. Une opération disque déjà remise au système peut finir sur un temporaire après annulation. Une interruption brutale peut laisser un partiel identifiable. Les résidus ne sont ni publiés, ni repris automatiquement.

## IPC et rapports

`choose_destination` ouvre le dialogue Rust et retourne la destination affichable. `transfer_settings` et `save_transfer_options` servent les paramètres. `enqueue_transfer` accepte le schéma 1, un appareil déjà identifié et des chemins de fichiers effectivement retournés par un listing. Les tailles sont reprises du listing Rust. Le moteur reçoit des demandes validées et des options figées.

`transfer_action` reçoit l’identité d’un lot ou d’un job et une action typée. `transfer_queue` retourne un snapshot autoritatif avec séquence, compteurs décimaux et identifiants de tentatives. Le WebView le relit environ toutes les 450 ms. Après interruption du frontend, un nouveau snapshot restitue les états terminaux encore présents dans le moteur. `transfer_report` projette ces résultats en JSON schéma 1 avec les dates et durées, la source, les tailles, la destination, les erreurs, les tentatives et les empreintes.

MD5 et SHA-256 peuvent comparer le flux reçu et la relecture locale. Le rapport indique cette portée. Une décision **Ignorer** indique un fichier existant dont l’identité reste inconnue. La file et les rapports sont en mémoire dans ce lot. Seuls la destination et les réglages par défaut survivent au redémarrage. [Validation du lot 5](LOT5_VALIDATION_REPORT.md)
