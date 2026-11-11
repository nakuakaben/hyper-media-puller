# Adaptateur FTP Rust et découverte HyperDeck

Le lot 3 relie les ports de lecture du moteur Rust à de vraies sockets TCP. `FtpRemote` implémente `RemoteReadPort`. Une session fournit les listings et transfère la propriété de ses sockets au lecteur lors d’un `RETR`. Le moteur reçoit les octets par blocs puis utilise le même chemin de vérification et de publication que pour les transferts simulés.

## Choix du client FTP

L’API Tokio de SuppaFTP 12.2.1 propose `custom_data_command`, le choix EPSV/PASV et un `TransferStream` qui possède le transfert jusqu’à `finish()`. Elle permet donc d’exprimer `LIST -a`, une lecture en streaming et la vérification de la réponse finale. Son aide de lecture des listings convertit les octets en UTF-8 avec remplacement. Le lot retient un client Tokio spécialisé afin de définir directement la politique sur les noms, les limites de réponses, l’identité du pair passif et les conditions de fallback. Cette décision repose sur l’API publiée de SuppaFTP. Les tests d’intégration exercent le client HMP. [API SuppaFTP 12.2.1](https://docs.rs/suppaftp/12.2.1/suppaftp/tokio/struct.ImplAsyncFtpStream.html)

Le vocabulaire FTP de l’adaptateur comprend `USER`, `PASS`, `OPTS UTF8 ON`, `TYPE I`, `STRU F`, `EPSV`, `PASV`, `LIST`, `CWD`, `RETR` et `QUIT`. Les arguments passent par la validation des chemins ou des identifiants avant encodage. Les identifiants explicites restent en mémoire, associés au RecorderId et absents des réponses d’erreur. Le transport est le FTP en clair utilisé par la V1. [RFC 959](https://www.rfc-editor.org/rfc/rfc959.html)

## Authentification, listing et transfert

- L’authentification anonyme essaie le mot de passe vide, puis `anonymous@hmp.local`, puis `guest@`. Chaque refus d’authentification 501 ou 530 ouvre la tentative suivante sur une nouvelle connexion. Des identifiants explicites donnent lieu à une seule tentative. Les délais et ruptures de connexion remontent au moteur.
- Le client tente EPSV en premier. Un refus EPSV pris en charge bascule la session IPv4 en PASV. En PASV, le port vient du 227 et l’adresse vient de la connexion de contrôle. Une adresse annoncée par le serveur ne peut donc pas rediriger le client vers un autre hôte.
- Le listing essaie `LIST -a chemin`, puis `LIST chemin` sur les refus compatibles. Le fallback legacy utilise `CWD chemin` puis un listing sans chemin, ou un listing sans chemin à la racine. Une session déplacée par CWD revient à la racine avant d’appliquer ce fallback à `/`. Le code 550 d’un sous-dossier absent remonte à l’appelant. Un échec de canal passif, de lecture ou de réponse finale ferme la session sans relancer le listing.
- Les listings POSIX et DOS interprètent des entrées réelles. Ils filtrent les entrées spéciales et refusent un format inconnu ou un encodage UTF-8 invalide. Les espaces des noms POSIX, les accents, `#` et `?` passent jusqu’au chemin RETR. Le format DOS retire le remplissage avant le nom. Un listing est plafonné à 4 Mio, une ligne de contrôle à 8 Kio et une réponse multiligne à 64 lignes.
- Le lecteur attend la fin du flux de données puis un code 226 ou 250 sur le canal de contrôle. Une rupture, un 426 suivi d’un 226 de nettoyage ou une autre réponse ne permettent pas de publier le fichier. Le moteur compare les octets à la taille connue du listing et vérifie MD5/SHA-256 sur le flux et la relecture locale selon les options. La taille reste inconnue si l’appelant ne fournit pas de métadonnée de listing.
- Le délai couvre chaque opération FTP. Le token peut interrompre la négociation, le listing, la lecture ou l’attente de fin. L’abandon d’une opération qui possède les sockets les ferme. La fermeture normale envoie QUIT avec un délai court. Le port de destination du lot 2 gère toujours les réservations, temporaires, checksums et le point de publication.

## Découverte

`HyperDeckDiscovery` énumère les IPv4 privées et link-local. Un scan explicite accepte un CIDR de /24 à /32 sur une interface locale, lie le socket à son adresse source et limite les sondes à 32 connexions concurrentes. TCP 9993 reçoit uniquement `device info`. Le client exige une réponse 204 terminée avec un modèle HyperDeck. Il retourne le modèle et le protocole, ainsi qu’un RecorderId dérivé de l’identifiant de l’appareil ou de l’IPv4 quand cet identifiant est absent. La disponibilité FTP se vérifie séparément par connexion au port 21. [Manuel Blackmagic HyperDeck](https://www.blackmagicdesign.com/manuals/UserManuals/HyperDeckManual.pdf)

## Qualification sur un appareil désigné

Depuis la racine, avec Rust 1.99.1 et un Studio Mini 2017 accessible par TCP 9993 et FTP anonyme sur 21.

```sh
cargo run --locked --manifest-path v2/Cargo.toml -p hmp-infra --example qualify_ftp -- ADRESSE_IPV4
cargo run --locked --manifest-path v2/Cargo.toml -p hmp-infra --example qualify_ftp -- ADRESSE_IPV4 '/1/MEDIA_DE_TEST.mov'
```

La première commande identifie le recorder et affiche les entrées de la racine. La seconde exige un fichier présent dans son listing et effectue la copie dans un répertoire temporaire privé qui est nettoyé à la fermeture. Relever la référence matérielle et le firmware depuis la configuration de l’appareil. Le numéro de protocole retourné ne donne pas la version du firmware. Choisir un petit média stable, vérifier les volumes présents et relever le statut, les octets écrits et les hashes. Masquer l’IP et les noms de production avant de partager les résultats. Répéter sur un modèle récent et sur Windows. Les scénarios matériels complémentaires figurent dans la [matrice legacy](FTP_LEGACY_TEST_MATRIX.md).
