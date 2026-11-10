# Roadmap progressive HMP V2

10 novembre 2026 — préparation uniquement. Electron 1.1.0 reste la référence utilisable et ses scripts sont préservés. Chaque lot futur passe par une PR vers main ; aucune fusion automatique ni réécriture globale.

## Livrable de préparation et point d'arrêt

Cette PR contient [l'audit](RUST_MIGRATION_AUDIT.md), [la proposition Rust](RUST_ARCHITECTURE_PROPOSAL.md), [le plan UI](UI_REDESIGN_PLAN.md) et cette roadmap. Les instructions de développement renvoient à ces documents. Aucun nouveau workspace Rust, écran V2, changement FTP, version ou dépendance n'est introduit.

**Mise à jour lot 1, 10 novembre 2026 :** l'utilisateur a validé Tauri 2 + Rust + React/TypeScript/Vite, le moteur indépendant, RWA 0.8.1, macOS/Windows, la conservation d'Electron et le lot 1. Les sections historiques de préparation restent conservées. Attendre désormais la validation du **lot 2** après la PR lot 1 ; aucune fusion ni suite automatique.

## Lots, dépendances et critères de sortie

Estimations indicatives en jours de travail d'une personne connaissant Rust et TypeScript, hors attente matériel/comptes. Elles représentent une plage de complexité, pas un engagement de délai.

| Lot | Travail concret | Dépendance / preuve de sortie | Charge |
| --- | --- | --- | --- |
| 0 — préparation | Audit de sources, preuves de build/tests, options d'architecture et référence RWA | Cette PR documentaire, décisions listées ci-dessous ; réalisé dans cette mission | Livré |
| 1 — caractériser V1 et extraire le contrat | Inventaire API/IPC, chemins, politiques et états ; isoler le smoke userData ; collecter dialogues FTP anonymisés et tests du Studio Mini 2017 | Autorisation ; corpus V1 reproductible, captures de session et résultats séparés réels/simulés | 3–5 j |
| 2 — cœur et modules Rust | Workspace isolé `v2/`, identités/chemins/états, ports réseau-disque, erreurs, options de lots et ordonnanceur sans GUI | Lot 1 ; tests unitaires contrats et machine à états, fmt/clippy/test sur macOS et Windows | 5–8 j |
| 3 — compatibilité réseau/FTP | Adaptateur candidat, découverte TCP, login anonymous/fallbacks, LIST/CWD, RETR streaming et annulation | Lot 2 ; banc simulé puis matériel legacy et récent, rapport de différences V1/V2 ; aucune opération d'écriture distante | 5–9 j |
| 4 — reconstruire l'UI | Extraire la charte RWA approuvée, composants, appareils/médias/options, file, paramètres et version | Révision RWA et architecture approuvées ; états/tailles cibles capturés et relus ; bridge testable | 5–8 j |
| 5 — intégrer les transferts | UI ↔ moteur, lots figés, destinations réservées, fichiers partiels, hash/relecture, rapports structurés | Lots 3 et 4 ; plusieurs recorders, annulation/réessai, doublons et collisions vérifiés de bout en bout | 5–8 j |
| 6 — qualifier macOS | Build natif, dialogue destination, droits disque, réveil/fermeture/fenêtre, gros fichiers, Retina et réseau multicarte | Lot 5 ; rapport matériel et UI, aucune corruption ni modification source | 3–5 j |
| 7 — qualifier Windows | NTFS/exFAT selon périmètre, noms réservés, casse/Unicode, chemins longs, pare-feu, WebView2 et DPI | Lot 5 ; mêmes corpus, build natif Windows et résultats comparables macOS | 3–5 j |
| 8 — packaging / distribution | CI par OS, signature/notarisation, installateurs, coexistence V1/V2, documentation opérateur et rollback | Lots 6 et 7 ; essai sur machines propres, artefacts identifiés par SHA, décision de release | 3–5 j |

Total indicatif après validation : **32–53 jours**, plus marge de 20–30 % pour variations FTP legacy, médias/disques et distribution ; environ **38–69 jours** avec marge. Le bas de plage suppose matériel disponible, pas de reprise après crash ni portable avancé ; le haut augmente si compatibilité legacy ou packaging posent problème. egui ajouterait probablement un effort UI significatif : réestimer le lot 4 plutôt que lui attribuer un gain supposé. Le lot 1 doit permettre de resserrer cette estimation.

Les lots 3 et 4 sont techniquement partiellement indépendants après stabilisation des contrats ; cela n'autorise pas à intégrer des transferts non qualifiés. Les lots 6/7 doivent être rejoués pour les changements qui affectent leur périmètre.

## Extraction progressive sans compromettre Electron

1. Commencer par extraire les spécifications observables et les fixtures ; ne pas déplacer les services V1 dans la première étape. Les comportements corrects sont préservés, les défauts identifiés sont des changements explicites.
2. Ajouter V2 dans `v2/` avec workspace/package/lockfiles séparés. La racine Electron reste compilable et son installation reste utilisable.
3. Tester le moteur Rust sans UI avec les mêmes scénarios que V1 et comparer les listings, chemins, statuts et fichiers locaux. Ne pas tester simultanément deux moteurs sur la même destination.
4. Connecter la nouvelle UI seulement lorsque les contrats et le banc FTP ont passé leurs critères. Les premières captures restent des préversions identifiées.
5. Distribuer sous identifiant et profil V2 preview distincts. Importer les paramètres V1 par copie validée ; ne jamais partager le fichier settings ni migrer en place.
6. Garder la possibilité de relancer V1. Les éventuels nouveaux formats de rapports et données V2 ne sont pas écrits dans le profil V1 ; aucun changement de firmware ou des médias source n'est requis.

Si le candidat FTP échoue sur un appareil obligatoire, suspendre l'intégration FTP de V2 et comparer les traces avec V1 ; conserver V1 disponible. Ne pas supprimer un fallback au motif qu'un serveur de test moderne ne l'utilise pas.

## Matrice FTP de compatibilité à exécuter

Cette matrice décrit des tests **à réaliser**, pas des succès obtenus.

| Domaine | Cas indispensables | Résultat attendu |
| --- | --- | --- |
| Matériel | Studio Mini 2017 avec firmware relevé ; au moins un modèle récent ; deux appareils simultanés | Listing et offload conformes aux médias présents, références V1/V2 documentées |
| Auth | anonymous vide accepté ; vide refusé puis anonymous@hmp.local ; guest@ ; identifiants explicites ; 501/530 et autre erreur | Ordre/conditions de fallback préservés, session fermée entre tentatives, pas de secret dans logs |
| Listing | Racine /, /1, /2, vide, LIST -a refusé puis LIST ; 501 avec CWD+LIST ; formats et dates anciens | Dossiers réels seulement, aucun volume injecté, noms/tailles préservés |
| Chemins | Sept cas V1 + antislash, slash répétés, .., URL, espaces, accents et noms contenant #/? | Séparation chemin brut/URL, politique de compatibilité explicite et aucun échappement destination |
| Passif / protocole | Stratégie EPSV/PASV observée, adresse de réponse et timeouts ; réponses multiligne et RETR interrompu | Connexions compatibles, fin du transfert contrôlée, aucun faux done |
| Réseau | Appareil inaccessible, port 9993 seul, FTP seul, déconnexion au listing/au milieu RETR | Résultat inconnu/FTP indisponible correct, ajout manuel possible, queue des autres recorders continue |
| Annulation | Pendant connexion, listing, transfert, vérification et pause | Ressources libérées ; état terminal stable ; partiel identifié et final intact |
| Intégrité | Petit fichier, zéro octet, >4 Gio, taille inconnue, fin prématurée, hash local incorrect | Taille/empreintes et portée de vérification correctes ; pas d'assimilation taille=contenu |

Les captures de dialogues doivent contenir uniquement les commandes nécessaires à la lecture et à l'information. Masquer IP si nécessaire et tout identifiant personnel. Pour comparer un fichier matériel, utiliser un média de test stable ; ne pas provoquer d'arrêt d'enregistrement ni modifier les supports originaux.

## Tests queue, disque et interface

- Même recorder / plusieurs recorders : plafond global et plafond par appareil ; erreur d'un job ne bloque pas les autres ; pause/reprise et réessai restent cohérents.
- Deux médias de même basename provenant de dossiers/recorders différents : réservation et politique de collision déterministes, y compris départ simultané et destination déjà occupée.
- Doublon même taille mais contenu différent, taille différente, fichier partiel et taille inconnue : libellés et résultats exacts, aucune preuve de hash inventée.
- Disque plein, retrait disque, permissions, renommage final impossible, exFAT/FAT32 si retenus, noms réservés Windows et chemins Unicode/longs : erreurs compréhensibles, confinement dans destination autorisée.
- Fermeture/recréation de fenêtre macOS, arrêt de l'application pendant copie, redémarrage : comportement défini. La reprise persistante n'est pas acquise ; si retenue, concevoir son journal et tester crash/récupération avant annonce.
- Rapport de lot : comptes et octets réellement transférés distincts des fichiers ignorés, phases et durée, annulation neutre, checksum avec portée exacte ; export sans secret.
- UI : parcours et critères du [plan de refonte](UI_REDESIGN_PLAN.md), changement rapide d'appareil, données longues, focus clavier, progression indéterminée et charge de grandes listes.

## Distribution, qualité et critères de bascule

Prévoir CI macOS et Windows : lockfiles vérifiés, format/lint/tests Rust, tests UI et build de chaque cible native. Le packaging est validé séparément de la compilation. Les tests DOM en navigateur ne sont pas présentés comme des tests de WebView macOS.

Avant une préversion : vérifier coexistence des applications, destinations de test dédiées, noms/versions explicites, licence HMP et attributions. Avant release : banc matériel legacy et récent réussi, sorties sans erreur inexpliquée, installateurs sur machines propres, signatures/distribution décidées, procédure de retour à V1 documentée.

Une bascule nécessite validation utilisateur sur un rapport de qualification indiquant OS, architecture, modèle, firmware, médias, volumes, commit et résultats. Aucun gain RAM/débit n'est accepté sans mesures comparables. La vulnérabilité npm V1 doit être triée avant sa prochaine redistribution même si V2 est en cours ; cela sera une PR de maintenance distincte.

## Décisions nécessitant validation utilisateur

| Décision | Recommandation à valider | Effet sur périmètre |
| --- | --- | --- |
| Architecture | Tauri 2 + moteur Rust indépendant + React/TS | Accepte une UI web ; egui si exigence tout Rust |
| Début du développement | Autoriser d'abord le lot 1 | Aucun développement majeur avant cet accord |
| Référence graphique | Confirmer la copie RWA 0.8.1 ou fournir une révision canonique | Fige les tokens, navigation et métriques ; captures à récupérer |
| Matériel / OS | Studio Mini 2017 obligatoire + modèle récent ; définir versions minimales macOS/Windows et architectures | Conditionne le banc et le packaging |
| Intégrité / doublons | Conserver MD5/SHA-256 ; libellés honnêtes, partiels et collisions sécurisés | Valider l'évolution des cas same-size et overwrite actuellement ambigus |
| Rapports / persistance | Rapport JSON versionné ; reprise après crash hors premier périmètre sauf demande | Évite d'annoncer une reprise absente de V1 |
| Distribution | Installer Windows + bundle/DMG macOS ; portable à confirmer | Comptes/certificats et stratégie WebView2 nécessaires |
| Actifs et licences | Garder les quatre PNG ; retrouver l'image exacte 2017 et confirmer droits HMP/RWA | Conditionne la redistribution des ressources |
| Ergonomie | Shell RWA et espaces Médias / Transferts / Rapports / Paramètres | Validation d'une planche de composants avant construction complète |

Les choix ordinaires d'implémentation au sein d'un lot autorisé restent autonomes. Toute extension métier, upload, contrôle transport ou mélange avec les fonctionnalités RWA reste hors périmètre.

## Résultats du lot 1 et ajustement des jalons

Les [contrats V1](V1_BEHAVIOR_CONTRACT.md), [matrice FTP](FTP_LEGACY_TEST_MATRIX.md), [exigences de sécurité](TRANSFER_SAFETY_SPEC.md), [contrats de domaine Rust](RUST_DOMAIN_CONTRACTS.md) et [rapport de validation](LOT1_VALIDATION_REPORT.md) remplacent les suppositions par un corpus reproductible. Le smoke a un profil isolé ; les tests V1 reproduisent des collisions, same-size skip, annulation hash non terminale et absence de contrôle de taille au niveau queue. Ces défauts doivent devenir des critères inversés explicites dans les tests du futur moteur.

Le lot 1 a livré la caractérisation automatisée sans matériel. La capture/qualification du **Studio Mini 2017**, d'un modèle récent et de plusieurs appareils physiques reste un jalon ouvert, repris au lot FTP ; elle n'est pas déclarée réalisée. Le cœur Rust avec ports/doubles peut démarrer au lot 2 après accord, mais aucun adaptateur ne pourra être déclaré compatible legacy sans cette preuve.

Les décisions architecture/RWA/plateformes/début lot 1 de la table ci-dessus sont désormais acquises. Les versions minimales OS, architectures distribuées, formats portable/installeur, licences/actifs et reprise durable restent à préciser. Les garanties de sécurité décrites dans le lot 1 sont des exigences de conception, pas des correctifs V1 déjà appliqués. La charge globale n'est pas re-chiffrée sur la base de tests synthétiques seuls.
