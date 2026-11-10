# Corpus et matrice FTP legacy — lot 1

10 novembre 2026. Référence HMP 1.1.0 à `8881ec3`. Les données de `tests/fixtures/` sont **synthétiques**, dérivées des branches du code V1 ; aucun dialogue ne provient d'un HyperDeck physique. Les adresses des fixtures utilisent TEST-NET ; les connexions réelles des tests restent sur `127.0.0.1` et des ports éphémères.

## Exécution et niveaux de preuve

```sh
npm ci
npm run build:app
npm run test:ftp-paths
npm run test:characterization
```

Node 24 LTS. Le test runner compile le main puis charge ses exports CommonJS inchangés. `helpers.mjs` remplace explicitement Electron/logger et les frontières injectées ; il ne réécrit pas les fonctions testées. Les scénarios réseau injectent les sockets et l'inventaire OS, donc ne sondent aucun appareil. Les tests WIRE utilisent le vrai basic-ftp verrouillé et les vrais streams/disques temporaires. Le runner échoue si les ports loopback sont interdits : aucun skip silencieux.

Le serveur `ftp-server.mjs` est minimal, en lecture seule, ferme sockets/listeners après test et refuse les commandes non prises en charge. Ce n'est pas un émulateur de firmware. `ftp-legacy.json` fournit scénarios et listings POSIX/DOS ; `v1-paths.json` fournit entrées et résultats V1, y compris défauts connus. Les mots de passe non anonymes des tests portent explicitement le nom synthetic ; aucun secret utilisateur.

## Matrice exécutée

Tous les identifiants ci-dessous ont passé sur macOS ARM64 dans cette mission ; portée limitée au mode de test précisé.

| ID | Entrée / panne | Résultat V1 attendu et observé | Frontière / limite |
| --- | --- | --- | --- |
| PATH-01…07 | Vide, /, 1, /1, préfixe modèle, /2, URL FTP | Chemins `/`, `/1`, `/2` normalisés | Fonction réelle ; sept cas historiques également exécutés |
| PATH-08…11/18 | Antislashs, slashs, espaces, null, .., Unicode | .. brut rejeté ; Unicode/espaces conservés | Fonction réelle ; pas de nom envoyé au matériel |
| PATH-12/13 | `take#01.mov`, `take?01.mov` | Tronqués à take : défaut V1 figé | Ne pas conserver ce défaut en V2 |
| PATH-14/15/19 | Parent dans URL, ., encodage % | Parent résolu par URL avant validation ; . et pourcentages conservés | Différence saisie URL / chemin brut à spécifier |
| PATH-16/17 | CON.mov, saut de ligne | Acceptés par path-utils | Ni validité Windows ni acceptation du client FTP prouvées |
| AUTH-01 | Anonymous, PASS vide | Succès sans fallback | Client injecté |
| AUTH-02 | 530 sur vide | Nouvelle session avec anonymous@hmp.local | Client injecté ; également WIRE-01 |
| AUTH-03 | 501 puis 530 | Séquence vide → anonymous@hmp.local → guest@ | Client injecté |
| AUTH-04/05 | Mot de passe explicite / utilisateur non anonymous, 530 | Aucune tentative alternative | Client injecté, valeurs synthétiques |
| AUTH-06/07 | ECONNRESET / trois refus 530 | Arrêt immédiat / échec après troisième tentative ; tous clients fermés | Panne injectée, pas de session firmware |
| LIST-01/05 | Échec racine 501 ou 550 | Retry listing sans argument à la racine | Client injecté |
| LIST-02 | 501 sur /1 | CWD /1 puis list sans argument | Client injecté ; commandes réelles WIRE-01 |
| LIST-03/04 | /2 normal / sous-dossier 550 | Listing réel / erreur propagée sans fallback CWD | Client injecté |
| LIST-06 | Arbre / → /1 → clip | Expansion fichiers seuls ; UUID différent au second scan | Client injecté |
| WIRE-01 | Login fallback, EPSV refusé, PASV, LIST -a /1 et LIST /1 refusés 501 | CWD /1 puis LIST sans argument ; les deux seuls dossiers retournés sont exposés | TCP loopback + vrai basic-ftp |
| WIRE-02 | Racine avec médias Unicode et zéro octet, aucun volume | Pas d'injection de /1 ou /2 ; noms et tailles conservés | TCP loopback + parseur POSIX réel |
| WIRE-03 | Listing DOS sur /2 | `/2/clip.mov`, taille 4 | Parseur DOS réel, une fixture seulement |
| WIRE-04 | RETR média synthétique, mode both | Fichier identique et MD5/SHA-256 du flux corrects ; progression reçue | Vrais sockets/streams, petit média |
| WIRE-05 | Données PART puis réponse 426 | Rejet ; partiel non vide laissé au nom final | Panne protocolaire synthétique reproductible |
| WIRE-06 | Serveur silencieux avant greeting ; timeout 50 ms | Timeout, aucun PASS ni fallback login | Timeout réel loopback, pas celui d'un LAN chargé |
| WIRE-07 | RETR maintenu ouvert, deux octets puis cancel | Fermeture client/rejet et partiel PA | Annulation du vrai downloadFile ; pas du hash |
| WIRE-08 | Fermeture contrôle après données, sans 226 | Rejet malgré octets reçus ; partiel PART | Déconnexion TCP réelle du serveur synthétique |

## Séquences de référence dérivées des tests

Login legacy : nouvelle connexion par tentative, `OPTS UTF8 ON`, `USER anonymous`, `PASS <vide>` → 530 ; nouvelle connexion → PASS anonymous@hmp.local. Puis initialisation basic-ftp : FEAT, TYPE I, STRU F et OPTS UTF8 ON. HMP réimpose ensuite les candidats LIST -a / LIST, même si le client a découvert d'autres capacités.

Listing legacy de WIRE-01 : EPSV → 502, PASV → 227 ; LIST -a /1 → 501 ; PASV puis LIST /1 → 501 ; HMP fait CWD /1 ; nouveau listing avec candidats réinitialisés, LIST -a → 501 puis LIST → 150/données/226. Le test vérifie les commandes critiques et leur résultat, pas une transcription matérielle complète ni tous les détails d'ordre de contrôle.

Dans basic-ftp installé, la méthode de transfert essaie EPSV puis PASV et retient une stratégie compatible. `availableListCommands` retient le premier candidat réussi. Pour un téléchargement vers chemin, une erreur peut supprimer un fichier vide créé par le client, mais un partiel non vide reste ; HMP n'ajoute aucune finalisation temporaire. Ces détails affinent l'audit initial, qui n'avait pas exécuté le protocole. Leur validité est liée au lockfile, pas à tous les clients FTP futurs.

## Matériel et qualification encore nécessaires

| ID | Scénario futur | Données à relever / critère |
| --- | --- | --- |
| HW-01 | HyperDeck Studio Mini **2017** | Modèle exact, firmware/protocole, versions OS, racine et vrais volumes, ordre login/listing ; offload d'un média stable |
| HW-02 | Modèle récent puis deux recorders ensemble | Résultats de découverte, FTP et concurrence V1 ; comparer au futur adaptateur Rust |
| HW-03 | Cartes/volumes absents ou retirés, médias en évolution | Pas de volume fictif, erreur par job, aucun statut terminé pour un incomplet ; ne pas manipuler un média de production |
| HW-04 | LAN multicarte, déconnexion/réapparition, pare-feu | Route/bind, timeouts et ajout manuel ; aucune commande transport |
| HW-05 | Gros média >4 Gio et lot long | Taille locale, durée, débit, mémoire, hashes flux/local ; source indépendante si disponible |
| HW-06 | Noms représentatifs réellement supportés | Encodage ancien, accents, espaces, caractères réservés ; comparaison du nom affiché et du chemin RETR |
| HW-07 | Transfert arrêté / disque externe retiré | Partiels et erreurs ; à faire sur supports/médias de test dédiés |

Procédure : utiliser une destination temporaire vide et une configuration dédiée, sélectionner explicitement les appareils de test, ne jamais lancer upload/DELE/RNFR/RNTO ni REC/STOP/FORMAT/REBOOT. Capturer les dialogues avec les mots de passe supprimés et les IP remplacées par TEST-NET, conserver les octets de noms utiles après consentement et anonymisation. Noter ce qui est observé et ce qui est attendu séparément ; une fixture ne devient « capture matérielle » qu'avec provenance documentée.

Aucun HyperDeck physique n'a été sollicité dans ce lot ; le smoke de session a volontairement ignoré son ancien sondage LAN. La compatibilité **2017 reste obligatoire mais non validée sur matériel**. Les fixtures du lot 1 sont prêtes à être enrichies, pas une raison de supprimer les fallbacks.
