# Qualification macOS HMP V2

## Qualification physique — Studio HD Plus

Premier offload fonctionnel observé sur la Preview macOS 0.1.0, lors du test utilisateur du 12 novembre 2026. Le recorder **HyperDeck Studio HD Plus** a été identifié, la session FTP anonyme s’est ouverte et le volume réel `/sd2` a été parcouru. La copie de `/sd2/HyperDeck_0003.mp4` s’est terminée en **10,2 s**. Le rapport affiche **101,1 Mio** attendus, reçus et écrits. La copie et la vérification sont à 100 %, avec un statut **Vérifié**. Le rapport JSON a été généré et l’utilisateur a confirmé la lecture de la copie téléchargée.

L’empreinte SHA-256 compare les octets du flux FTP reçu avec la relecture du fichier local. Le test ne fournit aucune empreinte calculée indépendamment par le recorder. La taille est celle affichée dans les captures, arrondie au dixième de Mio. Le firmware et le format du volume de destination du test terrain ne sont pas documentés. La portée de cette qualification est un seul média, depuis ce seul Studio HD Plus, dans ce parcours macOS.

### Preuves fournies et analyse

Les quatre captures originales jointes à la demande restent accessibles dans la conversation. Les références et empreintes ci-dessous permettent de les retrouver. Les originaux contiennent une adresse privée et un chemin personnel et restent hors dépôt.

| Étape et capture | Observation | Ajustement du lot 6 |
| --- | --- | --- |
| 1. Médias, `f7a93a9f` | Breadcrumb `/ › sd2`, liste réelle, contrôles de sélection, options, file compacte et résultat vérifié. Des dossiers d’indexation et les AppleDouble occupent le début de la table. La capture finale montre zéro sélection. | Filtre actif par défaut, compteur des entrées masquées, contrôle de diagnostic et exclusion de toute sélection groupée. Le modèle n’est affiché qu’une fois s’il correspond au nom du recorder. |
| 2. Transferts, `50def64b` | Une ligne sélectionnée, deux barres à 100 %, statut Vérifié, tailles et portée dans le détail. Le chemin absolu tronqué dans la table montrait essentiellement son préfixe. | La cellule montre le nom du fichier final. Le chemin complet reste accessible dans le détail et dans l’infobulle. |
| 3. Rapports, `12cc93be` | Rapport lisible, SHA-256 et compteurs, commande d’affichage JSON. Les paramètres affichaient les valeurs internes `rename` et `sha256`, avec un point décimal dans la durée. | Libellés identiques à ceux des Paramètres et durée au format français. Les valeurs JSON restent identiques. |
| 4. Paramètres, `a0f01aba` | Destination avec espace, politique Renommer, SHA-256, concurrence globale à deux et limite à un par appareil, profil V2 séparé. | Ces contrôles et la disposition sont conservés. Les limites configurées n’établissent pas que plusieurs transferts physiques ont été essayés. |

```text
01  14368aba6ab83ef7f4156329dd086903a1abdb04997aa6bde587c836ee87aac2
02  485c494593520fbc65abeb063c3225fc314e984434ee717de149926d18dc0d0a
03  4d6d4069397c65e19399e9e86009e4fe2c81692b31bc29f41491fce4139ef4f3
04  fda6521c1f9c7bd66903dfb00e5863683bb1e9a0b0159eaeb8a2baf5db5f0d48
```

Les panneaux, le contraste des états, les barres distinctes et la navigation basse suivent la charte RWA 0.8.1 existante. Les captures statiques permettent d’observer ces états et les troncatures. Les interactions clavier, la progression en cours et les erreurs ont fait l’objet de vérifications synthétiques distinctes. [Rapport des essais du lot 6](LOT6_VALIDATION_REPORT.md)

## Mode diagnostic

Dans Médias, **Afficher les fichiers système** rend visibles les entrées d’indexation et de corbeille connues, les métadonnées AppleDouble `._*` et leur contenu. Le mode est désactivé au démarrage. Les entrées de diagnostic restent consultables et sans case de sélection. Le bridge rejette également leur ajout explicite à un lot. Désactiver l’option depuis un dossier système ramène au plus proche dossier visible. Les listings et la navigation FTP restent en lecture seule. Le filtre ne change ni les entrées retournées par le serveur, ni les médias source.

## Suite de la qualification physique

Reprendre sur le Studio HD Plus avec un volume APFS dédié, plusieurs médias dont un de plus de 4 Gio, puis un second recorder pour un essai simultané. Tester la veille et le réveil dans un créneau prévu, hors enregistrement, ainsi que SMB sur un partage de test. Le Studio Mini 2017 et les autres modèles restent à qualifier séparément.
