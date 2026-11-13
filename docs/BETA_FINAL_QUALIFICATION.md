# Qualification finale de HMP V2 0.1.0-beta.1

Candidats internes issus du lot 9. Base auditée `f04ba57fe3189cd9d988714fae0702ab64eecd0f`. Le dossier local `v2/desktop/beta-artifacts` contient les packages exacts, les relevés du lot 9 et le manifeste vérifié.

| Package | SHA-256 |
| --- | --- |
| `HMP-V2-0.1.0-beta.1-macos-arm64.dmg` | `214a8cb865efc821351bb6a9eddf752295166050b5fdec7e123c95d5a0bbab5f` |
| `HMP-V2-0.1.0-beta.1-windows-x64-setup.exe` | `34c8e18d389c62325c816eb26529e8d6fff4562b31755a4a1b6a6066bd79cbf9` |

## Résultats d’installation et de transfert

| Scénario | Résultat et périmètre |
| --- | --- |
| Téléchargement macOS | Safari a téléchargé le DMG via HTTP de boucle locale sur macOS 26.1 ARM64. SHA-256 et vérification du DMG concordent. L’attribut `com.apple.quarantine` créé par Safari a été propagé au bundle copié depuis l’image montée en lecture seule. `codesign --verify --deep --strict` a validé la signature ad hoc. `spctl --assess --type execute` a rejeté la copie. |
| Cycle macOS | Le lot 9 a vérifié la copie, le lancement et la fermeture sans élévation sur le compte local administrateur, le retrait de la copie et la conservation du fichier de préférences. L’ouverture depuis Finder après exception Gatekeeper, le compte standard distinct et le remplacement réel restent à vérifier. Le port TCP 9993 était déjà occupé sur le Mac de test. Le transfert synthétique via l’installateur exact reste à faire sur un environnement isolé. |
| Cycle Windows | Le NSIS exact a passé installation, lancement, fermeture et désinstallation sous un compte Windows x64 standard, dans un chemin avec espaces et accent, avec WebView2 présent. L’exécutable embarqué est PE32+ x86‑64. Le téléchargement du NSIS dans un navigateur Windows, SmartScreen, WebView2 absent, la mise à jour manuelle et le transfert dans ce binaire installé restent à vérifier. La VM locale disponible est Windows ARM. [CI du package exact](https://github.com/nakuakaben/hyper-media-puller/actions/runs/43286675811) |
| SAFE et FTP | Le lot 9 a passé les 32 tests moteur SAFE-01 à SAFE-12 et les 16 tests FTP. Le parcours Windows natif avec fixture couvre copie, SHA-256, annulation, coupure, réessai et fermeture. Il utilise le binaire de qualification. Les scénarios SAFE dans les exécutables installés exacts restent à qualifier. [Spécification SAFE](TRANSFER_SAFETY_SPEC.md) · [Validation Windows](LOT7_VALIDATION_REPORT.md) |
| Matériel | Un premier offload physique du Studio HD Plus a été confirmé sur macOS au lot 6. Les données de ce test précèdent la candidate. Les essais Windows reposent sur une fixture. [Qualification macOS](MACOS_QUALIFICATION.md) |

## Audits de sécurité

- Gitleaks 8.30.1 a analysé 36 commits accessibles via le miroir GitHub, branches et têtes de PR incluses, sans détection. Ce périmètre exclut les objets inaccessibles et les secrets hors dépôt.
- `npm audit` a signalé 0 paquet V2 et 25 paquets Electron V1 (1 critique, 17 élevés, 7 modérés). Le packaging V2 utilise son propre verrouillage.
- OSV Scanner 2.7.1 retrouve `glib 0.18.5` et `proc-macro-error 1.0.4` dans le verrouillage Tauri, hors des graphes des deux cibles candidates. Aucun signalement dans le verrouillage du moteur. [Avis glib](https://rustsec.org/advisories/RUSTSEC-2024-0429.html) · [Avis proc-macro-error](https://rustsec.org/advisories/RUSTSEC-2024-0370.html)
- Les points d’entrée du banc Windows sont sous `cfg(all(windows, feature = "windows-qualification"))`. La commande de fabrication NSIS n’active pas cette feature. L’inspection des binaires exacts n’a trouvé ni `HMP_WINDOWS_QUALIFICATION` ni `request.json`. Ce contrôle combine le graphe et la recherche de marqueurs dans les exécutables.

## Licences et actifs

L’inspection des ressources du bundle macOS et du contenu extrait du NSIS a retrouvé HMP MIT, Inter OFL, Lucide et RWA. Les quatre PNG historiques de modèles HyperDeck et l’ancienne icône de Preview restent exclus des packages. Le pictogramme embarqué dérive de Lucide Server, et l’inventaire des graphismes figure dans les [notes de version](BETA_RELEASE_NOTES.md).

| Couche | Inventaire et action |
| --- | --- |
| Frontend compilé | Un rebuild local avec sourcemap recense `@tauri-apps/api 2.12.4` (Apache-2.0 ou MIT), Lucide `0.468.0` (ISC), React et React DOM `18.3.1` (MIT), `scheduler 0.23.2` (MIT), et les polices Inter `5.2.8` (OFL-1.1). Ajouter les avis des modules JS à la livraison, en particulier React, React DOM, scheduler et l’API Tauri. |
| Rust | Le [relevé par cible](BETA_RUST_LICENSE_INVENTORY.tsv) liste 159 dépendances externes macOS et 160 Windows d’après `cargo tree --locked --target … -e normal,no-proc-macro`. Il borne les composants potentiellement incorporés. Le linker peut éliminer une partie du code. Les choix de licence et textes de copyright à remettre aux destinataires restent à assembler. Pour `option-ext 0.2.0` (MPL-2.0), indiquer où récupérer la source exacte. [Source option-ext](https://crates.io/crates/option-ext/0.2.0) · [FAQ MPL](https://www.mozilla.org/en-US/MPL/2.0/FAQ/) |
| Installateur Windows | Le NSIS extrait contient le stub, les modules System, nsDialogs, StartMenu, NSISdl et `nsis_tauri_utils.dll`. Le journal de build identifie NSIS 3.13 et nsis-tauri-utils 0.5.3. Assembler les notices correspondantes, y compris celle de LZMA utilisé par le package. WebView2 est fourni par Microsoft séparément. [Licence NSIS](https://nsis.sourceforge.io/Docs/AppendixI.html) · [Plugin Tauri](https://github.com/tauri-apps/nsis-tauri-utils/tree/nsis_tauri_utils-v0.5.3) |

**NO-GO publication.** Préparer les notices tierces complètes, qualifier les parcours macOS et Windows restants sur les fichiers exacts et obtenir la décision de publication. La procédure et les résultats actuels permettent les essais internes. [Checklist](BETA_RELEASE_CHECKLIST.md)
