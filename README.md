# WikiDex v0.11.3

## Progression en direct du scan du marché

Le scanner affiche maintenant son avancement pendant la pagination de l’API marketplace.

Comme l’API fournit `hasMore` mais pas le nombre total de pages, WikiDex n’affiche pas un faux pourcentage.
Il affiche à la place des informations réelles :

- bloc / page en cours ;
- nombre d’enchères déjà lues ;
- nombre de correspondances avec la wishlist ;
- temps écoulé ;
- retry HTTP en cours ;
- découpage automatique 50 → 25 → 5 en cas d’erreur serveur ;
- nombre de segments éventuellement ignorés.

Une barre animée indique que le scan est toujours actif.

La logique de scan robuste de la v0.11.2 reste inchangée.
