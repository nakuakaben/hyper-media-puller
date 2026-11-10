# Plan de refonte UI HMP V2

10 novembre 2026 — étude de sources et proposition, sans écran V2 implémenté. La refonte intégrale est autorisée par la mission ; la migration et l'implémentation attendent validation.

## Référence réelle et traçabilité

Référence disponible en lecture seule : copie locale `resolve-workflow-assistant-main`, package `resolve-workflow-assistant` **0.8.1**. Fichiers lus : `docs/design-system.md`, `src/ui-contract/ui.tokens.css`, `ui.components.css`, `ui.layout.css`, `src/style.css`, `src/main.ts`, `LICENSE`. Cette copie ne contient pas de `.git` : aucun commit distant ni caractère « dernière version publiée » n'est revendiqué. Confirmer la révision approuvée avant extraction des composants.

Empreintes SHA-256 de la référence observée (chemins relatifs au dépôt RWA) :

| Source | SHA-256 |
| --- | --- |
| `docs/design-system.md` | `e2aad56b30fa4e544aa031b983e4aac583e49a9a391444f5ce6ada36da61563c` |
| `src/ui-contract/ui.tokens.css` | `770a8d4ae3fff8ba02f6c49845d14eb551e3cb01f3823ac2c768986d40fc3a87` |
| `src/ui-contract/ui.components.css` | `81cae81f92cfe9d2248ff670de5048865adfe0f11810560d2b67f927d03c19d7` |
| `src/ui-contract/ui.layout.css` | `6bf87a9822102b5f111f1431df419f0d69a6c01e645cbb68ff3f52ff98677aa3` |
| `src/style.css` | `9f6aede37c305efa931fa407bf683ea28e6cfdc86bfbdc069d1ff9ca98d370ec` |
| `src/main.ts` | `676786a1bfd383024ddc144532617e9a0dcbab3d5d3478a621d3c503f0e9aa45` |

Il s'agit d'une analyse de la charte et du code, pas d'un audit visuel sur application rendue. Aucune capture d'application ni conformité de contraste n'a été vérifiée dans cette mission. La maquette historique `design/hmp-ui-reference.png` ne sert pas de preuve de l'UI actuelle et n'est pas la référence V2.

## Inventaire graphique et système réutilisable

| Élément | Valeur / comportement réellement présent dans RWA | Application proposée à HMP |
| --- | --- | --- |
| Fond | `--ui-bg: #09090b` | Fond de fenêtre |
| Panneaux | `#18181b`, secondaire `#0f0f10` | Surfaces appareils / médias / queue |
| Bordure | `#27272a` et alpha blanc | Séparation discrète, sans effet néon |
| Texte | `#fafafa`, secondaire `#a1a1aa` | Nom média / métadonnées |
| Sélection | `--ui-selection: #1177d7` | Focus, onglet actif, sélection indépendante du statut |
| États | succès `#22c55e`, avertissement `#eab308`, erreur/run `#ef4444` | Vérifié, attention, échec ; toujours accompagnés de texte |
| Timecode | `#34d399` | Token réservé aux données temporelles éventuelles ; pas un nouveau lecteur vidéo |
| Typographie | Inter puis système ; JetBrains Mono/Fira Code puis monospace | UI dense et chiffres tabulaires, tailles/temps alignés ; aucune police téléchargée |
| Espacements | Multiples de 8 ; primitives avec padding 10/12 px | Grille de base 8, exceptions documentées pour contrôles compacts |
| Rayons | 3 / 4 / 6 px, pill 999 px | Contrôles / panneaux / badges |
| Boutons | Primaire blanc/noir 30 px, ghost 30 px ; icône 34 px | Action « Ajouter à la file » et outils secondaires |
| Champs | 34 px, fond noir alpha, bordure claire discrète | IP, chemins, options et filtres |
| Panneaux | Header 40 px, surface bordée, min-height 0 | Listes avec zone de défilement interne |
| Tables | En-tête sticky, séparateurs fins, métadonnées monospace | Médias et transferts avec colonnes alignées |
| Navigation effective | Bas de fenêtre : 44 px, icône + libellé, actif souligné ; état 28 px | Espaces Médias / Transferts / Rapports / Paramètres |
| Séparateurs | Trait 1 px dans prise 5 px, transparent au survol | Panneaux ajustables et limites persistées |
| Focus / sélection | Contour bleu explicite dans les règles finales de style.css | Utilisation clavier, indépendance sélection/succès |
| Scrollbars | Largeur stable, variation de couleur au survol/défilement | Éviter les déplacements de colonnes |

L'ordre de cascade compte : `ui.layout.css` contient une ancienne topbar 64 px et une grille bento, tandis que `style.css:1244+` définit le shell final en trois rangées `minmax(0,1fr) 44px 28px`. Reprendre la charte finale et les primitives utiles, pas copier aveuglément toute la feuille historique.

Extraire ultérieurement un petit paquet CSS local versionné avec tokens, contrôles, badges, panneaux et tables, puis composants HMP `RecorderList`, `MediaTable`, `TransferTable`, `StatusBadge`, `ProgressCell`, `SplitPane`, `BottomNavigation`. Ne pas créer de dépendance runtime entre les applications. Les icônes SVG graphiques réellement génériques peuvent être réutilisées après vérification ; les outils de montage RWA ne conviennent pas à l'offload. Préférer une convention d'icônes cohérente et nommée, sans importer sa logique métier.

La licence locale RWA est MIT ; conserver le texte de licence et l'attribution lors d'une copie substantielle. Les commentaires indiquent un UI Contract Pack fourni : vérifier la provenance et les droits des ressources amont/polices avant redistribution. Aucun fichier RWA n'est modifié ou copié dans l'application par cette PR.

## Lecture de l'UI HMP actuelle depuis les sources

`main.tsx` combine appareils, découverte, navigateur, destination, queue, logs et notes de version dans un composant principal. `styles.css` fixe une sidebar de 258 px, un panneau d'options de 312 px et une queue d'au moins 190 px / 29vh. Plusieurs zones défilent déjà ; aucun séparateur interactif de panneaux n'est implémenté. Les colonnes de queue sont nombreuses et les largeurs minimales peuvent contraindre les petites fenêtres : risque à vérifier visuellement, pas défaut mesuré ici.

La sélection est locale au recorder courant ; les connexions sont identifiées par recorder mais les listes et chemins sont un état unique. La queue est multi-recorders. La refonte doit rendre cette différence explicite et éviter qu'un changement d'appareil semble annuler les copies actives.

## Organisation HMP proposée

L'espace Médias conserve les appareils, la navigation et une file compacte visibles ensemble. La navigation basse change d'espace ; ouvrir Transferts agrandit la file, sans changer de moteur ni perdre une sélection. Rapports et Paramètres restent secondaires. La proposition de disposition est HMP ; seuls les styles et conventions viennent de RWA.

```text
┌────────────────┬─────────────────────────────┬──────────────────┐
│ HyperDeck      │ Appareil / statut FTP       │ Destination      │
│ Rechercher     ├─────────────────────────────┤ Options du lot   │
│ PNG + nom + IP │ / > volume > dossier        │ Résumé sélection │
│ statut textuel ├─────────────────────────────┤ Ajouter à la file│
│                │ Table médias / sélection    │                  │
├────────────────┴─────────────────────────────┴──────────────────┤
│ File compacte : recorder, fichier, phase, progression, actions  │
├────────────────────────────────────────────────────────────────┤
│ Médias       Transferts       Rapports       Paramètres    44px │
│ État global / erreurs / destination / version             28px │
└────────────────────────────────────────────────────────────────┘
```

Le schéma décrit l'organisation proposée, pas une capture. Panneaux gauche/centre/options séparés par prises verticales ; séparateur horizontal pour la file. Conserver des minimums de largeur lisibles et un bouton réinitialiser la disposition. À 1366×768, replier le panneau d'options dans un volet à la demande plutôt que comprimer chaque colonne ; cible à valider. À 1920×1080 et 2560×1440, exploiter l'espace par colonnes et lignes utiles, sans grossir les contrôles.

## Parcours et états détaillés

| Vue / élément | Proposition de comportement et informations |
| --- | --- |
| 1. HyperDeck détectés | Liste dense avec PNG original, nom, modèle, IP, état info/FTP ; recherche sur interface/CIDR, progression et annulation ; distinguer inconnu, FTP refusé, déjà ajouté et hors ligne |
| 2. Identification des modèles | Table de correspondance modèle → actif, libellé exact séparé de l'image ; aucun modèle 2017 assimilé visuellement sans avertissement à un HD Mini récent ; fallback générique sans image inventée |
| 3. Médias et volumes | Arborescence réelle ou breadcrumbs `/`, `/1`, `/2` seulement si retournés ; chemin manuel conservé ; erreur attachée au dossier, navigation et queue restent utilisables |
| 4. Sélection | Cases, tout sélectionner dans la liste et compteur fichiers/octets ; navigation clavier ; contexte par recorder/chemin ; sélection des dossiers explique l'expansion récursive au moment de l'ajout |
| 5. File | Colonnes appareil, fichier, destination, taille, phase, progression, débit/ETA, actions ; détail par ligne pour hashes et erreurs ; filtres par recorder/statut ; queue indépendante de l'appareil parcouru |
| 6. Progression | Barres et texte pour copie/vérification séparées ; taille inconnue indéterminée ; skipped distinct de transféré ; pause explique que les copies actives finissent ; annulation neutre, réessai manuel explicite |
| 7. Paramètres | Connexions, règles de destination, doublons, checksum, concurrence ; simulation sous section développeur avec badge global ; valeurs validées côté backend et résumé figé dans chaque lot |
| 8. Rapports | Nouvelle capacité à implémenter ultérieurement : résumé du lot, sources/destinations, tailles, résultat précis, hashes, erreurs et temps ; export JSON puis format humain à décider ; aucun « vérifié distant » sans preuve |
| 9. Version et notes | Version discrète dans la bande d'état, clic ouvre notes embarquées et informations de build ; pas d'updater ajouté implicitement |

États obligatoires du navigateur : aucun appareil, connexion en cours, scan en cours, prêt, vide, erreur FTP, volume indisponible. États d'un transfert : en attente, copie, vérification, terminé sans hash, vérifié flux/local, ignoré, annulé, erreur copie, erreur checksum. Les couleurs ne doivent jamais être l'unique différence ; libellé et icône portent la signification.

Les décisions de doublons doivent afficher la portée réelle : égalité de taille existante n'est pas une preuve de copie identique. Les fichiers partiels sont identifiés séparément. Les actions de suppression dans la liste d'appareils concernent uniquement la configuration locale. Aucune action de modification des médias source n'est introduite.

## Éléments disponibles et éléments encore à récupérer

| Élément | Disponible maintenant | Reste à confirmer/récupérer avant UI |
| --- | --- | --- |
| Charte et CSS RWA | Copie 0.8.1 et empreintes ci-dessus | Révision canonique approuvée, exports des primitives sans CSS métier |
| Navigation / splitters | Règles de style finales et implémentation TS consultables | Captures natives de la version approuvée aux résolutions cibles ; interactions clavier à caractériser |
| Typographie | Piles locales déclarées | Choix de fournir Inter/monospace avec licences ou d'accepter les replis système |
| Icônes HMP | Quatre PNG originaux et icônes de l'app | PNG exact Studio Mini 2017 s'il existe ailleurs ; droits d'usage |
| Boutons / tableaux / états | Primitives CSS existantes | Mapping HMP, contraste mesuré, focus et disabled validés en rendu |
| Progression | Tokens et conventions disponibles | Nouveau composant HMP copie/vérification ; ne pas reprendre une sémantique d'analyse RWA |
| Références visuelles | Sources réelles, ancienne maquette HMP identifiée | Captures du HMP Electron et de RWA réellement exécutés, sans médias sensibles |

Aucune fonctionnalité de Resolve, montage, dérushage, IA, OSC, timeline ou couleur de clips n'entre dans HMP. La nav HMP et les rapports sont des propositions propres à l'offload.

## Critères de validation future

Vérifier sur application rendue : fenêtres 1366×768, 1920×1080, 2560×1440 ; échelles Windows 100/150/200 %, Retina macOS ; quatre appareils et listes/queues longues ; noms/chemins longs, Unicode, tailles inconnues et erreurs simultanées. Pas de scroll global inutile dans l'espace Médias, en-têtes et commandes accessibles ; scroll interne pour les données qui le nécessitent. Tester redimensionnement aux limites et persistance/réinitialisation de disposition.

Parcours clavier complet, focus visible, libellés des boutons icônes, checkbox indépendante du clic de ligne, sélection distincte des statuts. Mesurer les contrastes texte/contrôles et tester les lecteurs d'écran sur les plateformes retenues ; les seuls hexadécimaux ne constituent pas une validation d'accessibilité.

La première validation UI doit présenter une planche de composants et les états critiques avec données de test explicitement marquées, puis une capture native du parcours réel. Elle ne précède pas le feu vert sur l'architecture et ne remplace pas le banc FTP décrit dans la [roadmap](V2_MIGRATION_ROADMAP.md).
