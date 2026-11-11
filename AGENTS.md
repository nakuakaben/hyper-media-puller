# HyperSync / HyperDeck Media Puller

Application Windows Electron, TypeScript, React/Vite et basic-ftp. Lire README.md et docs/ avant modification.

Respecter les modules existants : reseau, FTP, queue et disque uniquement dans main ; preload contextBridge et IPC pour le renderer. Garder nodeIntegration false et contextIsolation true.

Ne jamais modifier, supprimer ou renommer les medias source, ni envoyer de commandes de transport, formatage ou reboot aux recorders. Ne pas introduire de dossiers FTP fictifs en mode reel. Simulation desactivee au demarrage.

Conserver le style bleu/cyan, les assets fournis et le packaging electron-builder. Faire des modifications ciblees, TypeScript explicite, commentaires seulement utiles.

Validation : npm ci ; npm run build:app ; npm run test:ftp-paths ; npm run smoke:dev selon impact. Attention : smoke:dev modifie la configuration utilisateur et utilise 5173/9323/9993. Packaging : npm run dist:portable et npm run dist:installer.

Ne publier aucun secret ni configuration userData. Ne pas modifier la version implicitement : lire les scripts version:bump et version:sync avant release. Documenter les tests reellement executes et leurs limites.

## Intégration GitHub

Ouvrir les PR prêtes pour revue et attendre toutes les vérifications obligatoires sur le commit proposé. Vérifier les protections et les éventuelles revues requises. Utiliser l'auto-merge Squash si le dépôt l'autorise. Si l'option est indisponible, examiner son activation sans affaiblir les protections, puis utiliser la fusion Squash ordinaire lorsque les validations et droits le permettent. Corriger les échecs et relancer les contrôles. Les releases suivent une validation distincte et la qualification matérielle reste obligatoire pour déclarer la compatibilité HyperDeck.
