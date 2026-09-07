---
name: typer-typeset
description: Typeset autonome de pages de manga, BD ou webtoon dans Photoshop via les tools MCP typer_*. À utiliser pour détecter les bulles, associer le TextBlock, comparer visuellement les polices installées, choisir les styles, lancer TextShapeR, coller et centrer le texte, corriger les calques, sauvegarder et enchaîner les pages avec TypeR.
---

# Typeset autonome avec TypeR

Pilote TypeR uniquement avec les tools MCP `typer_*`. Termine chaque page avec un minimum d'intervention humaine, tout en gardant les opérations observables et réversibles.

## Démarrage

1. Appelle `typer_status`. Si le bridge est indisponible, demande à l'utilisateur d'ouvrir Photoshop et d'afficher le panneau TypeR.
2. Appelle `typer_get_state`, `typer_get_document` et `typer_get_styles`. Conserve le TextBlock déjà chargé.
3. Utilise `typer_set_script` uniquement si l'utilisateur fournit un nouveau script ou si TypeR n'a aucun script exploitable.

## Boucle par page

1. Appelle `typer_get_page_image`, puis `typer_detect_bubbles`. Utilise l'ordre RTL pour un manga, sauf indication contraire.
2. Compare les bulles visibles, les détections et les lignes. Exclue cases blanches, gouttières, SFX et textes déjà présents.
3. Associe chaque bulle à un `lineIndex`. Le préfixe/style de la ligne prime. Sinon, choisis un style existant selon son rôle, son dossier et sa police.
4. Si aucun style ne convient, appelle `typer_search_fonts`, garde 4 à 12 candidats crédibles, puis appelle `typer_preview_fonts` avec une vraie réplique de la bulle. Compare la planche rendue avant de créer le style avec l'exact `fontPostScriptName` choisi via `typer_save_style`.
5. Pour chaque bulle, appelle `typer_preview_text_shapes` avec ses vrais `bounds`, son `styleId` et sa réplique. Compare les variantes dans la vraie police sur le recadrage de la page. Choisis une carte sans débordement rouge, puis récupère exactement son `variants[index].text` dans les métadonnées.
6. Appelle `typer_typeset_bubbles` avec `dryRun: true`, le texte choisi et `autoShape: false`. Vérifie ordre, texte et bounds, puis applique le même batch sans `dryRun`.
7. Appelle `typer_get_layers`, puis `typer_get_page_image`. Vérifie débordement, collision, silhouette, police/style, centrage optique, bulles oubliées et doublons. Compare aussi toutes les bulles de dialogue courant : leur taille apparente doit rester harmonieuse à l'échelle de la page.
8. Corrige forme et style avec `typer_edit_layer` ou `typer_shape_text`. Si le centrage automatique est raté, appelle d'abord `typer_align` avec le `layerId` exact et les bounds de la bulle, puis regarde de nouveau la page. Si le texte reste visuellement décentré à cause d'une forme irrégulière ou d'une queue, utilise `typer_nudge_layer` avec le même `layerId` et de petits `deltaX`/`deltaY`, puis contrôle encore l'image. Modifie la taille avec `typer_change_text_size` ciblé seulement si nécessaire et recentre après chaque changement. Utilise `typer_undo` si la correction dégrade le résultat ou si tout le batch est faux.
9. Appelle `typer_save_document` seulement après validation visuelle.
10. Appelle `typer_next_page`, puis recommence.

## Choix visuel des polices

- Ne choisis jamais une nouvelle police uniquement d'après son nom ou ses métadonnées.
- Prévisualise le texte réel, avec accents, ponctuation, casse et chiffres pertinents. Active `uppercase` seulement si le résultat final sera en capitales.
- Compare la voix graphique, la graisse, la chasse, la hauteur d'œil, la lisibilité à l'échelle de la bulle, les signes de ponctuation et la cohérence avec les pages voisines.
- Pour cri, murmure, narration, téléphone/radio ou SFX, utilise un échantillon correspondant au rôle.
- Réutilise un style de projet cohérent avant d'inventer une nouvelle police.
- Considère les scores TextShapeR et `fits` comme des indices. La planche `typer_preview_text_shapes` décide de l'équilibre optique ; applique ensuite les retours à la ligne exacts des métadonnées et vérifie le résultat sur la page.
- Le centrage automatique est une première passe. Vérifie le centrage optique dans le corps principal de la bulle, sans te laisser tromper par la queue ou des blancs irréguliers. Après une édition ou un changement de taille, utilise `typer_align`, puis `typer_nudge_layer` par petits déplacements si le résultat reste visiblement décentré.

## Harmonie des tailles

- Traite la taille du texte comme un système cohérent à l'échelle de la page et du chapitre, pas comme un réglage indépendant pour remplir chaque bulle.
- Définis une taille de référence pour le dialogue courant à partir du style du projet et des pages voisines. Maintiens les bulles comparables dans une plage visuelle étroite et régulière.
- Juge la taille sur la page entière : le texte doit être confortablement lisible sans dominer le dessin, paraître trop gros ou trop petit, ni remplir artificiellement tout l'espace. Conserve un blanc intérieur équilibré.
- Ne grossis pas une réplique courte pour remplir sa bulle et ne réduis pas une longue réplique uniquement pour la faire rentrer. Essaie d'abord une meilleure variante TextShapeR, corrige les bounds ou le padding, puis recentre.
- Utilise `typer_change_text_size` seulement si ces corrections ne suffisent pas, avec de petits ajustements intentionnels. Évite d'empiler des variations arbitraires d'une bulle à l'autre.
- Avant la sauvegarde, compare ensemble toutes les bulles de dialogue courant et corrige les écarts accidentels. Le bold ou l'emphase peut volontairement sortir de la taille de référence lorsque le script ou le style le demande ; cette exception doit rester intentionnelle, maîtrisée et lisible.

## Critères de fin

Une page est terminée lorsque chaque bulle attendue possède le bon texte, dans le bon ordre et le bon style, que la police a été validée visuellement lorsqu'elle est nouvelle, que les lignes restent dans la bulle, que les tailles de dialogue courant sont harmonisées (hors bold/emphase volontaire), que les calques sont centrés optiquement après correction manuelle si nécessaire et que le PSD est sauvegardé.


## MCP v2: measured composition and recovery

- Read `typer_get_document` first. Pass its `documentId` to every document write and preferably every document read. Keep `expectedDocumentKey` when continuing a session.
- Assign a unique `requestId` to each mutation. Retry only with the identical ID and arguments. On a timeout, query `typer_get_operation`; pending/interrupted/failed outcomes are not permission to blindly create another batch.
- Use `typer_get_region_image` for detail. Canvas contact sheets are estimates. Use `typer_measure_text` or `typer_fit_text` to measure candidates in real Photoshop before applying them. Copy the returned exact text and typography into batch entries with `autoShape:false`.
- A fit is a rectangular bound check; inspect the bubble contour, tails, emphasis and optical balance yourself. Text must remain faithful to the script. Fit results never authorize rewriting dialogue.
- Batch results contain stable `layerId` values and automatically persist associations for entries with `lineIndex`. Review with `typer_review_page`, then inspect image crops. Missing links are reported as missing dialogue; associate pre-existing text using `typer_set_progress`.
- `typer_edit_layer` accepts absolute point sizes, leading, tracking, scales, baseline shift, outline and UTF-16 text ranges. `typer_capture_style` can copy a reference layer. `typer_transform_layer` handles rotation, paragraph boxes and editable warps.
- Use `typer_manage_layers` for explicit group/layer changes, `typer_set_page_mapping` for chapter inputs, and `typer_manage_tabs` for script tabs. `typer_edit_script_lines` requires the script revision from `get_state`.
- Undo the exact operation using `typer_undo` and its `operationId`. Newer Photoshop edits block undo rather than discarding them. Panel reloads preserve request results but invalidate host checkpoints.
- Save layered PSDs with `typer_save_document`, export delivery images with `typer_export_page`, then navigate. MCP navigation keeps existing documents open; save them explicitly.
- Train with `typer_learning` only from explicitly validated links, never from unreviewed AI output. A changed script or layer invalidates that validation.
