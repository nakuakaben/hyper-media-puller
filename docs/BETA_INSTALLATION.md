# Installer et retirer HMP V2 0.1.0-beta.1

Utilisez les fichiers provenant du canal approuvé par le projet et vérifiez leurs SHA-256 avec le manifeste fourni. Cette procédure décrit la candidate interne. Les [résultats de qualification](BETA_FINAL_QUALIFICATION.md) indiquent les scénarios effectivement exécutés.

## macOS ARM64

1. Vérifiez le DMG avec `shasum -a 256 -c SHA256SUMS.txt` si les deux packages du manifeste sont présents, ou comparez l’empreinte retournée par `shasum -a 256 <fichier.dmg>` à la ligne macOS.
2. Ouvrez le DMG, copiez le bundle dans `~/Applications` et éjectez le volume. Le bundle et le binaire annoncent macOS 11.0. Le système le plus ancien réellement testé pour la candidate figure dans le rapport.
3. Essayez de lancer la copie depuis Finder. Gatekeeper peut rejeter ce bundle ad hoc. Pour un avertissement de développeur non vérifié, vérifiez la provenance et l’empreinte. Si le poste autorise une exception pour cette seule application, Apple documente **Réglages Système → Confidentialité et sécurité → Ouvrir quand même**, puis une confirmation. Un avertissement de logiciel malveillant, d’altération ou un blocage par l’administration du poste met fin à l’installation. [Procédure Apple](https://support.apple.com/en-au/102445)
4. Pour une mise à jour manuelle, attendez la fin des copies, quittez HMP, vérifiez la nouvelle image puis remplacez le bundle. Pour désinstaller, retirez le bundle de `~/Applications`. Les préférences restent dans `~/Library/Application Support/fr.tktprod.hyperdeck-media-puller.v2.preview`. Les médias restent dans le dossier de destination.

## Windows x64

1. Comparez `Get-FileHash -Algorithm SHA256 <installateur.exe>` au manifeste. Exécutez le NSIS sous votre compte standard. L’installation par utilisateur utilise par défaut `%LOCALAPPDATA%` et permet de choisir un autre dossier accessible.
2. WebView2 Evergreen est requis. S’il manque, l’installateur utilise le bootstrapper Microsoft et a besoin d’un accès réseau. Une politique d’entreprise peut contrôler l’installation du runtime. [Distribution WebView2](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution)
3. Le NSIS et le binaire sont sans signature Authenticode. SmartScreen peut avertir ou bloquer le premier lancement depuis un téléchargement. Si le poste bloque l’exécution, suivez sa politique ou contactez son administrateur. [SmartScreen](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation)
4. Pour mettre à jour, terminez les copies, quittez HMP et lancez le nouvel installateur vérifié avec le même compte. Pour désinstaller, utilisez **Paramètres → Applications → Applications installées**. Lisez les options de nettoyage avant de confirmer. Le profil de transfert se trouve sous `%APPDATA%\fr.tktprod.hyperdeck-media-puller.v2.preview`. Les médias copiés restent à destination.

## Premier transfert

Utilisez un réseau local de confiance et un dossier APFS ou NTFS inscriptible. Ajoutez le recorder, sélectionnez un média, choisissez le dossier, ajoutez le lot à la file et démarrez-le. Choisissez SHA-256 pour vérifier le flux reçu contre la copie relue. Conservez le rapport avant de fermer la session et expurgez les chemins, les noms et les informations réseau avant de le partager. La V2 refuse exFAT si la publication exclusive est indisponible. SMB et les modèles autres que ceux du rapport restent à qualifier.
