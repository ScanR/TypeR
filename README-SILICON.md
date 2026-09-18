# TypeR Silicon

Portage local de TypeR 3.0.0 vers UXP, destiné à Photoshop récent sur Apple Silicon.
Sources de départ : `ScanR/TypeR`, branche `develop`, commit `fc73244`.
Cette adaptation n'est pas une version officielle de ScanR.

## Installation et utilisation

Les paquets `TypeR-Silicon.ccx` et `fr.scanr.typer.silicon_PS.ccx` sont identiques.
Son identifiant `fr.scanr.typer.silicon` est différent de celui de l'extension CEP existante.

1. Enregistrer les documents ouverts avant tout redémarrage de Photoshop.
2. Ouvrir l'un des deux `.ccx` avec Adobe Creative Cloud pour son installation locale.
3. Ouvrir Photoshop en mode Apple Silicon, puis **Plugins > TypeR Silicon**.

Si Creative Cloud refuse le paquet local non publié, charger `uxp/manifest.json`
avec l'outil officiel **Adobe UXP Developer Tool** : **Add Plugin > Load**.
Le mode développeur de Photoshop doit alors être activé dans ses paramètres de plugins.
Il ne faut pas copier cette version dans le répertoire des extensions CEP.

Pour reprendre les styles : exporter un JSON depuis les paramètres du TypeR actuel,
puis l'importer dans les paramètres de TypeR Silicon. La structure des dossiers,
les marques de style et les couleurs restent dans le format TypeR.
Les PSD doivent être resélectionnés avec **Ouvrir répertoire des PSD** pour autoriser
leur accès. L'ancien TypeR et ses fichiers ne sont pas remplacés.

## Fonctionnement

- Interface React, traductions, dossiers et formulaires de styles réutilisés.
- Panneau UXP avec WebView locale, sans serveur local ni connexion réseau requise.
- API Photoshop UXP v2 pour créer/appliquer les textes, copier les styles, régler
  la taille et l'interligne, gérer les contours, centrer et insérer plusieurs bulles.
- Aucune exécution de `host.jsx`, de CEP ou d'un composant Intel dans le paquet.
- Opérations groupées dans l'historique ; une erreur annule l'opération entière.
- Accès aux fichiers autorisé par les sélecteurs natifs UXP. Le panneau nomme
  lui-même ses fichiers de stockage (`/storage`, `/storage.bak`,
  `/storage_profiles`, profils et images de fond) : ces chemins sont virtuels, un
  plugin UXP n'ayant pas de dossier d'extension où écrire. Chacun correspond à un
  fichier du dossier de données du plugin (`storage.json`, `storage.bak.json`,
  `storage_profiles.json`, …), si bien que la copie de secours `.bak` du panneau
  fonctionne. Le dossier est lu une fois au démarrage, puis le panneau lit sa copie
  en mémoire et l'hôte écrit derrière.
- Contrôle de document pour empêcher d'insérer une sélection capturée sur une autre page.
- Centrage identique à la version CEP : la sélection est ouverte (contraction puis
  dilatation du même rayon, rayon adapté à la taille de la bulle et réduit par deux
  tant que le résultat est trop petit). Cette ouverture ferme les trous laissés par
  la baguette magique sur les lettres et coupe la queue de la bulle, qui ne fait pas
  partie de la zone de texte. Un canal temporaire porte la sélection pendant
  l'opération et est toujours supprimé ensuite ; si Photoshop le refuse, le centrage
  se rabat sur l'ancien calcul.
- Application d'un style à un calque existant : le texte vide veut dire « ne changer
  que le style ». Le calque garde son contenu, ce qui permet de changer la police
  d'un calque texte existant, et le cadre est réajusté au texte rendu par Photoshop.
- Lecture des polices des calques d'un PSD, entraînement du profil de texte et
  copie/application d'un texte ajusté à la forme : le PSD est analysé dans une copie
  de travail jetable, toujours refermée à la fin, sans toucher au document d'origine.

Les raccourcis clavier d'origine (Cmd+Ctrl, Cmd+Option, etc.) fonctionnent
**sans focus du panneau**, tant que Photoshop est au premier plan. Un petit
programme natif lit l'état du clavier, comme ScriptUI dans l'ancienne version
CEP. La commande Insérer est contextuelle : une sélection crée un calque ; un
calque de texte sans sélection applique le style. Les boutons Insérer/Aligner
restent accessibles. Les thèmes personnalisés sont conservés ; le thème de base
du panneau est sombre. Les mises à jour CEP sont désactivées pour éviter qu'elles
remplacent cette adaptation UXP.

## Limites connues

- Photoshop 26.0 ou plus est requis (`manifest.json`), avec l'API UXP v2.
- L'export/import des styles, dossiers et réglages se fait en JSON par les
  sélecteurs UXP. L'export **avec les fichiers de police** (`.zip`) est masqué :
  il lit les dossiers de polices du système, que le bac à sable UXP interdit.
  L'installation de polices et le lecteur de polices dépendent aussi de Node ou
  du réseau, et le paquet n'autorise aucun domaine externe.
- Les mises à jour automatiques CEP sont désactivées : un paquet UXP se remplace
  en installant une nouvelle version.
- Lecture des polices d'un PSD et entraînement du profil de texte : les fichiers
  passent par les sélecteurs UXP et sont transmis au panneau par jeton persistant.
  Une police installée pendant la session n'apparaît qu'après un redémarrage de
  Photoshop, et l'ouverture d'un PSD dont une police manque peut encore afficher
  l'alerte de Photoshop (UXP ne permet pas de la supprimer).
- Le profil de bulle reconstruit pendant ces scans ne conserve que le rectangle de
  la baguette magique, pas le contour : UXP n'expose pas l'échantillonnage de
  tracé. L'ajustement se rabat alors sur un rectangle, sans blocage.

## Construire et vérifier

```sh
npm ci --ignore-scripts
npm run test:uxp
npm run package:uxp
```

Le dossier `uxp/` et le CCX sont générés. Modifier les sources dans `uxp-src/` et
`app_src/`, puis reconstruire. La compilation CEP d'origine reste disponible.

Vérifications effectuées le 18 septembre 2026 : compilation UXP et 96 tests
automatiques (`uxp-src/*.test.js`) sur un Photoshop simulé — conversion des
styles/unités/couleurs, markdown et Unicode, conservation de la géométrie, échec et
retour arrière, refus des sélections d'une autre page, ouverture de la sélection au
centrage (rayon adapté, repli, suppression du canal temporaire), style sans texte,
application groupée à plusieurs calques, instantanés et formes de bulle, lecture des
polices d'un PSD, contour dupliqué et correspondance entre les chemins de stockage du
panneau et les fichiers du dossier de données.

Le panneau ne charge l'application qu'après la réponse de l'hôte à `init` :
`optimization.concatenateModules` reste donc désactivé dans
`webpack.uxp.config.js`. Activé, webpack replie ce `require` dans le corps de
l'entrée, l'application est évaluée avant `init`, et le panneau reste sur
« Chargement… » sans que rien n'apparaisse nulle part. Le panneau signale
maintenant ses propres erreurs à l'hôte (`uxp-src/panel.html`) : la console du
webview n'est pas reprise dans le journal UXP, c'est le seul moyen de les voir.

Le script s'affiche en trois couches superposées — les lignes surlignées, la zone
de texte et le calque qui dessine les glyphes — qui doivent partager exactement la
même boîte : 50 px de gouttière à gauche, 20 px à droite, 17 px par ligne. Chromium
rattrape de lui-même la largeur d'une zone de texte à 100 % qui déborde de ses
marges, le moteur du panneau ne le fait pas : sans les largeurs et les hauteurs
fixées en fin de `app_src/components/textBlock/textBlock.scss`, le texte se décale
par rapport à ses surlignages et la zone de saisie n'a plus la même mise en page
que le texte affiché.

La baguette magique et la lecture du contour n'existent qu'à un seul endroit
(`uxp-src/photoshop.js`) : c'est la commande dont l'orthographe exacte n'a jamais
été confirmée par un vrai Photoshop, et elle ne doit pas être devinée à deux
endroits.

### Vérification dans Photoshop

`validation/native-smoke-body.js` assemble un script UXP autonome (`native-smoke.psjs`)
à partir des modules de production `uxp-src/photoshop.js` et `uxp-src/text-style.js` :

```sh
node validation/build-native-smoke.js
```

Ce script s'exécute dans Photoshop (script UXP, par l'UXP Developer Tool). Il crée un
document neuf, écrit `validation/native-smoke-result.json` avec le détail de chaque
contrôle, puis enregistre `validation/native-smoke.psd`. Il vérifie notamment :

- texte de paragraphe et texte ponctuel créés dans une sélection, contour appliqué ;
- style capturé puis réappliqué, taille de police modifiée ;
- **changement de police sur un calque existant** : le texte du calque est conservé ;
- **centrage** sur une sélection rectangulaire, et sur une bulle à queue : la queue est
  coupée, donc le centre tombe sur la bulle et non sur la boîte englobante ;
- **canal temporaire supprimé** : aucun canal `__TyperSelectionTemp__` ne reste ;
- sélection d'une autre page refusée sans effet sur le document.

**La validation complète dans Photoshop reste nécessaire.** L'automatisation de
l'interface Photoshop a cessé de répondre pendant la session. L'utilisateur a
confirmé que Photoshop lui-même fonctionne. La sonde initiale du pont ExtendScript
a renvoyé une annulation ; cette solution a été abandonnée et n'est pas incluse
dans le portage UXP. Les descripteurs `store`/`save` et `contract`/`expand` du
centrage n'ont encore jamais été exécutés par un vrai Photoshop : c'est le point
à contrôler en premier, et le repli sur l'ancien calcul limite les dégâts s'ils
sont refusés.

Avant de travailler sur un PSD original, valider sur une copie : insertion de texte
ponctuel et de paragraphe, centrage avec sélection et détection automatique de bulle,
copie/application d'un style avec contour, augmentation de taille/interligne,
markdown, sélections multiples, changement de page, import/export et redémarrage.
Les tests utilisant un hôte simulé ne prouvent pas la bonne exécution des commandes
actionJSON dans Photoshop.

Références :
- [Adobe : extensions sur Apple Silicon](https://helpx.adobe.com/download-install/apps/system-requirements/install-plug-ins-extensions-on-mac-apple-silicon.html)
- [Adobe : WebView locale UXP](https://developer.adobe.com/photoshop/uxp/2022/uxp/reference-js/Global%20Members/HTML%20Elements/HTMLWebViewElement/)
- [Adobe : API de sélection](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/classes/selection)
- [Adobe : transactions et historique](https://developer.adobe.com/photoshop/uxp/2022/ps-reference/media/executeasmodal)

Licence des sources TypeR : voir `LICENSE.md`. La bibliothèque JAM/ExtendScript
du dépôt d'origine n'est pas embarquée dans le paquet UXP.
