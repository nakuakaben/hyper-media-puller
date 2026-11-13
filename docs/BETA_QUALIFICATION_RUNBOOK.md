# Qualification finale de HMP V2 0.1.0-beta.1

**Décision actuelle : NO-GO publication.** Le propriétaire a déjà validé six scénarios sur HyperDeck physique avec le build interne du correctif. Conserver cette preuve, avec sa portée, dans [l’acceptation](BETA_ACCEPTANCE.md#correctif-des-enregistreurs--validation-physique-du-13-novembre-2026). Les preuves de CI et les packages historiques restent associés à leurs propres empreintes.

## Matrice de décision

| Critère ouvert | Exécution | Preuve attendue et condition de réussite |
| --- | --- | --- |
| Provenance, contenu et empreintes des candidats standard | Automatisable sur les deux plateformes | Les deux packages proviennent de l’arbre Git approuvé. Manifeste SHA-256 vérifié sur les fichiers téléchargés, architecture ARM64 ou x64 contrôlée, variante standard et ressources autorisées confirmées. |
| Notices et canal de téléchargement | Contrôles de fichiers automatisables. Vérification du canal par un opérateur | Notices HMP, Inter, Lucide, RWA, dépendances et composants NSIS disponibles avec les packages. Sources des composants concernés accessibles et vérifiées. Concordance avec les composants réellement livrés. |
| Gatekeeper et compte standard | Inspection automatisable sur macOS. Ouverture en session graphique | Quarantaine relevée sur le DMG téléchargé et sur le bundle copié, signature documentée, comportement Gatekeeper consigné. L’application démarre selon le parcours accepté pour le canal. |
| SmartScreen et compte standard | Inspection automatisable sur Windows. Ouverture en session graphique | Zone et statut Authenticode relevés. Message ou absence de message consigné. L’installation par utilisateur, les raccourcis et le lancement suivent le parcours accepté pour le canal. |
| WebView2 absent puis présent | Détection automatisable. Deux passes sur VM ou PC x64 | Versions et portée avant/après. Le NSIS installe le runtime quand il manque sur le poste de test, puis démarre HMP. La seconde passe réussit avec le runtime présent. |
| Profil Preview, remplacement et désinstallation | Scénario installé, vérifications de fichiers automatisables | Préférences, configuration matérielle et médias préservés comme prévu. Tester le passage depuis une Preview existante. Une mise à jour entre versions requiert deux versions distinctes vérifiées. |
| Intégrité de l’offload dans les packages exacts | Scénario installé sur chaque plateforme | Rapport JSON, SHA-256 de la fixture et de la copie, original de collision intact, copie renommée correcte et aucun fichier final après annulation. |
| Signalement privé GitHub | Mainteneur et compte de test connecté | Réglage confirmé et bouton **Report a vulnerability** visible. |
| Autorisation de publication et décision de distribution | Propriétaire | Approbation explicite des candidats et du canal, incluant les limites Gatekeeper et SmartScreen et le sort des packages non notarisés ou non signés. |

Pour chaque ligne, joindre date, machine, compte, commit et empreinte du candidat, résultat et lien vers la preuve. Un critère bloquant reste ouvert tant que sa preuve manque ou que le scénario échoue. La décision de publication relève du propriétaire après clôture de la [checklist](BETA_RELEASE_CHECKLIST.md).

## Vérification sans compilation

Préparer un dossier de remise privé avec les deux fichiers standard nommés comme dans le [plan de distribution](BETA_DISTRIBUTION_PLAN.md), `SHA256SUMS.txt`, les notes, `notices/`, `provenance/BUILDS.txt` et `provenance/SOURCE-SHA256SUMS.txt`. Conserver les manifestes obtenus de la fabrication et les comparer aux fichiers téléchargés. Les noms figurent dans le vérificateur et correspondent au format du dossier historique `v2/desktop/beta-artifacts/0.1.0-beta.1/`. Si le nom de remise change, produire le manifeste des noms finaux à partir des fichiers de fabrication avant le téléchargement de contrôle.

Depuis la racine du dépôt, sous macOS ou PowerShell avec Node.js disponible :

```text
node v2/desktop/qualification/verify-beta-files.mjs "<dossier-de-remise>"
```

Le contrôle lit les deux manifestes et vérifie la présence des notices requises. Vérifier séparément que leur contenu et les versions des archives correspondent au build livré, notamment NSIS et son plugin. Compléter `BUILDS.txt` avec SHA, arbre Git, commandes, versions, lien de CI et résultat de signature. Une remise locale ou un fichier dont l’empreinte est correcte ne fournit pas de preuve du canal final. Pour les étapes suivantes, inspecter et ouvrir les mêmes fichiers téléchargés que ceux contrôlés par le vérificateur, en conservant leurs attributs d’origine.

### macOS ARM64

Sur un compte standard distinct, télécharger le DMG standard avec Safari depuis le canal privé de test. Adapter le chemin à ce téléchargement. Conserver la sortie des commandes et relever tout rejet.

```sh
dmg="$HOME/Downloads/HMP-V2-0.1.0-beta.1-macos-arm64.dmg"
xattr -p com.apple.quarantine "$dmg"
hdiutil verify "$dmg"
mount_dir=$(mktemp -d)
hdiutil attach -readonly -nobrowse -mountpoint "$mount_dir" "$dmg"
app="$mount_dir/HMP.app"
plutil -lint "$app/Contents/Info.plist"
binary=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleExecutable' "$app/Contents/Info.plist")
file "$app/Contents/MacOS/$binary"
vtool -show-build "$app/Contents/MacOS/$binary"
codesign --verify --deep --strict --verbose=2 "$app"
ls -l "$app/Contents/Resources/licenses"
hdiutil detach "$mount_dir"
rmdir "$mount_dir"
```

Monter le même DMG dans Finder et copier HMP dans `~/Applications`, dans un dossier de qualification si une autre copie existe. Relever la quarantaine et l’évaluation sur cette copie. Un rejet de `spctl` sur une signature ad hoc est une observation à conserver.

```sh
app="$HOME/Applications/HMP.app"
xattr -p com.apple.quarantine "$app"
spctl --status
spctl --assess --type execute --verbose=4 "$app"
```

Ouvrir depuis Finder et consigner le message. Si le seul blocage est celui d’un développeur non vérifié et que la politique du poste permet une exception, appliquer **Confidentialité et sécurité → Ouvrir quand même** pour cette application après contrôle de provenance et d’empreinte. Relever l’éventuelle authentification et confirmer l’usage sous le compte standard. Un message de logiciel malveillant ou d’altération arrête l’essai. Garder Gatekeeper actif. [Procédure Apple](https://support.apple.com/guide/mac-help/open-a-mac-app-from-an-unidentified-developer-mh40616/mac)

### Windows x64

Sur un compte standard d’une machine x64 propre, télécharger le NSIS avec Edge depuis le canal privé de test. Depuis PowerShell x64, vérifier l’empreinte via le script commun puis relever la zone et la signature :

```powershell
$setup = Join-Path $env:USERPROFILE 'Downloads\HMP-V2-0.1.0-beta.1-windows-x64-setup.exe'
Get-Content -LiteralPath $setup -Stream Zone.Identifier
Get-AuthenticodeSignature -LiteralPath $setup | Select-Object Status, StatusMessage, SignerCertificate
```

Ouvrir depuis l’Explorateur et relever le message SmartScreen ou Smart App Control, ou son absence, ainsi que la politique du poste et l’issue. Si le poste bloque l’exécution, consigner le blocage. Garder les protections actives. [SmartScreen et réputation](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation)

Avant et après l’installation, relever `pv` dans les deux portées. Une version supérieure à `0.0.0.0` dans au moins une portée confirme la présence d’Evergreen. Si une valeur est illisible ou mal formée, résoudre cette incertitude avant de déclarer le runtime absent.

```powershell
$id = '{F3017226-FE2A-4295-8BDF-00C3A9A7E4C5}'
@(
  "HKLM:\SOFTWARE\WOW6432Node\Microsoft\EdgeUpdate\Clients\$id"
  "HKCU:\Software\Microsoft\EdgeUpdate\Clients\$id"
) | ForEach-Object {
  try {
    $entry = Get-Item -LiteralPath $_ -ErrorAction Stop
    $pv = $entry.GetValue('pv')
  } catch [System.Management.Automation.ItemNotFoundException] {
    $pv = $null
  }
  [pscustomobject]@{
    Cle = $_
    Version = $pv
  }
}
```

Passer d’abord sur un instantané où Evergreen est absent dans les deux portées. Installer le NSIS exact avec réseau disponible et vérifier l’apparition du runtime puis l’ouverture de HMP. Pour la seconde passe, conserver le runtime et réinstaller HMP. Relever la version, l’issue du lancement et les données conservées après désinstallation. Le banc CI `windows-runtime.ps1` provisionne le runtime pour ses propres essais et ferait disparaître la condition « absent » s’il était exécuté avant cette passe. [Détection et installation Microsoft](https://learn.microsoft.com/en-us/microsoft-edge/webview2/concepts/distribution#detect-if-a-webview2-runtime-is-already-installed)

## Reprise du prochain lot

1. Partir du SHA approuvé et vérifier l’inventaire des preuves disponibles. Si la remise standard exacte manque, reprendre les commandes de fabrication du [plan](BETA_DISTRIBUTION_PLAN.md). Sous Windows, réutiliser `qualification/windows-package.ps1`, `windows-package-user.ps1` et le workflow existant. Depuis un poste authentifié avec `gh`, sur la branche approuvée dont le workflow est disponible, déclencher au besoin :

   ```sh
   gh workflow run rust-core.yml --ref "$HMP_QUALIFICATION_REF" -f "recipient=$HMP_AGE_RECIPIENT"
   gh run list --workflow rust-core.yml --event workflow_dispatch --branch "$HMP_QUALIFICATION_REF" --limit 3
   ```

   Définir `HMP_QUALIFICATION_REF` sur la branche approuvée et `HMP_AGE_RECIPIENT` sur la clé publique age. Comparer le SHA de l’exécution au SHA attendu avant de récupérer son archive chiffrée. Ce workflow compile et lance les suites natives. Le réserver au créneau de qualification. Le runner prouve le cycle NSIS avec WebView2 présent et le parcours synthétique du binaire de qualification.

2. Assembler la remise privée et lancer le vérificateur. Contrôler le contenu des packages et les notices, puis comparer les empreintes après téléchargement. Sous Windows, relever l’architecture de l’exécutable installé et vérifier les notices dans son dossier `licenses`. Exemple avec le chemin d’installation réel et les outils Visual Studio ouverts :

   ```powershell
   $app = Join-Path $env:LOCALAPPDATA 'HMP'
   dumpbin /headers (Join-Path $app 'hmp-v2-preview.exe') | Select-String '8664 machine'
   Get-ChildItem -LiteralPath (Join-Path $app 'licenses')
   ```

   Les tests Rust, Tauri, Electron et WebView2 déjà en CI restent les suites de non-régression à réutiliser. La vérification locale des fichiers, signatures, zones et versions de runtime peut s’exécuter indépendamment.

3. Exécuter les passages graphiques ci-dessus, puis les étapes de transfert et de conservation dans [l’acceptation](BETA_ACCEPTANCE.md#essais-manuels-à-regrouper). Compléter la matrice et la checklist avec les seules preuves recueillies. Garder la publication soumise à décision explicite.
