# Sécurité des transferts — exigences V2

10 novembre 2026. **Spécification pour le futur moteur**, aucune correction du moteur Electron dans ce lot. Les tests V1 caractérisent parfois un défaut ; les critères ci-dessous sont ceux à implémenter et tester en Rust après validation du lot 2.

## Invariants

1. Lecture seulement sur les HyperDeck. Aucune capacité upload, suppression, renommage distant, transport, formatage ou reboot dans les ports du moteur ni dans ses commandes publiques.
2. Un fichier partiel ne devient jamais un résultat terminé. `done` exige fin FTP valide et taille conforme si connue. `verified` exige en plus la vérification explicitement décrite ; aucun saut fondé sur le nom ou la seule taille.
3. Une destination existante ne peut pas être remplacée à cause d'une course ou d'une panne. Chaque chemin final est réservé avant l'écriture et la politique de collision est figée dans le lot.
4. Égalité de taille = information, pas identité de contenu. Une copie ignorée reste « existante, non vérifiée » ; un hash local seul reste un hash local.
5. Copie et relecture restent annulables. Un résultat terminal accepté par l'ordonnanceur ne peut pas être modifié par un callback tardif d'une ancienne tentative.

## Risques V1 et réponses V2 exigées

| ID sécurité | Preuve lot 1 | Comportement V1 | Exigence V2 / test d'acceptation futur |
| --- | --- | --- | --- |
| SAFE-01 Partiel | WIRE-05/07/08, QUEUE-03 | Fichier non vide au nom final après 426, fermeture ou annulation | Ouvrir un temporaire exclusif propre à job/attempt sur le volume cible ; le nom final reste absent ou inchangé tant que non finalisé |
| SAFE-02 Collision | DEST-01, QUEUE-05 | Basenames identiques ; deux jobs peuvent recevoir le même chemin | Réserver le nom final selon les règles réelles du filesystem (casse/Unicode) et créer exclusivement ; deux writers ne partagent jamais un descripteur/nom de sortie |
| SAFE-03 Same-size | DUP-SAME-* | Taille égale ignorée même avec overwrite | Ne jamais marquer verified ; appliquer une politique explicite et reporter skip existant non vérifié, ou vérifier/re-copier selon choix utilisateur |
| SAFE-04 Politique figée | QUEUE-04 | Politique fournie à enqueue ignorée | Capturer destination/duplication/checksum dans TransferBatch immuable ; modifier les settings n'affecte pas les lots déjà créés |
| SAFE-05 Interruption | WIRE-05/08, ERROR-ECONNRESET | Rejet/état error avec partiel restant | Classer erreur, conserver partiel identifiable, libérer sockets et réservation ; autre recorder continue ; réessai manuel nouvelle tentative |
| SAFE-06 Disque plein | ERROR-ENOSPC injecté | Error ; partiel au nom final | Toute erreur d'ouverture/écriture/flush/sync/finalisation interdit done ; original inchangé ; cause destination-full lisible |
| SAFE-07 Annulation hash | HASH-CANCEL | cancelled peut être écrasé par verified | Token vérifié à chaque boucle de lecture et avant publication ; génération/attemptId et transition terminale sérialisée |
| SAFE-08 Erreur checksum | HASH-MISMATCH / HASH-READ-ERROR | checksum-error | Aucune finalisation de sortie sous statut vérifié ; partiel/quarantaine distinct, erreur et hashes attendus/calculés identifiés |
| SAFE-09 Portée hash | HASH-NO-EXPECTED, HASH-* | verified même sans hash de flux attendu | Résultat typé LocalOnly / ComparedWithTransfer ; aucune comparaison distante annoncée sans empreinte indépendante |
| SAFE-10 Taille | SIZE-MISMATCH, adaptateur injecté | Peut forcer le compteur à la taille attendue sans contrôle local | Comparer octets reçus, écrits et taille annoncée si stable/connue ; mismatch interdit succès et garde les compteurs réels |
| SAFE-11 Noms | PATH-12…19, lecture | Troncature #/?, contrôles non refusés, noms Windows non traités | Séparer parsing URL/chemin brut ; valider CR/LF/NUL, segments et chemin local, mapper les caractères incompatibles avec un nom réversible documenté |
| SAFE-12 Fermeture/crash | QUEUE-06 + lecture, pas de kill réel testé | Queue en mémoire ; flux/process arrêté sans protocole de reprise | Arrêt contrôlé annule/drain selon politique, aucune finalisation tardive ; crash laisse un partiel explicitement identifiable, jamais auto-considéré terminé |

## Protocole d'écriture et finalisation

1. Valider la source (identité recorder, chemin FTP brut, métadonnées de listing) et la destination sélectionnée. Refuser les chemins hors racine autorisée et les escapes via liens symboliques/reparse points. Traiter séparément chemins distants et locaux.
2. Résoudre la politique de doublon et réserver la destination avec une clé adaptée au volume, pas seulement une comparaison textuelle sensible à la casse. Le temporaire doit être créé avec exclusivité, par exemple `.hmp-<job>-<attempt>.part`, dans le même répertoire/volume ; ne pas le réutiliser aveuglément.
3. Ouvrir une lecture FTP et transférer en buffers bornés, en comptant les octets réellement reçus/écrits et en calculant les hashes choisis. Contrôler l'annulation entre les I/O. Vérifier la réponse finale FTP après EOF ; données reçues sans 226 valide ne suffisent pas.
4. Fermer/flush le writer et vérifier les erreurs. Valider la taille connue, l'éventuelle évolution de la source et le hash flux/local si demandé. Une source qui change pendant la copie doit être signalée ; les métadonnées FTP ne sont pas une garantie cryptographique.
5. Après la dernière vérification d'annulation, finaliser sous le contrôle de l'ordonnanceur. Utiliser une opération atomique adaptée à l'OS et à la politique, **sans overwrite implicite**. Ne pas faire `exists()` puis écriture sans réservation. Le comportement no-replace et replace doit être testé séparément sur Windows/macOS et volumes retenus.
6. Publier un résultat terminal seulement après succès de la finalisation et des opérations de durabilité retenues. Conserver le hash, la portée de vérification, les octets réels et le chemin final dans un résultat immuable. Les garanties en cas de coupure électrique nécessitent qualification du filesystem et des sync ; elles ne sont pas supposées par un simple rename.

Pour overwrite explicite : le fichier existant reste intact pendant copie/vérification. Une erreur ne doit pas supprimer l'original pour libérer le nom. Remplacement atomique avec les garanties disponibles ou erreur explicite si cette garantie ne peut être tenue ; aucune stratégie destructive de repli silencieuse.

## Doublons et partiels

Politique initiale proposée : rename pour les collisions, skip possible mais libellé « existant non vérifié », overwrite explicite. La règle V1 « même taille ignore avant toute politique » ne doit pas prévaloir sur une demande explicite d'overwrite. Une politique ask, si ajoutée, doit suspendre le job en attente d'une décision représentée dans le domaine ; pas de dialogue depuis le moteur. Cette capacité reste hors première API tant que son UX n'est pas validée.

Un partiel contient son jobId/attemptId dans le nom ou un manifeste associé. Après erreur/annulation, le garder pour diagnostic ou proposer un nettoyage local contrôlé ; ne jamais supprimer une destination antérieure au job. Le premier moteur peut recommencer de zéro avec un nouveau temporaire. REST/reprise après crash n'est pas une capacité validée : l'ajouter seulement avec contrôle d'identité source, offset, hashes et état durable. Un fichier `.part` découvert au lancement ne vaut jamais journal de copie complète.

## Annulation et concurrence

L'annulation vise une tentative. L'ordonnanceur est l'autorité unique des transitions ; tout événement inclut jobId/attemptId. Si l'annulation est acceptée avant commit final, l'issue sera cancelled et aucun final ne sera publié. Si le commit terminal est déjà acquis, l'annulation retourne AlreadyTerminal ; elle ne supprime pas un fichier terminé. Tester la course précisément à la frontière de finalisation.

Pause du lot = stop nouveaux départs, actifs laissés terminer, conformément à V1. Annulation = interruption des actifs et pending. Relance = tentative neuve avec compteur et token neufs, historique de la tentative précédente conservé. Annulation pendant connexion/listing/hash doit être testée ; ces phases ne doivent pas masquer un thread bloqué non interruptible.

Limiter la concurrence globale et réseau par appareil ; sémaphore disque/hash distinct. Le défaut initial peut rester deux transferts globaux / un transfert réseau par recorder. Une vérification locale n'utilise plus de socket FTP, mais peut saturer le disque : limiter son budget I/O indépendamment. Ne jamais compter un nom de recorder comme clé d'exclusion.

## Fermeture et rapports

Arrêt normal : refuser de nouveaux lots, accepter l'annulation/drain, attendre libération des writers/sockets, sauvegarder les seuls résultats durables et partiels connus si ce stockage est implémenté. Le lot 2 doit définir l'API shutdown sans supposer de fenêtre Tauri. Pas de dépendance à un callback de fermeture UI pour protéger le disque.

Rapport minimal : lot, job/tentative, recorder, chemin source brut, destination, taille attendue/observée, dates, politique, statut, hashes avec scope, erreur typée et éventuel partiel. Compter séparément copiés/vérifiés/ignorés/échoués/annulés. Ne pas stocker les identifiants FTP dans le rapport. Un log de console n'est pas un manifeste transactionnel.

## Limites de preuve actuelles

ENOSPC/EIO, concurrence queue et course hash ont été injectés à des frontières explicites. Le vrai FTP et l'écriture disque ont été exercés sur petits médias synthétiques en loopback. Ni disque réellement saturé/retiré, ni coupure électrique, ni kill processus en cours de copie, ni fichiers >4 Gio, ni comportement NTFS/exFAT n'ont été qualifiés. Cette spécification fixe les futurs tests, sans leur attribuer de résultat.
