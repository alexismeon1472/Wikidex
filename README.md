# WikiDex v0.11.7

## Recherche ciblée des enchères par titre

Le flux global `/api/marketplace` ne contient pas toujours toutes les enchères actives.

WikiDex essaie maintenant automatiquement :

1. un filtre direct par `card_id` ;
2. si non supporté, une recherche texte du marché (`q`, `search` ou `query`) validée avec l'enchère actuellement ouverte ;
3. si un filtre texte est confirmé, chaque carte de la wishlist est recherchée par son titre puis vérifiée par UUID.

Les titres des cartes de la wishlist sont récupérés depuis Supabase `cards` par lots.

Le mode global paginé reste le fallback si aucun filtre ciblé n'est confirmé.
