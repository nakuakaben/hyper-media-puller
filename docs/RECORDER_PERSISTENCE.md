# Configuration matérielle d’une prestation

HMP V2 ouvre la dernière configuration matérielle du profil local. Dans **Médias**, identifiez les HyperDeck par leur IPv4 privée ou link-local. Le clic droit sur un enregistreur, ou **Maj+F10** lorsqu’il a le focus, ouvre les actions de renommage, de vérification et de retrait. Le retrait demande confirmation. Le nom personnalisé et le modèle sont conservés séparément.

Les équipements enregistrés apparaissent avant la vérification réseau. HMP utilise la commande HyperDeck `device info` et teste la connexion FTP anonyme. Un appareil qui ne répond pas reste dans la liste. HMP vérifie à nouveau en arrière-plan toutes les 30 secondes, ou immédiatement depuis le menu de l’enregistreur. Si le modèle ou l’identifiant matériel attendu diffère, HMP affiche **Identité à confirmer** et interdit une nouvelle navigation FTP sur cette entrée. Un HyperDeck qui ne fournit aucun identifiant matériel nécessite une confirmation explicite à chaque nouvelle session ou après une perte de connexion. Si l’appareil a effectivement changé, retirez l’entrée puis identifiez son remplaçant.

HMP attribue un UUID à l’enregistrement. Une redécouverte avec le même identifiant matériel et le même modèle peut actualiser l’adresse et conserve le nom personnalisé. Une IP déjà attribuée à une identité incertaine ou différente est signalée comme conflit.

## Changer de prestation

Dans **Paramètres → Configuration matérielle**, exportez un JSON pour la prestation active. Pour en ouvrir une autre, exportez d’abord la configuration courante, confirmez la réinitialisation puis importez le JSON de l’autre prestation. Pour compléter la prestation active, importez directement. HMP ignore les entrées importées en conflit avec la configuration locale et affiche leur nombre. L’export demande un nouveau nom de fichier si le fichier existe déjà.

## Profil et format

Le fichier versionné `equipment-v1.json` est distinct de `offload-settings-v1.json`. Le premier lancement crée une configuration vide si le fichier n’existe pas. Les écritures passent par un temporaire du même dossier, synchronisé puis publié atomiquement. Un verrou de profil exclut deux écritures concurrentes par des instances distinctes. Un JSON local illisible reste intact et l’application affiche l’erreur. Quittez HMP et mettez ce fichier de côté avant de restaurer un export valide.

Le format contient des identifiants locaux, noms, modèles, adresses IPv4, identifiants matériels et versions de protocole disponibles. Il ne contient ni identifiants FTP secrets ni chemins de destination. Rust contrôle le schéma, les doublons et la taille du fichier avant toute fusion. Les dialogues natifs sélectionnent les fichiers à importer ou exporter.

Les changements matériels concernent la configuration et les nouvelles sélections. Les lots déjà créés conservent leurs sources et options. La vérification au démarrage ne lance aucune copie. Les rapports de la session restent consultables et les rapports déjà exportés restent sur disque. La file et ses rapports en mémoire suivent leur cycle de vie actuel.

Les configurations standard et interne conservent des profils distincts. Utilisez le JSON si vous souhaitez reprendre une prestation dans l’autre configuration. Le rapport d’acceptation des installateurs intégrés indique les essais effectués sur chaque plateforme.
