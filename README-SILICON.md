# TypeR Silicon

Portage local de TypeR 3.0.0 vers UXP, destiné à Photoshop récent sur Apple Silicon.
Sources de départ : `ScanR/TypeR`, branche `develop`, commit `fc73244`.
Cette adaptation n'est pas une version officielle de ScanR.

## Nouveautés 3.0.6 (TextShapeR : modèle de découpage structuré)

- **Apprend sur tous les découpages possibles** : quand tu valides une forme, TextShapeR ne la compare plus seulement aux 5 propositions affichées, mais à toutes les façons possibles de couper ce texte (méthode « programmation dynamique différentiable », Mensch & Blondel, arXiv:1802.03676). Une seule correction en apprend donc beaucoup plus.
- **Bien meilleur dès les premières corrections** : sur le banc d'essai, après 3 corrections, la bonne forme arrive en tête 41 % du temps au lieu de 34 %, et après 5 corrections 44 % au lieu de 32 %. Après un chapitre, 56 % au lieu de 51 %.
- **Suit toujours les changements de style** : le modèle choisit seul entre une mémoire courte et une mémoire longue, selon ce qui prédit le mieux tes dernières corrections.
- **Vitesse** : les propositions restent à environ 1,5 ms. L'apprentissage après une validation prend environ 0,1 s. L'import de PSD n'entraîne le modèle qu'une fois à la fin.
- **Compatibilité** : les apprentissages existants sont repris ; le nouveau modèle se construit à partir de la mémoire déjà enregistrée dès la prochaine validation.

## Nouveautés 3.0.5 (TextShapeR : nouveau moteur d'apprentissage)

- **Apprentissage plus prudent puis plus sûr de lui** : TextShapeR mesure combien il a de preuves. Après une ou deux corrections il reste proche des réglages de base ; après un chapitre il suit vraiment ton style.
- **Suit les changements de style** : TextShapeR vérifie seul s'il vaut mieux se fier à tes dernières corrections ou à tout l'historique. Après un changement de style, il s'adapte bien plus vite.
- **Mémoire mieux utilisée** : la ressemblance avec tes formes déjà validées n'est plus un bonus fixe. Son poids est appris comme le reste.
- **Compatibilité** : les apprentissages existants sont repris automatiquement, rien n'est perdu. La vitesse ne change pas (environ 1,5 ms par proposition).

## Nouveautés 3.0.4

- **Taille +/-** : le cadre du texte s'agrandit avec la taille, le texte ne disparaît plus et ne casse plus la forme. Le calque reste centré sur sa position.
- **TextShapeR garde la taille** : appliquer une forme conserve la taille, l'interligne et la police du calque. Seul le découpage change.
- **TextShapeR : importer des PSD** : choisir des PSD lance l'analyse puis l'apprentissage automatiquement (option cochée par défaut). Idéal : un chapitre, soit 15 à 20 pages.
- **Édition Legacy (CEP)** : centrage automatique (simple et multi-bulles), « Centrer double bulle » et agrandissement du cadre portés dans l'ancienne édition.
- **Installateurs** : choix entre l'édition UXP (récente, recommandée, Photoshop 2025 et plus) et l'édition Legacy (CEP) pour les anciennes versions de Photoshop.
- **Fiabilité** : file de tâches qui ne se bloque plus après une erreur d'ouverture, renommage d'onglet (Échap annule), migration de profil sans perte, scan de polices sans double exécution, hauteur du panneau bornée. 93 textes de traduction inutilisés retirés.

## Nouveautés 3.0.3 (revue qualité)

- **Raccourcis plus fiables** : un deuxième appui rapide n'est plus perdu pendant le délai de répétition, il s'exécute à la fin du délai. Un raccourci défini à la fois dans TypeR et sur l'action Photoshop ne s'exécute plus deux fois. Un raccourci ne reste plus muet après une boîte de dialogue ou une saisie dans le panneau. Les appuis très brefs sont captés (état maintenu 150 ms). Si l'assistant clavier meurt, plus aucune touche ne reste « coincée » au-delà de 2,5 s. L'assistant vérifie qu'il surveille bien Photoshop, et il ne tue plus un processus à partir d'un ancien fichier pid.
- **« Garder la taille du texte »** : la taille reprise est celle affichée sur le calque actif. Sans calque de texte actif, un message clair s'affiche et rien n'est créé. La mise à jour d'un ou plusieurs calques garde aussi leur taille.
- **Sélections mémorisées (multi-bulles)** : textes et sélections sont associés un à un, les textes vides sont ignorés, toutes les sélections sont vérifiées avant toute création, et chaque texte garde son style, son mode (point ou paragraphe) et sa mise en forme.
- **Centrage** : la sélection tracée est capturée avant le passage de la baguette. Le centrage automatique ne déplace plus de calque verrouillé, et un échec isolé n'arrête plus les autres textes.
- **TextShapeR** : l'apprentissage est plus stable (pondération régularisée, indépendante de l'ordre des exemples). Sur un banc d'essai sur textes non vus, le bon découpage est trouvé en premier 45 % du temps au lieu de 36 % après 20 exemples. Les profils enregistrés restent compatibles.
- **Panneau** : correction de minuteurs bloqués (astuce multi-bulles), d'une fuite d'écouteurs dans l'éditeur d'arrière-plan et d'un gel possible de l'aperçu. Valeurs de centrage automatique importées vérifiées. Code mort retiré.

## Nouveautés 3.0.2

- **Barre contextuelle qui clignote** : le repli ScriptUI (une lecture du clavier par JSX toutes les 80 ms) se déclenchait à tort, après une fausse détection de blocage de l'assistant clavier ou une erreur « modal state » au démarrage. Il faisait se rafraîchir la barre contextuelle en boucle. L'assistant draine maintenant sa boucle d'événements à chaque tour, s'arrête seulement quand Photoshop quitte (via son pid), et l'ancien assistant est tué avant d'en relancer un. Le panneau relance l'assistant avec un délai croissant (2 s, 5 s, 10 s, 30 s). Il ne passe sur ScriptUI que si l'assistant n'a jamais répondu après 4 lancements, et il continue d'essayer l'assistant ensuite.
- **Centrage automatique à la pose** : réglage « Centrage automatique » (Positionnement du texte), et troisième indicateur en bas à droite du panneau. Chaque clic fait OFF → ON (chaque texte centré dans sa bulle) → MULTI (bulles simples et doubles bulles reconnues) → OFF. En MULTI, si un texte partage sa bulle avec un autre (posé en même temps ou déjà sur la page), la bulle est coupée entre eux et chaque texte est centré dans sa partie. Le texte voisin est alors recentré lui aussi. Le centrage fait partie de la même étape d'historique que la pose (un seul Ctrl+Z). Si aucune bulle n'est trouvée, le texte reste là où il a été posé. Le raccourci « Cycler le centrage automatique » est disponible, sans touche par défaut.

## Nouveautés 3.0.1

- **Centrage** : la bulle détectée à la baguette doit maintenant contenir le centre du texte, rester d'une taille plausible et ne pas englober le centre d'un autre texte sélectionné. Sinon TypeR essaie un autre point de sonde ou garde la plus petite bulle valide. Une sélection manuelle n'est utilisée que pour les calques dont elle contient le centre.
- **Taille (+/-)** : le pas s'applique à la taille affichée (taille × transformation du calque), et non plus à la taille stockée. Les calques redimensionnés ne retombent donc plus à 5 px. Les tailles mixtes sont mises à l'échelle proportionnellement, et le cadre des textes de paragraphe suit.
- **Raccourcis** : l'assistant clavier écrit son état de façon atomique avec un battement régulier. Le panneau le relance s'il se fige (3 fois au maximum, puis il bascule sur ScriptUI). L'état clavier est aussi transmis directement au panneau quand l'utilisateur n'est pas en train d'écrire dedans.
- **Centrer double bulle** (nouvelle commande) : sélectionne un calque de texte par lobe (au moins 2), avec si besoin une sélection autour de la bulle entière, puis lance la commande. Chaque texte est centré dans son lobe. Aucun raccourci n'est attribué par défaut : choisis-en un dans les réglages des raccourcis, ou utilise l'action Photoshop « TypeR Centrer double bulle ».

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
  partie de la zone de texte. La version CEP garait la sélection dans un canal
  temporaire pour pouvoir la recharger entre deux essais : UXP n'expose pas les
  canaux, et les deux commandes qui tenaient ce rôle n'existent pas dans Photoshop —
  elles déclenchaient « The command "<unknown>" is not currently available », puis une
  boîte « Enregistrer sous » sur le document de l'utilisateur. Un nouvel essai relance
  donc la commande qui a produit la sélection (la baguette magique au même point) ;
  une sélection dessinée à la main, que rien ne peut remettre en place, n'est tentée
  qu'une fois. Si l'ouverture échoue, le centrage se rabat sur l'ancien calcul.
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

Vérifications effectuées le 18 septembre 2026 : compilation UXP et 97 tests
automatiques (`uxp-src/*.test.js`) sur un Photoshop simulé — conversion des
styles/unités/couleurs, markdown et Unicode, conservation de la géométrie, échec et
retour arrière, refus des sélections d'une autre page, ouverture de la sélection au
centrage (rayon adapté, nouvel essai après réarmement par la baguette, repli), style
sans texte, application groupée à plusieurs calques, instantanés et formes de bulle,
lecture des polices d'un PSD, contour dupliqué et correspondance entre les chemins de
stockage du panneau et les fichiers du dossier de données.

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

Le nom de propriété que Photoshop attend pour la sélection, la conversion
point/paragraphe d'un calque de texte et l'ouverture de la sélection n'existent
qu'à un seul endroit (`uxp-src/photoshop.js`, plus `uxp-src/textshaper.js` pour
la lecture des lignes). Les quatre-char ID du ScriptListener (`fsel`, `TxtT`,
`Cntc`) ne sont pas des noms que la couche JSON sait résoudre : une variante
essayée « au cas où » ne coûte pas un essai de plus mais une alerte Photoshop
(« The command "Set" is not currently available ») que ni `try/catch` ni
`dialogOptions` ne peuvent masquer. Chaque commande est donc écrite avec le nom
mesuré, une seule fois.

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
- **aucun canal créé** : le centrage laisse la liste des canaux telle quelle ;
- sélection d'une autre page refusée sans effet sur le document.

**La validation complète dans Photoshop reste nécessaire.** L'automatisation de
l'interface Photoshop a cessé de répondre pendant la session. L'utilisateur a
confirmé que Photoshop lui-même fonctionne. La sonde initiale du pont ExtendScript
a renvoyé une annulation ; cette solution a été abandonnée et n'est pas incluse
dans le portage UXP.

Le centrage a depuis été exercé sur un vrai Photoshop. Les journaux de l'utilisateur
y montrent la baguette magique et la lecture de la sélection réussir (nom `selection`),
la conversion point/paragraphe s'exécuter sans erreur, et la paire `store`/`save` qui
gardait la sélection dans un canal être refusée : alerte « command not available »,
puis « Enregistrer sous » sur le document de l'utilisateur, puis `-128` — c'est ce
repli sur l'ancien calcul qui limitait les dégâts. Cette paire a été retirée : plus
aucune commande ne sauvegarde le document ni ne touche un canal.

Restent à confirmer par une exécution : `contract`/`expand` (l'ouverture de la
sélection) et la conversion point/paragraphe quand le panneau insère un texte
ponctuel. Le repli sur l'ancien calcul couvre le premier ; une alerte Photoshop
signalerait le second.

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
