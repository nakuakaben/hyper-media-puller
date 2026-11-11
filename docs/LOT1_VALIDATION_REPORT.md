# Rapport de validation — lot 1

Session du **10 novembre 2026**, fuseau Europe/Luxembourg. Base V1 : `8881ec3c4ad4a79d145af0f3271343836d209dbb` ; HMP **1.1.0**. Branche `feat/rust-v2-lot1`, créée depuis main. La PR #1 demeure ouverte, non fusionnée ; son contenu documentaire a été repris dans un commit distinct pour préserver les quatre documents de préparation. Aucun force push, release ou fusion.

## Travail livré

- Contrats observables V1 par module et inventaire des 16 invocations / 3 abonnements IPC.
- Fixtures synthétiques anonymisées et 72 tests automatisés sur le code V1 compilé : chemins, login/listing legacy, réseau, queue, duplication, erreurs, progression, hashes, paramètres et IPC.
- Serveur FTP minimal en lecture seule, sur loopback/ports éphémères, exerçant le vrai client basic-ftp et de vrais petits fichiers.
- Smoke Electron existant isolé : userData/sessionData temporaires fixés avant chargement du main, vérification de settings.json dans le profil temporaire, contrôle des ports avant attachement CDP et nettoyage après arrêt des enfants. Le sondage LAN historique est désormais opt-in et n'a pas été lancé.
- Exigences de sécurité V2 et contrats Rust indépendants de l'UI ; roadmap actualisée avec les décisions validées et le jalon matériel encore ouvert.

Le répertoire `src/`, les assets, la version, les dépendances et `package-lock.json` restent identiques à main. Le seul changement de package est une commande de test. Aucun moteur Rust/Tauri, écran ou workspace V2 n'est introduit. Aucun défaut de transfert V1 n'est corrigé silencieusement.

## Environnement et résultats exécutés

macOS **26.1**, Apple Silicon **arm64**, Node **24.22.0**, npm **11.19.1**, basic-ftp **5.3.1**, Electron **43.1.0** et Vite **6.4.3** du lockfile. Les résultats ci-dessous décrivent cette session, pas une validation Windows.

| Commande / contrôle | Résultat | Limites |
| --- | --- | --- |
| Vérification main et PR #1 via GitHub | Base inchangée ; PR #1 open, merged=false | Historique local superficiel hérité de la préparation ; publication par connecteur GitHub |
| `npm ci` avec Node 24 | Réussi, 376 paquets installés, 377 audités | 25 vulnérabilités signalées : 7 modérées, 17 hautes, 1 critique ; dépendances non modifiées |
| `npm run build:app` | Réussi : TypeScript main/renderer + Vite, quatre PNG embarqués | Pas de packaging Windows/macOS ni de distribution |
| `npm run test:ftp-paths` | Réussi : sept cas historiques | Normalisation seule, pas une session FTP |
| `npm run test:characterization` | **72 tests passés, 0 échec, 0 skip** | 33 chemins/FTP à frontières injectées, 8 WIRE, 24 queue, 7 paramètres/IPC/réseau |
| `npm run smoke:dev` | Réussi, marqueurs SMOKE_PROFILE_ISOLATED et SMOKE_OK | Profil de test temporaire ; queue mock ; réseau physique explicitement non testé |
| Vérification sources RWA 0.8.1 | Huit fichiers disponibles, empreintes inchangées depuis l'audit | Pas de rendu/capture de RWA ni copie de ses fonctionnalités |
| Diff, liens documentaires et fixtures | Contrôlés avant publication | Contrôle local et empreintes ; pas d'attestation de sécurité exhaustive |

Une première exécution du corpus dans le sandbox a passé 64/70 cas mais échoué sur les six écoutes loopback avec EPERM. Après autorisation d'écoute locale, les 70 cas ont passé ; les deux scénarios de fermeture/annulation réelles ajoutés ensuite donnent le résultat final **72/72**. Aucun échec réseau n'a été masqué par skip.

L'évidence expurgée [tests/results/lot1-macos.json](../tests/results/lot1-macos.json) contient les noms des 72 tests réellement passés, l'environnement et les SHA-256 des entrées de test. Les logs bruts restent hors Git : ils contiennent des chemins temporaires locaux, pas de captures matérielles. Le corpus est rejouable avec les commandes de [tests/README.md](../tests/README.md).

Le smoke a contrôlé l'isolation renderer (require/process absents, API bridge présente), version/notes/checksum UI, absence de débordement horizontal à la fenêtre testée, scans mock, same-size skip, concurrence multi-recorders, annulation, renommage, mode sans checksum, erreur FTP loopback et logs. Les états finaux du lot mock étaient cancelled/verified/verified. Ce « verified » mock correspond à la sémantique V1, pas à une preuve de copie physique.

## Défauts V1 désormais reproduits

| Constat | Preuve exécutée | Interprétation |
| --- | --- | --- |
| Taille égale ignore même overwrite et contenu différent | DUP-SAME-* | Pas de détection fiable d'identité |
| Deux jobs peuvent viser la même destination | QUEUE-05 + DEST-01 | Réservation absente ; le test ne provoque pas volontairement une corruption de média réel |
| Annulation pendant hash finit verified | HASH-CANCEL | Course de transitions à corriger dans le futur moteur |
| Partiels non vides au nom final | WIRE-05/07/08 et QUEUE-03 | Réponse 426, fermeture contrôle ou cancel ne produisent pas une sortie finale sûre |
| Queue ne contrôle pas la taille locale avant done | SIZE-MISMATCH | Succès de transport injecté pour exposer la responsabilité manquante de la queue |
| Politique de doublon enqueue ignorée | QUEUE-04 | Settings de lancement utilisés à la place |
| Hash sans valeur attendue marque verified | HASH-NO-EXPECTED | Distinguer LocalOnly et comparaison flux/local en V2 |
| Chemins #/? tronqués ; contrôle CR/LF/noms réservés incomplet | PATH-12…19 | Ne pas réutiliser path-utils comme validateur V2 universel |
| Queue non persistante, erreurs settings masquées | QUEUE-06, CONFIG-02 | Redémarrage/fichier corrompu demandent un contrat explicite |

Les tests caractérisent les défauts, sans les transformer en exigences V2. La [spécification de sécurité](TRANSFER_SAFETY_SPEC.md) relie chaque correction future à son critère d'acceptation.

## Compatibilité FTP : preuve acquise et manquante

Acquis sur doubles : ordre vide → anonymous@hmp.local → guest@, conditions de fallback et fermeture des sessions, / et /1 et /2, 501/CWD/listing sans argument, erreurs 550, tri/filtrage et expansion récursive. Acquis en TCP local : fallback login, EPSV refusé/PASV, LIST -a puis LIST, CWD après 501, parseurs POSIX/DOS, Unicode et zéro octet, RETR et deux hashes, timeout greeting, réponse 426, cancel réel et fermeture de contrôle sans 226.

**Non acquis sur matériel : HyperDeck Studio Mini 2017 et modèle récent.** Aucun appareil physique n'a été adressé dans cette session ; aucun firmware, média ou résultat de matériel n'est inventé. Voir HW-01…07 dans [FTP_LEGACY_TEST_MATRIX.md](FTP_LEGACY_TEST_MATRIX.md).

## Référence graphique vérifiée

La copie locale RWA reste version **0.8.1**. Les empreintes de `docs/design-system.md`, tokens/composants/layout CSS, `src/style.css`, `src/main.ts`, LICENSE et package.json ont été recalculées et correspondent à celles relevées à la préparation. Les six premières sont conservées dans [UI_REDESIGN_PLAN.md](UI_REDESIGN_PLAN.md) ; LICENSE SHA-256 : `3c55fe980b22ad478d8d0d5df7c6e60703fdafda72e17292d8737ea9a2618816`, package.json : `2a2efcbd191fc5b16260d52881a091d40b1f3fdba201b6cbc0b23882858f27ea`.

Palette anthracite, sélection #1177d7, piles locales Inter/monospace, contrôles 30/34 px, header 40 px, navigation basse 44 px, état 28 px, focus bleu et splitters 1 px/prise 5 px restent disponibles dans les sources. Aucun actif ni logique de montage/Resolve/IA n'est importé ; aucune UI nouvelle n'est développée.

## Limites et tests restant à réaliser

- Matériel legacy/récent, plusieurs appareils réels, encodages/firmwares et multicarte réseau : HW-01…07.
- Disque réellement plein ou retiré, gros fichiers >4 Gio, NTFS/exFAT, droits/chemins Windows et crash réel pendant copie : non exécutés. ENOSPC/EIO et transitions de queue sont testés par injection seulement.
- Tests natifs Windows, signatures, packaging, installation et distributions : non exécutés.
- UI de sélection complète, course de navigation recorder, accessibilité et plusieurs résolutions : non qualifiées par le seul smoke. Pas de captures visuelles nouvelles.
- Les interfaces Rust sont proposées, pas compilées ; pas de performance ou de compatibilité Rust mesurée.
- Le lancement smoke temporaire change l'appPath de son bootstrap ; l'icône de fenêtre de développement peut être signalée absente à cet emplacement. Les PNG renderer sont compilés normalement ; ce montage n'est pas un test d'installateur.

## Fichiers et suite

Nouveaux documents : `V1_BEHAVIOR_CONTRACT.md`, `FTP_LEGACY_TEST_MATRIX.md`, `TRANSFER_SAFETY_SPEC.md`, `RUST_DOMAIN_CONTRACTS.md`, ce rapport. Préparation V2 conservée ; `V2_MIGRATION_ROADMAP.md` et `DEVELOPMENT.md` actualisés. Tests ajoutés sous `tests/`, script smoke isolé et commande test ajoutée à package.json.

Le comportement V1 est suffisamment caractérisé pour commencer les types, ports et transitions du moteur avec doubles ; la compatibilité matérielle reste un jalon bloquant avant de qualifier l'adaptateur FTP. **Arrêt après publication de la PR en brouillon.** Prochaine étape recommandée, après validation utilisateur : lot 2, cœur Rust indépendant avec tests de sécurité issus de SAFE-01…12, sans application Tauri prématurée.
