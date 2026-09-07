# Audit du MCP TypeR pour le typesetting par une IA

Date : 7 septembre 2026. Base inspectée : `feature/typer-mcp`, commit `ef06a62`.

Suite de cet audit : la version mise en œuvre est décrite dans
[AI_TYPESETTING_V2.md](AI_TYPESETTING_V2.md), avec 47 outils et les validations
sur Photoshop. Les constats ci-dessous sont conservés comme état initial.

Cet audit distingue les fonctions existantes, les défauts observables dans le code et les extensions proposées. Les opérations Photoshop n'ont pas été testées sur un vrai PSD pendant cet audit. Aucun outil proposé ci-dessous n'est encore implémenté.

## État actuel

Les deux serveurs, `mcp/server.js` et `plugins/typer/mcp/server.mjs`, annoncent les mêmes **31 outils**. L'IA peut lire le script, changer de ligne, consulter et créer des styles, rechercher et comparer des polices, voir la page, détecter des bulles, comparer des variantes TextShapeR, créer un lot, sélectionner et retoucher un calque, ajuster la taille et le centrage, naviguer et enregistrer un PSD.

Cette base couvre une première passe sur des bulles de dialogue. Pour terminer une page de façon autonome, il manque surtout une mesure fiable du résultat dans Photoshop, une correspondance persistante entre script et calques et une récupération fiable après erreur.

La branche diverge de `develop` : 25 commits propres à `develop`, 4 propres à cette branche, selon les références locales inspectées. Avant les ajouts, intégrer les corrections pertinentes, notamment `1d368f7` (lots liés au document et retour arrière en cas d'échec), `11af4db` (préservation de l'historique pendant les scans), ainsi que l'apprentissage TextShapeR récent. Vérifier ensuite que le pont MCP transmet les nouveaux paramètres requis par le host.

## Défauts à traiter avant d'augmenter l'autonomie

| Priorité | Constat dans le code | Conséquence et correction attendue |
| --- | --- | --- |
| P0 | `undoLastTyperChange()` recherche uniquement `TyperTools Change`. Les lots créent `TyperTools Multiple Paste`, les déplacements `TyperTools Optical Center`. | `typer_undo` peut échouer ou revenir avant une ancienne modification au lieu d'annuler précisément le dernier lot. Utiliser des opérations identifiées et restaurer aussi le curseur et les associations de lignes. |
| P0 | `buildPasteEntries()` et `assignLinesToBubbles()` consomment les prochaines lignes non ignorées sans frontière de page. | Un surplus de bulles peut recevoir les dialogues de la page suivante. Déterminer les limites de la page et refuser une consommation hors page par défaut. |
| P0 | Les écritures ciblent le document actif, sans précondition `documentId`. `open_image` annonce le chemin avant de recevoir le résultat de `openFile`; les changements de page attendent seulement l'état React. | Une navigation échouée ou un changement de document peut laisser l'IA travailler sur le mauvais PSD. Attendre le host et vérifier l'identité du document avant toute écriture. |
| P0 | Une erreur dans `_createTextLayersInStoredSelections()` arrête la boucle sans retirer les calques déjà créés. Aucun identifiant de requête ni registre de résultat n'est conservé. | Après un échec partiel ou un timeout, rejouer le lot peut créer des doublons. Restaurer l'état précédent ou retourner un bilan précis, avec une clé de requête empêchant de rejouer une écriture déjà réalisée. |
| P1 | Les résultats de création contiennent les placements, mais pas les `layerId` créés. | L'IA doit retrouver les calques par heuristique. Retourner directement `documentId`, `layerId`, `lineIndex`, style, texte et limites rendues pour chaque entrée. |
| P1 | `getAllRenderedTextLines()` limite la collecte à 80 calques; le wrapper transforme une erreur de lecture en liste vide. | Une relecture peut être incomplète sans le signaler. Ajouter pagination, nombre total, indicateur de troncature et erreurs explicites. |
| P1 | Les aperçus TextShapeR dessinent dans un canvas : taille en pixels, interligne simplifié, suppression du Markdown, centrage uniforme. `fits` repose sur la largeur des lignes et ne valide pas leur débordement vertical. | Un aperçu jugé correct peut différer du PSD. Le qualifier d'estimation, puis proposer un aperçu et des mesures calculés par Photoshop avec le style complet et la résolution du document. |
| P1 | Le pont accepte `shapeProfile` dans les entrées de lot et `bounds` dans `edit_layer`, mais les schémas publics ne les exposent pas. | L'IA ne peut pas exploiter toutes les capacités existantes. Partager un contrat unique entre les deux serveurs et le pont, avec validation effective des arguments. |

Références principales : `app_src/mcpBridge.jsx`, `app_src/host.js`, `app_src/utils.js`, `app_src/bubbleDetection.js`, `app_src/textShapeContactSheet.js` et les deux serveurs MCP.

## Outils à ajouter ou à enrichir

Les noms suivants sont des propositions. Les options proches doivent enrichir les outils existants pour garder un catalogue compréhensible.

### 1. Voir précisément et mesurer le rendu

- **`typer_get_region_image`** : recadrage d'une bulle ou d'un calque à la résolution utile, marge configurable, coordonnées de correspondance et annotations optionnelles. Éviter d'exporter toute la page pour chaque retouche, notamment sur les longs webtoons.
- **`typer_measure_text`** : rendu temporaire dans Photoshop avec la police, les attributs et la résolution réels; retour des limites, lignes rendues, débordements horizontaux et verticaux, marges par rapport au contour et éventuelle substitution de police. Le document d'origine et son historique doivent rester intacts.
- **`typer_fit_text`** : chercher une composition dans des contraintes explicites : taille minimale/maximale, interligne, marge, césure, nombre de lignes. Retourner quelques candidats mesurés et un motif d'échec si aucun ne respecte les contraintes. Ne pas réduire le texte sans limite ni réécrire la traduction pour le faire entrer.

### 2. Donner un contrôle typographique complet

Enrichir `typer_save_style` et `typer_edit_layer` : taille absolue, interligne automatique ou fixe, approche, échelles horizontale/verticale, décalage de ligne de base, direction, couleur, contour et attributs par portion de texte. Distinguer les unités et permettre une surcharge locale sans modifier le style partagé.

Ajouter **`typer_capture_style`** pour récupérer le style d'un calque existant, puis permettre la gestion des préfixes, dossiers et rôles de styles. C'est essentiel pour reproduire une charte déjà présente dans un chapitre.

### 3. Corriger la géométrie et traiter les SFX

- Enrichir les outils de bulle : contour ou sélection polygonale, point intérieur à échantillonner, exclusion de la queue, ajout d'une bulle manquée, séparation/fusion et ordre explicite. Les identifiants doivent être liés au document et au scan.
- **`typer_transform_layer`** : position absolue, rotation, boîte de texte et échelle, avec rendu de contrôle. Les outils actuels de centrage et de déplacement ne suffisent pas pour une onomatopée inclinée.
- Dans une seconde étape, exposer une déformation de texte contrôlée et des effets de calque pour les SFX. Préserver l'éditabilité quand Photoshop le permet.

### 4. Organiser une page et un chapitre

- **`typer_manage_layers`** : inspecter l'arborescence complète, créer un groupe de typesetting, renommer, déplacer, dupliquer, masquer et supprimer des calques explicitement ciblés. Les calques cachés et les groupes doivent être visibles dans l'inventaire.
- **`typer_set_page_mapping`** et gestion des onglets : importer la liste de PSD, associer explicitement les pages, choisir l'onglet du script et connaître la plage de lignes de chaque page.
- Permettre d'éditer une ligne ou une plage de script avec précondition de version, sans remplacer tout le script.
- Conserver dans le stockage existant une association page/bulle/ligne/calque et des états « à poser », « posé », « à revoir », « validé ». Une reprise doit détecter les éléments supprimés ou modifiés manuellement.

### 5. Contrôler et reprendre le travail

- **`typer_review_page`** : vérifier les lignes manquantes ou dupliquées, la fidélité du texte au script, les débordements, les collisions, les polices substituées et les tailles incohérentes. Retourner des problèmes localisés avec calque, ligne, mesure et recadrage. Les jugements esthétiques et l'ordre narratif restent à confirmer visuellement par l'IA.
- **`typer_get_operation`** et annulation par identifiant : connaître le résultat réel après timeout, annuler un lot précis et éviter sa duplication.
- **`typer_export_pages`** : exporter les rendus de livraison sans perdre le PSD éditable; rapport par fichier et sauvegarde du travail avant navigation.

### 6. Exploiter les corrections validées

Exposer l'apprentissage TextShapeR de `develop` : obtenir les préférences d'un projet, proposer des exemples issus de calques et apprendre uniquement à partir de compositions explicitement validées. L'IA ne doit pas renforcer automatiquement ses propres sorties non relues.

Le nettoyage de texte source peut venir ensuite si l'objectif inclut aussi le clean : travail sur un calque séparé, zone explicite, aperçu avant/après. La détection de bulles actuelle ne constitue pas un outil de nettoyage ni une preuve que la bulle est vide.

## Ordre de réalisation conseillé

1. Intégrer les correctifs de `develop`, fiabiliser document, pages, annulation, lots et retours de calques; unifier les contrats MCP.
2. Ajouter recadrages, mesures Photoshop, ajustement sous contraintes et revue de page. C'est le plus grand gain pour terminer une page avec peu d'interventions.
3. Enrichir typographie, styles, géométrie et organisation des calques; ajouter rotation et effets pour les SFX.
4. Ajouter reprise de chapitre, exports et apprentissage des corrections validées.

Boucle cible : lire la page et son script → vérifier les correspondances → composer et mesurer → appliquer un lot identifié → revoir le rendu réel → corriger les calques ciblés → sauvegarder et avancer.

## Validation effectuée

- `npm test` : réussi.
- `npm test --prefix mcp` : réussi après installation des dépendances propres au serveur avec `npm ci --prefix mcp --no-audit --no-fund`.
- Même smoke test exécuté contre `plugins/typer/mcp/server.mjs` : réussi; les 31 outils attendus sont annoncés.
- `npm run build` : réussi, avec trois avertissements webpack de performance.

Les smoke tests vérifient la connexion MCP, la présence des outils, certaines options et un appel `status` contre un faux pont HTTP. Ils ne prouvent pas le fonctionnement des écritures, de l'annulation ou des aperçus dans Photoshop. Pour la suite, ajouter des tests du pont avec host simulé pour erreurs partielles et frontières de pages, puis un scénario sur PSD couvrant création, mesure, correction, annulation et sauvegarde.
