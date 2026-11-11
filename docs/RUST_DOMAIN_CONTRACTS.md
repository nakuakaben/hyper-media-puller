# Contrats de domaine Rust — proposition lot 1

10 novembre 2026. Décisions validées : Tauri 2 + Rust + React/TypeScript/Vite ; moteur indépendant de Tauri ; macOS/Windows ; lecture seulement. **Aucun moteur Rust ni crate n'est créé ici.** Les signatures ci-dessous sont un contrat de conception, à compiler/tester au lot 2 après validation.

## Responsabilités et identités

| Type | Champs et invariants proposés | Correspondance / différence V1 |
| --- | --- | --- |
| `RecorderId` | UUID opaque persistant, sérialisation string ; jamais dérivé du nom ou de l'IP | Reprend l'identité de configuration, pas le host utilisé pour alreadyAdded |
| `Recorder` | id, nom, modèle déclaré/détecté, endpoint host/port, référence de credential ; capacités observées/legacy | Sépare secret et DTO UI ; changer IP ne crée pas un nouveau recorder |
| `RemotePath` | Chemin absolu FTP utilisant `/`, validé à la construction ; root dédié ; aucune conversion via PathBuf | Préserve /, /1, /2 réels ; aucun volume fictif ni troncature de #/? |
| `MediaEntry` | recorderId + remotePath, type File/Directory, taille Option<u64>, modifiedAt Option, nom d'affichage, génération listing | UUID V1 instable remplacé par clé logique stable ; la clé n'est pas une identité de contenu |
| `TransferJob` | JobId UUID, BatchId, source figée, destination planifiée, politique/checksum, AttemptId, état/résultat | Un nouvel ajout du même média crée un nouveau job ; retry même JobId, nouvel AttemptId |
| `TransferBatch` | BatchId UUID, jobs, options immuables, créé à, contrôle des départs | Entité absente de V1 ; settings ultérieurs n'altèrent pas le lot |
| `TransferStatus` | Pending, Running, Verifying, Finalizing, Done, Verified, Skipped, Error, ChecksumError, Cancelled | Finalizing rend explicite la publication du fichier ; pause reste un contrôle de lot |
| `TransferProgress` | jobId/attemptId, séquence, phase, octets reçus/écrits/vérifiés, total Option<u64>, débit/ETA Option | Ne pas forcer transferred à expected ; skipped n'ajoute pas d'octets réseau |
| `TransferError` | code, phase, retryable, contexte source/destination, code FTP/OS optionnel, message opérateur, détails expurgés | Remplace les chaînes d'erreur seules ; raw credential interdit |
| `ChecksumResult` | mode, digests, scope, résultat comparaison, octets couverts | Distingue hash local seul, comparaison flux/local et éventuelle comparaison distante |

RecorderId + RemotePath identifie un emplacement, **pas la permanence d'un média**. Taille/date avant copie forment un fingerprint faible, utilisé pour détecter une évolution, jamais pour prouver l'identité. Pas de hash distant inventé si le serveur n'en fournit pas. Un nom d'appareil/chemin d'affichage ne sert jamais à reconstruire une identité.

`RemotePath::parse_input_url` est distinct de `RemotePath::from_ftp_path`. La première voie extrait explicitement une URL saisie ; la seconde préserve les caractères de noms retournés par FTP. Définir l'encodage au niveau adaptateur et conserver l'information brute nécessaire si les anciens serveurs ne sont pas UTF-8. Refuser CR/LF/NUL et les segments de traversal ; ne pas résoudre silencieusement un parent via un parseur d'URL avant validation. Les règles de mapping Windows appartiennent au port destination, pas à RemotePath.

## Schéma indicatif, sans dépendance UI

```rust
// Pseudocode de contrat, pas une API déjà compilée.
struct RecorderId(Uuid);
struct RemotePath(String); // champ privé ; constructeurs validants
struct MediaKey { recorder: RecorderId, path: RemotePath }
struct SourceDescriptor {
    key: MediaKey,
    expected_size: Option<u64>,
    modified_at: Option<Timestamp>,
}
struct TransferBatch {
    id: BatchId,
    options: BatchOptions,
    jobs: Vec<JobId>,
    control: BatchControl, // Ready, Running, Paused, Cancelling, Settled
}
struct TransferJob {
    id: JobId,
    batch: BatchId,
    source: SourceDescriptor,
    destination: DestinationPlan,
    attempt: AttemptId,
    status: TransferStatus,
    progress: TransferProgress,
    result: Option<TransferResult>,
}
enum VerificationScope {
    LocalOnly,
    TransferStreamComparedToLocal,
    IndependentRemoteComparedToLocal, // uniquement si capacité réelle éprouvée
}
struct ChecksumResult {
    mode: ChecksumMode,
    digests: Vec<DigestComparison>, // algorithm, actual, expected?, matched?
    scope: VerificationScope,
    bytes_covered: u64,
}
```

Le moteur possède les structures et leurs validations ; les DTO UI sont une projection versionnée sans secrets ni handles. `u64` côté Rust ; sur la frontière JS, encoder les compteurs en chaînes décimales ou garantir une plage sûre explicitement. Ne pas utiliser f64 pour des tailles de fichiers dans le domaine. Timestamps UTC, durée monotone pour débits/ETA ; date de dossier local/UTC à choisir explicitement avant compatibilité stricte V1.

## États et transitions autorisées

| Origine | Commande / événement autorisé | Destination |
| --- | --- | --- |
| Pending | Destination ignorée selon politique explicite | Skipped (raison ExistingUnverified) |
| Pending | Créneau + destination réservée + début tentative | Running |
| Pending | Cancel accepté | Cancelled |
| Running | FTP fini + taille conforme, checksum activé | Verifying |
| Running | FTP fini + taille conforme, sans checksum | Finalizing |
| Running | Connexion/lecture/écriture échoue | Error |
| Running / Verifying / Finalizing avant commit | Cancel accepté | Cancelled, jamais finalisé |
| Verifying | Digests comparables et identiques | Finalizing |
| Verifying | Mismatch ou échec de relecture | ChecksumError |
| Finalizing | Publication atomique réussie, sans checksum | Done |
| Finalizing | Publication réussie après comparaison flux/local | Verified avec scope explicite |
| Finalizing | Échec disque/rename/sync | Error |
| Error / ChecksumError / Cancelled | Retry manuel, nouvelle tentative et réservation | Pending |
| Done / Verified / Skipped | Cancel ou retry de même tentative | AlreadyTerminal ; nouvelle copie = nouveau job |

Un hash LocalOnly ne suffit pas à passer Verified : son résultat peut accompagner Done avec la portée LocalOnly. La variante indépendante distante ne doit pas être activée dans la première implémentation sans source réelle d'empreinte. Les réponses tardives avec mauvais AttemptId sont ignorées et diagnostiquées, jamais appliquées.

Finalizing possède un point de commit sérialisé. Cancel accepté avant ce point empêche la publication ; reçu après, retourne AlreadyTerminal. Un arrêt du processus au milieu impose une politique de récupération distincte ; la table ne prétend pas rendre un événement mémoire durable.

## Erreurs et réessai

Codes minimums : InvalidPath, InvalidSettings, RecorderMissing, Authentication, ConnectionRefused, Timeout, ConnectionLost, ListingUnsupported, RemoteUnavailable, SourceChanged, DestinationConflict, PermissionDenied, DestinationFull, LocalIo, SizeMismatch, ChecksumMismatch, VerificationReadFailed, FinalizationFailed. Cancelled est une issue opérateur distincte, pas une panne rouge.

`TransferError` indique phase et origine ; préserver le code FTP 501/530/550 pour les stratégies legacy. Retryable est une information pour la commande de relance manuelle, pas une autorisation d'auto-retry. Les erreurs d'un job ne stoppent pas les autres recorders. Les secrets sont détenus par l'adaptateur credentials et ne sont pas copiés dans les événements ni les rapports.

## Interfaces réseau et disque testables sans Tauri

Ports conceptuels async, sans imposer ici une syntaxe dyn/async-trait ou une bibliothèque FTP :

| Port | Opérations et résultat | Garanties / doubles de test |
| --- | --- | --- |
| `DiscoveryPort` | interfaces(), search(scope,cancel,eventSink) | Scope explicite et borné, aucune commande transport ; sockets synthétiques et bannière fragmentée |
| `RemoteReadPort` | connect(endpoint,credential,cancel) → session | Chaque tentative login legacy possède sa session, codes d'erreur structurés |
| `RemoteReadSession` | list(RemotePath,cancel), open_read(path,cancel), close() | Lecture seulement ; listing réel ; aucune commande arbitraire exposée au domaine |
| `RemoteReader` | read_chunk(buffer,cancel), finish(), close() | EOF données et succès FTP final séparés ; compteurs réels et fermeture idempotente |
| `DestinationPort` | resolve_and_reserve(plan), create_partial(reservation,attempt), open_readback(partial), commit(reservation,partial,policy), abort(partial) | Confinement et exclusivité ; jamais de suppression d'un préexistant ; doubles ENOSPC/rename/permissions |
| `LocalWriter` | write_all, flush, sync/close | Retourne les erreurs ; buffers bornés ; annulation contrôlée |
| `SettingsPort` | load/save versionnés, lookup credential reference | Profil V2 distinct, import V1 explicite en lecture seule |
| `EventSink` / `Clock` / `IdSource` | publish événements, instant monotone/date, nouveaux IDs | Buffers bornés, horloge/IDs déterministes pour tests |

`TransferEngine` expose enqueueBatch, startBatch, pauseBatch, cancelJob, retryJob, snapshot, subscribe et shutdown. Il reçoit les ports au constructeur ; aucun AppHandle, WebView, commande shell ou boîte de dialogue. Le bridge Tauri futur valide ses DTO et traduit ces commandes, sans déplacer le métier dans le frontend.

Concurrence : un ordonnanceur autorité des états, plafond global et par RecorderId, budget de vérification séparé, réservations destination atomiques. La pause ne tue pas les actifs. Arrêt contrôlé stoppe départs et libère les I/O ; reprises durables/REST hors premier périmètre tant qu'elles ne sont pas conçues et validées.

## Événements et snapshots

Enveloppe `{schemaVersion,sequence,batchId?,jobId?,attemptId?,timestamp,payload}` ; événements BatchCreated, JobQueued, JobStarted, ProgressChanged, VerificationStarted, JobSettled, BatchControlChanged, BatchSettled et DiscoveryProgress. Aucune donnée média ni credential dans IPC. Événements de progression agrégés, états terminaux immédiats ; abonnement avec snapshot initial + watermark pour éviter les trous et doublons. Les digests ont leur algorithme et scope ; une UI ne déduit pas la vérification depuis une couleur.

## Premier périmètre du lot 2 recommandé

Implémenter les types validants, la machine à états, l'ordonnanceur et les ports avec doubles déterministes. Adapter les attentes V1 de ce corpus, en inversant explicitement les tests de défauts listés dans SAFE-01…12. Aucun Tauri nécessaire pour ces tests. L'adaptateur FTP réel reste le lot suivant, avec comparaison au corpus puis qualification matérielle Studio Mini 2017.
