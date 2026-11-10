# Etat du projet - 2026-11-10

Sources retenues : dossier app du projet HyperSync. Version package et changelog : 1.1.0. Cette version contient les checksums MD5/SHA-256 et les tests de chemins FTP, au-dela de la version 1.0.0 precedente.

Disponibles dans le code : gestion recorders, Search HyperDeck, listing FTP reel, navigation, destination locale, queue multi-recorders, progression, doublons, logs, simulation explicite, checksums et packaging portable/NSIS. Les icones HMP et les quatre PNG appareils sont presentes.

Validation de cette initialisation : build:app et test:ftp-paths executes avec succes. Le test sur un HyperDeck physique n'est pas revendique pour cette session. Les artefacts Windows preexistants ne constituent pas une validation de packaging de cette session.

Limites : FTP non chiffre sur reseau local ; configuration utilisateur pouvant contenir un mot de passe FTP ; simulation remise a false au lancement. Les checksums verifient le transfert/local, pas un hash distant independant. Le smoke peut etre limite si 9993 est occupe et modifie la configuration utilisateur. Aucun test exhaustif de regression UI aux trois resolutions n'est etabli ici.

Prochaines etapes : isoler le profil utilisateur du smoke, tester avec recorder reel et interruptions reseau, verifier les rendus desktop, clarifier le script de version avant la prochaine release.

Audit des copies : dossiers voisins docs et releases, archive hmp.zip conservee localement. Aucun historique Git local exploitable dans le dossier .git initial (vide). Aucune version locale supprimee.
