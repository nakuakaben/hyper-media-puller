# HyperDeck Media Puller

Projet HyperSync : sources de HyperDeck Media Puller. Pour une reprise sur une nouvelle machine, consulter [Developpement](docs/DEVELOPMENT.md), [Architecture](docs/ARCHITECTURE.md), [Etat du projet](docs/PROJECT_STATUS.md) et [AGENTS.md](AGENTS.md).

Application Windows Electron pour récupérer des médias depuis des Blackmagic HyperDeck Studio Mini accessibles en FTP sur le réseau local.

Version courante : `1.1.0`.

Objectif V1 : détecter des HyperDeck sur le réseau local puis copier des fichiers média depuis les recorders vers un dossier Windows, avec scan FTP, queue de copie, progression, vérification checksum, logs et gestion de doublons. L'application ne supprime jamais de fichier source, ne modifie jamais les médias source, ne formate jamais de carte et n'envoie aucune commande REC/STOP/PLAY/REBOOT.

## Installation

```powershell
npm install
```

L'application démarre sans recorder connecté. Le mode reel est actif par defaut ; la simulation se choisit explicitement dans Settings/Developer.

## Utilisation

1. Ajouter un recorder dans la colonne gauche avec un nom, une IP, le port FTP, l'utilisateur et le mot de passe.
2. Ou utiliser `Search HyperDeck` pour détecter automatiquement les recorders sur le réseau local.
3. Désactiver le mode mock/dev dans la colonne droite pour utiliser le FTP réel.
4. Tester la connexion FTP.
5. Scanner la racine `/` ou saisir un chemin FTP manuel si la structure de carte n'est pas détectée automatiquement.
6. Sélectionner des fichiers ou dossiers.
7. Choisir un dossier destination Windows.
8. Choisir l'organisation de destination :
   - dossier choisi directement ;
   - `NomRecorder/` ;
   - `NomRecorder/YYYY-MM-DD/`.
9. Ajouter la sélection à la queue, puis démarrer la queue.

Les fichiers source ne sont jamais supprimés ou modifiés sur les HyperDeck. L'application ne contient aucune action d'effacement de carte.

## Nouvelle interface

L'interface V1 utilise un thème sombre bleu nuit/cyan orienté régie : sidebar recorders avec `Search HyperDeck`, header de statut FTP, navigateur média central avec sélection, panneau destination/options/actions à droite, queue de transfert en bas et logs repliables.

Usage rapide :

1. Sélectionner ou détecter un HyperDeck.
2. Tester FTP puis scanner les médias.
3. Sélectionner fichiers ou dossiers.
4. Choisir la destination.
5. Ajouter à la queue et lancer `Start All`.

## Mode réel par défaut

Le mode simulation/mock est désactivé par défaut. Si une ancienne configuration locale le contenait activé, l'application le migre automatiquement à `false` au prochain démarrage.

Le mode simulation reste disponible dans `Settings > Developer` avec le libellé `Mode simulation : n'utilise pas le FTP réel`. Quand il est actif, un badge `SIMULATION` est visible dans la sidebar.

En mode réel, le navigateur média affiche uniquement les dossiers et fichiers retournés par le FTP du recorder. Aucun dossier virtuel n'est injecté.

## Reconnexion automatique

Au lancement, l'application recharge les recorders sauvegardés, sélectionne le dernier recorder utilisé si possible, teste le FTP en arrière-plan puis scanne automatiquement `/` si la connexion réussit.

Quand un recorder est sélectionné dans la sidebar, l'application lance automatiquement le test FTP puis le scan de la racine `/`. Le bouton `Rescan` refait aussi test FTP + scan racine.

Sur un HyperDeck Studio HD Mini, la racine FTP peut exposer les dossiers `1` et `2`, correspondant aux deux cartes SD/slots. Ces dossiers apparaissent seulement s'ils sont réellement retournés par le FTP.

Si une navigation échoue, l'application affiche une erreur de dossier et conserve la queue de transfert active. Utiliser `Root`, `Up` ou `Refresh` pour revenir à un chemin valide.

## Ajouter un HyperDeck

### Ajout manuel

1. Cliquer sur `Nouveau`.
2. Renseigner le nom lisible en régie.
3. Renseigner l'adresse IP du HyperDeck.
4. Laisser le port `21` sauf configuration spécifique.
5. Laisser `anonymous` et mot de passe vide si le FTP anonyme est utilisé.
6. Cliquer sur `Enregistrer`.

### Détection automatique Search HyperDeck

1. Cliquer sur `Search HyperDeck` dans la colonne gauche.
2. Choisir l'interface réseau locale :
   - Ethernet ;
   - Wi-Fi ;
   - autre interface IPv4 privée détectée.
3. Vérifier le CIDR proposé automatiquement, par exemple `192.168.1.0/24`.
4. Cliquer sur `Relancer scan`.
5. Vérifier les résultats dans le panneau `HyperDeck trouvés`.
6. Cliquer sur `Ajouter` pour un appareil ou `Ajouter tous`.

Le scan réseau reste entièrement dans le main process Electron. Le renderer ne reçoit que les résultats via IPC sécurisé.

La détection :

- ignore les interfaces loopback ;
- ignore les interfaces non IPv4 ;
- limite le scan aux réseaux privés locaux ;
- refuse les CIDR plus larges que `/24` ;
- utilise un test TCP, sans dépendre du ping ICMP ;
- teste TCP `9993` puis le protocole HyperDeck avec les commandes sûres `ping` et `device info` ;
- ne lance jamais `record`, `stop`, `play`, `format`, `reboot`, `slot select`, `clips remove` ou `clips clear` ;
- teste ensuite FTP `21` en anonymous avec un `list /` en lecture seule.

Statuts possibles :

- `ftp-ok` : HyperDeck confirmé et FTP anonymous accessible.
- `ftp-error` : HyperDeck confirmé mais FTP indisponible ou refusé.
- `already-added` : IP déjà présente dans la configuration.
- `unknown` : port `9993` ouvert mais protocole HyperDeck non confirmé.

## Tester la connexion

1. Sélectionner le recorder.
2. Désactiver `Mode mock/dev`.
3. Cliquer sur `Tester`.

Une IP incorrecte, un recorder éteint ou un FTP indisponible affiche une erreur propre dans l'interface et dans les logs.

## Scanner les médias

1. Sélectionner le recorder.
2. Cliquer sur `Racine` ou saisir un chemin FTP manuel.
3. Cliquer sur `Scanner`.
4. Ouvrir un dossier en cliquant sur son nom.
5. Utiliser `Monter` pour revenir au dossier parent.

Les dossiers peuvent être ajoutés à la queue : ils sont développés récursivement côté main process.

## Choisir la destination

Cliquer sur `Choisir dossier`, puis sélectionner un dossier Windows. Le dernier dossier utilisé est sauvegardé localement dans `appData`.

Modes disponibles :

- `Dossier choisi` : copie directement dans le dossier sélectionné.
- `NomRecorder/` : crée un sous-dossier par recorder.
- `NomRecorder/YYYY-MM-DD/` : crée un sous-dossier par recorder et par date.

## Lancer une copie

1. Sélectionner un ou plusieurs fichiers ou dossiers.
2. Cliquer sur `Ajouter la sélection à la queue`.
3. Cliquer sur `Démarrer`.
4. Surveiller les statuts, la progression, le débit et l'estimation de temps.

La taille inconnue affiche une progression indéterminée, mais le job et les logs restent suivis.

## Configuration IP HyperDeck

Sur chaque HyperDeck :

1. Vérifier que l'HyperDeck est connecté au réseau local.
2. Configurer une IP fixe ou une réservation DHCP.
3. Vérifier que le service FTP est accessible sur le port attendu, par défaut `21`.
4. Noter l'adresse IP et les identifiants FTP si l'accès anonyme n'est pas utilisé.

Dans l'application, créer un recorder par HyperDeck. Les valeurs par défaut sont :

- port FTP : `21` ;
- utilisateur : `anonymous` ;
- mot de passe : vide.

## Queue et doublons

La queue supporte plusieurs recorders et plusieurs fichiers. Par défaut :

- 2 copies simultanées globales ;
- pas de deuxième copie simultanée depuis le même recorder ;
- vérification checksum `MD5` après copie ;
- si un fichier destination existe avec la même taille, le job est marqué `skipped` ;
- si un fichier destination existe avec une taille différente, le fichier est renommé avec `_copy`, `_copy_2`, `_copy_3`.

Les autres politiques de doublons disponibles sont `écraser` et `ignorer`.

Modes de vérification disponibles :

- `None` : aucun checksum après copie.
- `MD5` : checksum local rapide, mode par défaut.
- `SHA-256` : checksum local plus robuste.
- `MD5 + SHA-256` : calcule les deux hashes.

Quand le mode checksum est actif, le transfert passe par `Copying`, puis `Verifying`, puis `Verified` si le hash reçu pendant le transfert correspond au fichier relu sur disque. Si aucun hash source distant n'est disponible, les logs indiquent explicitement qu'un checksum local a été calculé après copie.

Actions disponibles :

- `Démarrer` : lance les jobs en attente.
- `Pause` : n'ajoute plus de nouveaux jobs, les copies déjà en cours terminent sauf annulation.
- `Annuler` : annule un job en attente, en erreur ou en cours.
- `Relancer` : remet un job en erreur ou annulé en attente.
- `Vider terminés` : retire les jobs `done`, `skipped` et `cancelled`.

## Logs

Les logs sont visibles dans l'interface et écrits dans le dossier `userData` Electron :

```text
hyperdeck-media-puller.log
```

Ils couvrent au minimum connexions, scans, débuts et fins de copies, vérifications checksum, fichiers ignorés, erreurs FTP et annulations.

Les logs couvrent aussi le scan réseau : interface utilisée, plage CIDR, nombre d'IP testées, candidats port `9993`, HyperDeck confirmés, état FTP et annulation.

Les logs de packaging sont affichés dans le terminal lors des commandes `npm run dist:*`.

## Build dev

```powershell
npm run dev
```

Ce script démarre Vite puis Electron avec `contextIsolation` actif et `nodeIntegration` désactivé.

## Build Windows

```powershell
npm run build
npm run dist:win
```

Artefacts attendus dans `release/` :

- `HyperDeck Media Puller Setup x.y.z.exe`
- `HyperDeck Media Puller Portable x.y.z.exe`

## Génération portable

```powershell
npm run dist:portable
```

## Génération installeur

```powershell
npm run dist:installer
```

## Icône application

Les icônes officielles HMP sont attendues dans `build/` :

- `build/icon.ico` pour Windows, l'exécutable portable, l'application packagée et l'installeur NSIS ;
- `build/icon.icns` pour macOS si un build macOS est ajouté ;
- `build/icon.png` pour Linux si un build Linux est ajouté.

Le script `npm run build` vérifie ces fichiers et affiche l'icône utilisée. La fenêtre Electron utilise aussi `build/icon.ico` en développement et la ressource packagée en production.

## Smoke test dev

```powershell
npm run smoke:dev
```

Ce test lance Vite + Electron, vérifie l'ouverture de la fenêtre, l'isolation renderer, le preload IPC, le scan mock, la queue, l'annulation, les doublons et une erreur FTP réseau propre.
Il vérifie aussi l'API Search HyperDeck, la récupération des interfaces réseau et, si les ports locaux sont disponibles, une détection HyperDeck simulée sur TCP `9993` avec FTP `21`.

## Limites connues

- Le FTP des HyperDeck peut ne pas exposer les dates selon firmware et structure de carte.
- Les tailles inconnues affichent une progression indéterminée, avec conservation des logs.
- Le mode `demander` pour les doublons n'est pas exposé en V1 ; utiliser une politique globale avant de lancer la queue.
- Les performances dépendent fortement du réseau, du support média et de la capacité FTP du recorder.
- Les copies annulées peuvent laisser un fichier partiel local ; le fichier source sur HyperDeck n'est pas touché.
- Les exécutables générés ne sont pas signés si aucun certificat de signature Windows n'est configuré.
- Search HyperDeck ne scanne pas Internet et refuse les réseaux plus larges que `/24`.
- Un port `9993` ouvert sans réponse HyperDeck est affiché comme inconnu et n'est pas ajouté automatiquement.

## Dépannage basique

- Connexion refusée : vérifier IP, port FTP, réseau, alimentation du recorder et mode FTP.
- Scan vide : essayer le chemin manuel `/`, puis ouvrir les dossiers de carte détectés.
- Copie lente : réduire les copies simultanées globales, surtout sur un réseau régie partagé.
- Fichier ignoré : vérifier si un fichier destination de même taille existe déjà.
- Fichier renommé : un fichier de même nom avec taille différente existe déjà et la politique `Renommer` est active.
- Interface sans recorder : activer le mode mock/dev pour valider le workflow sans matériel.
- Aucun HyperDeck trouvé : vérifier l'interface réseau choisie, le VLAN, le sous-réseau CIDR et l'accès au port TCP `9993`.
- HyperDeck trouvé mais FTP erreur : vérifier que le FTP du recorder est actif, que le port `21` est accessible et que l'accès anonymous est autorisé.

## Procédure de récupération en régie

1. Lancer l'application avant le début de la récupération.
2. Vérifier que tous les recorders attendus répondent au test FTP.
3. Choisir un dossier destination sur un disque local ou réseau fiable.
4. Scanner chaque recorder et vérifier visuellement les cartes/dossiers.
5. Ajouter les fichiers ou dossiers utiles à la queue.
6. Démarrer la queue avec la limite de concurrence adaptée au réseau.
7. Surveiller les statuts `done`, `skipped` et `error`.
8. Relancer uniquement les jobs en erreur après correction réseau ou stockage.
9. Conserver le fichier de log avec le dossier de récupération.
