# Audit avant sortie TypeR 3.0, 26 octobre 2026

Audit du code partagé, des imports/exports, du stockage, des profils, du collage intelligent, des adaptateurs CEP/UXP et de la chaîne de build. Les modifications déjà présentes au début de l’audit, notamment le parcours « nouveautés », ont été conservées. Aucun commit, installation dans Photoshop ou publication n’a été effectué.

## Corrections apportées

| ID | Gravité | Déclencheur et défaut | Correction et preuve |
| --- | --- | --- | --- |
| A01 | Haute | Une confirmation native répond `EvalScript error.` : cette chaîne était considérée comme un accord, y compris pour effacer un profil. | Seule la réponse `1` confirme. Test des réponses positives, négatives et des erreurs dans `testReleaseAudit.js`. |
| A02 | Haute | Import d’une sauvegarde contenant des onglets pendant qu’un autre script est ouvert : le texte courant écrasait l’onglet importé avant sauvegarde. | Chargement de l’onglet importé avant synchronisation ; restauration du texte, des images et de la position ; suppression des sélections de l’ancien document. Tests du reducer, y compris identifiant absent et ancien format. |
| A03 | Moyenne | Stockage avec `tabs: [null]`, identifiants dupliqués ou champs d’onglet invalides : démarrage bloqué ou navigation ambiguë. | Réparation des onglets, identifiants uniques et conservation des textes récupérables. Tests de récupération. Cette réparation ne prétend pas couvrir tous les champs d’un stockage arbitrairement endommagé. |
| A04 | Moyenne | Fichier `chapter.002.psd` importé avec `baseName: chapter.002` : une deuxième suppression d’extension effaçait `.002`. | Un nom déjà dépourvu d’extension reste intact. Test de correspondance numérique. |
| A05 | Moyenne | Export des paramètres du profil actif : les options Smart Paste et Refont étaient lues dans une sélection de contexte qui ne les contenait pas. | Les sept champs concernés sont transmis. Test du formulaire jusqu’au JSON effectivement écrit. |
| A06 | Moyenne | Configuration de disposition contenant deux fois `text` : plusieurs instances du même panneau pouvaient être rendues. | Déduplication de l’ordre avant ajout des panneaux manquants. Test de normalisation. |
| A07 | Moyenne | L’import de styles appelait `confirm()` directement dans le reducer React, sans passer par le dialogue hôte partagé. | Confirmation native asynchrone avant dispatch ; fusion pure qui conserve les styles locaux si demandé. Tests des conflits et des choix de fusion. L’affichage réel du dialogue UXP reste à vérifier dans Photoshop. |
| A08 | Haute | Changement/création/suppression du profil actif, import ou changement de langue : rechargement sans acquittement des écritures UXP. | Attente de la sauvegarde disque avant rechargement ; refus du rechargement en cas d’échec. Test avec une promesse disque retardée puis rejetée. |
| A09 | Haute | Une écriture UXP échoue, puis une autre réussit : l’erreur précédente disparaissait et `flush()` annonçait une réussite ; les suppressions échouées étaient également ignorées. | Suivi par fichier, nouvelle tentative à la vidange, rejet si l’échec persiste et contrôle des suppressions. Tests d’erreurs disque, de récupération et de remplacement d’une ancienne écriture échouée. |
| A10 | Moyenne | Nombreuses sauvegardes regroupées pendant un accès disque lent : les callbacks de résolution formaient une chaîne récursive. | Résolution itérative des attentes. Test de 20 000 écritures regroupées. |
| A11 | Haute | Collage intelligent de sélections mémorisées après passage à un autre PSD : le contrôle de document du collage classique était absent. | Transmission de `documentKey`, vérification avant rejeu et capture dans les deux hôtes ; aucune tentative classique après une erreur de document. Tests CEP, UXP et client. |
| A12 | Haute | Échec du rejeu ou du collage d’une bulle au milieu d’un lot : toutes les sélections mémorisées étaient effacées. | Arrêt sur échec et retrait des seules sélections réussies ; conservation des suivantes. Protection supplémentaire lors d’un changement d’onglet pendant le lot. Tests d’échec total, d’échec partiel et du reducer. |
| A13 | Moyenne | `npm audit` signalait `fast-uri` 3.1.8, dépendance transitive de développement. | Mise à jour ciblée vers 3.1.9 dans le lockfile ; aucune modification des dépendances directes. L’installation rapporte zéro vulnérabilité. |

Les changements du panneau sont partagés par CEP et UXP. Les contrôles Photoshop de Smart Paste ont leur équivalent dans `app_src/host.js` et `uxp-src/host/smartPaste.js`, qui porte ce moteur côté UXP.

## Points P1 corrigés le 27 octobre 2026

Ces trois points restaient ouverts à l’issue de l’audit. Leur correction est couverte par des tests simulés ; elle n’a pas été vérifiée dans Photoshop.

| ID | Défaut | Correction et preuve |
| --- | --- | --- |
| A14 | `uxp-src/host/evalScript.js` libérait la file après le délai, sans annuler la tâche native. Le collage intelligent (délai hôte de 60 s, contre 120 s côté client) répondait alors comme une erreur, et le client lançait le collage classique pendant que Photoshop pouvait encore terminer le premier. | La file reste sérialisée jusqu’à la fin réelle de l’appel en retard. Les appels qui attendent derrière lui reçoivent leur propre délai, et un appel expiré pendant l’attente ne s’exécute jamais. Le collage intelligent dispose de 2 minutes et répond `timeout` : le client affiche « Photoshop est encore occupé » et ne lance aucun collage classique, ni seul ni en multi-bulles. Tests : `testUxpHost.js` (file) et `testSmartPasteClient.js` (absence de repli). |
| A15 | `writeTextAtomic()` supprimait la destination avant le renommage sous Windows, puis l’écrivait directement si le renommage échouait. | L’original est déplacé à côté (`.old-*`), remis en place si le nouveau fichier ne peut pas le remplacer, et supprimé seulement après le remplacement. Un échec est signalé (le gestionnaire de sauvegardes réessaie puis prévient l’utilisateur), jamais écrit sur place. Au démarrage, `recoverInterruptedWrites()` restaure un original laissé à côté par un plantage et supprime les restes. Test : `testUxpStorageRecovery.js`, avec un renommage Windows qui refuse d’écraser et des pannes injectées. |
| A16 | `importCepStorage()` considérait la présence de `storage` ou de `storage_profiles` comme une migration terminée, même partielle. | Copie dans `.cep-import`, marqueur `.complete` écrit en dernier, puis déplacement dans le dossier de stockage. Une copie interrompue n’atteint pas ce dossier et sera refaite. Un déplacement interrompu sera terminé au démarrage suivant. Si le panneau a démarré son propre stockage après une copie interrompue, ce stockage est conservé. Test : `testUxpStorageRecovery.js`, avec une panne après chaque étape. |

Ces corrections concernent uniquement l’hôte UXP : CEP n’a pas de délai côté hôte, Node remplace les fichiers de façon atomique sous Windows, et la migration n’existe que dans UXP. Le code `timeout` est traité par le client partagé, mais seul l’hôte UXP le produit.

## Validation

- État initial : 51 suites réussies.
- Après corrections : 54 suites réussies, dont trois nouvelles suites ; tests Smart Paste et sécurité documentaire enrichis.
- `npm run test:uxp` réussi.
- Builds de production CEP et UXP réussis.
- `npm run test:build` réussi : artefacts, inventaire et compatibilité syntaxique ES5.
- Après mise à jour de la dépendance : `npm run verify` et nouveau build UXP exécutés pour valider le lockfile final.
- Webpack conserve des avertissements de taille/performance des bundles. Ils ne bloquent pas les builds et ne constituent pas une mesure de performance dans Photoshop.
- Aucune validation manuelle de cette révision dans Photoshop. Les tests hôtes utilisent des simulations ; ils ne prouvent pas le comportement de toutes les versions de Photoshop.
- Pas de capture : les corrections portent principalement sur les données, les erreurs et les opérations asynchrones ; une image du panneau existant ne démontrerait pas leur fonctionnement.

## Parcours manuels prioritaires

1. CEP et UXP, Windows et macOS : annuler puis accepter une suppression de profil ; simuler une erreur hôte et vérifier qu’aucune suppression n’est autorisée.
2. Importer une sauvegarde multi-onglets avec un script différent déjà ouvert ; redémarrer et comparer textes, positions et images.
3. Exporter/importer les préférences Smart Paste et Refont du profil actif et d’un profil inactif.
4. Changer de profil pendant une sauvegarde lente ; tester disque plein sans perdre le profil courant.
5. Capturer plusieurs bulles, changer manuellement de PSD, puis lancer le collage ; vérifier l’absence de calques dans le mauvais document.
6. Faire échouer la deuxième bulle d’un lot ; vérifier que seule la première est retirée, puis reprendre les suivantes.
7. Sur documents réels : collage, styles, centrage simple/double, annulation/rétablissement et session longue. Conserver aussi les portes de validation des anciennes versions CEP dans `release-3.0.0.md`.
