# Acceptation de HMP V2 0.1.0-beta.1

**NO-GO publication.** Le nom HMP et la restauration graphique ont été validés. Les essais des anciens lots sont des preuves historiques. Les candidats de l’intégration 13–14 et leurs SHA-256 sont remis localement dans `v2/desktop/beta-artifacts/integration-13-14/`. Le rapport `ACCEPTATION.md` de ce dossier associe les preuves à chaque fichier exact et `TESTS_MANUELS.md` regroupe les essais restants.

Les tests Windows x64 en WebView2 utilisent un HyperDeck et un FTP synthétiques. L’intégration vérifie aussi la conservation de la configuration matérielle, des rapports en mémoire et des médias. Le premier offload physique du Studio HD Plus sous macOS précède la candidate. Le Studio Mini 2017, SMB et les essais matériels Windows restent à qualifier.

## Correctif des enregistreurs — validation physique du 13 novembre 2026

Le propriétaire a confirmé les six essais suivants sur un HyperDeck physique avec le build interne `0.1.0-beta.1` du correctif, issu du commit `6d123ca`. [PR #15](https://github.com/nakuakaben/hyper-media-puller/pull/15)

| Essai | Résultat confirmé |
| --- | --- |
| Démarrage | Réussi |
| Renommage | Réussi |
| Persistance après redémarrage | Réussie |
| Déconnexion | Réussie |
| Reconnexion automatique | Réussie |
| Suppression d’un enregistreur | Réussie |

Le banc Windows WebView2 couvre séparément le retrait persistant, l’ajout volontaire, les transferts FTP, le SHA-256 flux/local, l’annulation et la collision avec une source synthétique. L’export et l’import JSON ont été exercés dans l’application macOS avec un profil isolé. La plateforme, le modèle et l’empreinte du package utilisé pour ces six essais physiques n’ont pas été précisés dans la confirmation. [CI du correctif testé](https://github.com/nakuakaben/hyper-media-puller/actions/runs/43423603676)

La publication reste en **NO-GO**. Les essais des installateurs depuis le canal final, les protections système et les autres critères ouverts continuent d’être suivis dans la [checklist bêta](BETA_RELEASE_CHECKLIST.md).

## Essais manuels à regrouper

Préparer un Mac ARM64 avec une session locale standard distincte, ainsi qu’un PC ou une VM **Windows x64** avec un compte standard, une session graphique et un instantané propre. Sur Windows, commencer par un environnement où WebView2 Evergreen est réellement absent. Vérifier son absence avec la méthode de détection Microsoft avant l’installation. Pour la seconde passe, garder le runtime installé. Prévoir un réseau privé de test avec les ports TCP 9993 et 21 accessibles et un HyperDeck de test au repos ou un serveur synthétique. Un test sur serveur synthétique doit être enregistré comme tel. [Détection et distribution WebView2](https://learn.microsoft.com/microsoft-edge/webview2/concepts/distribution)

1. Servir les deux fichiers exacts sur un canal de test privé et les télécharger dans Safari et Edge. Comparer les empreintes avec `SHA256SUMS.txt`. Sous macOS, relever `com.apple.quarantine` sur le DMG et le bundle copié dans `~/Applications`. Sous Windows, relever le flux `Zone.Identifier` avec `Get-Content -LiteralPath <fichier> -Stream Zone.Identifier`.
2. Sur macOS, ouvrir la copie depuis Finder, relever le message puis, après vérification de la provenance, exercer l’exception pour cette application depuis **Confidentialité et sécurité → Ouvrir quand même** si le poste le permet. Relever si un administrateur doit autoriser l’exception et revenir à la session standard pour l’usage. Sous Windows, lancer le NSIS depuis le fichier téléchargé, relever SmartScreen et poursuivre uniquement si la politique du poste l’autorise. Relever l’installation de WebView2 puis refaire le parcours avec le runtime présent. [Apple](https://support.apple.com/en-au/102445) · [SmartScreen](https://learn.microsoft.com/windows/apps/package-and-deploy/smartscreen-reputation)
3. Dans chaque application installée, copier un média de test avec SHA-256. Comparer le fichier final à l’empreinte connue de la fixture, et contrôler tailles et portée du rapport. Pour la collision, placer au nom attendu un fichier de taille identique avec un contenu différent, choisir **Renommer** et vérifier l’empreinte intacte de l’original. Pour l’annulation, interrompre un second média assez long pendant l’écriture et vérifier l’absence de nom final. Utiliser un dossier test APFS ou NTFS avec espaces et accents.
4. Exporter le rapport, quitter l’application, relever le hash des préférences et du média. Remplacer le bundle macOS par la copie du DMG vérifié. Sous Windows, relancer le NSIS exact avec la même identité et le même dossier. Ce scénario qualifie le remplacement ou la réinstallation à version égale. Une mise à jour entre versions distinctes nécessite un second package vérifié. Rouvrir, contrôler destination, préférences et médias, puis désinstaller et comparer à nouveau les fichiers.
5. Consigner l’OS, l’architecture, le type de compte, les SHA-256, la présence du runtime avant et après, le message de protection et les résultats de chaque étape. Garder les protections globales actives. Toute exception refusée par la politique du poste constitue un résultat à consigner.

## Notices et canal de sécurité

Le dossier de remise local `v2/desktop/beta-artifacts/0.1.0-beta.1` contient les packages exacts, leur manifeste, les notes, le guide, les rapports, le relevé de provenance et les notices. L’archive source exacte de `option-ext 0.2.0` accompagne les textes MPL et l’avis de disponibilité des sources. Les notices NSIS comprennent le texte zlib/libpng, le module LZMA sous CPL 1.0 avec son exception, les avis des modules et les licences du plugin Tauri. Le relevé des dépendances du plugin part de son tag amont. Le verrou effectif du DLL tiers précompilé n’a pas été fourni par l’amont. [MPL 2.0, section 3.2](https://www.mozilla.org/en-US/MPL/2.0/) · [Licence NSIS](https://nsis.sourceforge.io/Docs/AppendixI.html)

Les verrous Cargo et npm et les actifs distribués correspondent à ceux audités au lot 10. Les quatre PNG historiques restent hors packages. Le pictogramme Lucide actuel, les polices Inter et les avis HMP, Lucide et RWA ont été contrôlés sur les candidats. Le formulaire privé GitHub n’apparaît pas sur la page publique consultée sans connexion et l’API disponible ne permet pas de lire son activation. Un mainteneur connecté doit confirmer le réglage, puis vérifier que le bouton **Report a vulnerability** est visible pour un compte test. [Politique de sécurité](../SECURITY.md) · [Configuration GitHub](https://docs.github.com/en/code-security/how-tos/report-and-fix-vulnerabilities/configure-vulnerability-reporting/configure-for-a-repository)

[Checklist GO / NO-GO](BETA_RELEASE_CHECKLIST.md)
