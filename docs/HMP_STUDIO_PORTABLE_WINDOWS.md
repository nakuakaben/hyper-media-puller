# HMP Windows portable — candidature pour Studio App

Ce format est différent du setup NSIS existant. Il sert à qualifier une
installation gérée par Studio App, sans lancer l'assistant NSIS.

- Build Tauri public Windows x64, `hmp-v2-preview.exe`, ressources `licenses/`.
- ZIP `HMP-V2-<version>-windows-x64-portable.zip`, contenant `HMP/`.
- `studio-portable.json` décrit l'identité, la version, les ressources,
  les tailles et empreintes SHA-256 de chaque fichier.
- `SHA256SUMS-portable.txt` contient l'empreinte du ZIP complet.
- Le runtime **Microsoft Edge WebView2 Evergreen** est requis sur le PC.
  Le ZIP ne télécharge ni n'installe ce runtime.
- Pas de clé HKCU NSIS ni de raccourci Menu Démarrer, ni de désinstalleur.
- Aucune donnée utilisateur, aucune clé privée, aucun certificat de
  signature et aucune approbation Studio App embarqués dans le ZIP.
- Les artefacts GitHub Actions issus d'une PR sont **candidats de
  qualification**, pas des releases officiellement approuvées.

Une fois le candidat validé dans un Windows x64 propre, l'éditeur de
Studio App doit approuver explicitement le ZIP exact (URL, taille,
SHA-256, version, architecture et recette), puis développer une pose
atomique et une détection du mode portable. Ne jamais considérer le
manifeste dans le ZIP comme une autorisation auto-signée.

L'installation NSIS actuelle reste disponible et inchangée.
