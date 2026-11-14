# Recherche réseau HyperDeck dans HMP V2

Dans Médias, ouvrir **Rechercher des HyperDeck**, choisir une interface IPv4 et vérifier la proposition CIDR. **Lancer la recherche** démarre le scan. Fermer le dialogue ou cliquer sur **Annuler la recherche** demande son arrêt. Le scan se limite aux adresses privées ou link-local, avec un préfixe de 24 à 32 bits compris dans le sous-réseau de l’interface sélectionnée. L’énumération des interfaces ne contacte aucune adresse du réseau.

La sonde TCP 9993 envoie uniquement la commande device info. Un port ouvert ne suffit pas à confirmer un HyperDeck. Les réponses valides déclenchent un contrôle FTP sur le port 21. Les appareils confirmés peuvent être ajoutés individuellement. L’ajout revérifie l’identité et refuse les conflits avec la configuration déjà enregistrée, y compris les adresses déjà utilisées. La vérification périodique habituelle des appareils enregistrés reste indépendante.

La qualification doit distinguer les contrôles synthétiques d’un scan sur une régie réelle, notamment une machine raccordée à deux interfaces IPv4 et un appareil qui accepte la commande de contrôle mais dont le FTP est indisponible. Aucun scan de plage n’est déclenché au démarrage.
