# HyperSync / HyperDeck Media Puller

Application Windows Electron, TypeScript, React/Vite et basic-ftp. Lire README.md et docs/ avant modification.

Respecter les modules existants : reseau, FTP, queue et disque uniquement dans main ; preload contextBridge et IPC pour le renderer. Garder nodeIntegration false et contextIsolation true.

Ne jamais modifier, supprimer ou renommer les medias source, ni envoyer de commandes de transport, formatage ou reboot aux recorders. Ne pas introduire de dossiers FTP fictifs en mode reel. Simulation desactivee au demarrage.

Conserver le style bleu/cyan, les assets fournis et le packaging electron-builder. Faire des modifications ciblees, TypeScript explicite, commentaires seulement utiles.

Validation : npm ci ; npm run build:app ; npm run test:ftp-paths ; npm run smoke:dev selon impact. Attention : smoke:dev modifie la configuration utilisateur et utilise 5173/9323/9993. Packaging : npm run dist:portable et npm run dist:installer.

Ne publier aucun secret ni configuration userData. Ne pas modifier la version implicitement : lire les scripts version:bump et version:sync avant release. Documenter les tests reellement executes et leurs limites.

## Intégration GitHub

Ouvrir les PR prêtes pour revue et attendre toutes les vérifications obligatoires sur le commit proposé. Vérifier les protections, les conflits et les éventuelles revues requises. Dès que les contrôles passent et que la PR est fusionnable, effectuer directement un Squash and merge. Le processus ne dépend pas du réglage GitHub `allow_auto_merge`. Corriger les échecs récupérables et relancer les contrôles. Ne jamais forcer une fusion, contourner une protection ou publier automatiquement une release.

## Qualification HyperDeck

Maintenir les essais synthétiques legacy et les garanties SAFE-01 à SAFE-12. Le Studio Mini 2017 est actuellement indisponible. Sa qualification physique reste au backlog et ne bloque pas les lots de développement. Une déclaration de compatibilité matérielle exige des résultats physiques. Chaque release documente les modèles effectivement testés et les modèles dont la compatibilité reste à vérifier.
