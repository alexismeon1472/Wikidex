# WikiDex v0.11.2

## Correctif des erreurs HTTP 500 pendant le scan du marché

Une erreur serveur sur une page profonde du marché ne stoppe plus tout le scan.

### Retry

Pour chaque requête marketplace, WikiDex retente les erreurs temporaires :

- HTTP 429
- HTTP 500
- HTTP 502
- HTTP 503
- HTTP 504
- erreurs réseau

Délais : environ 0,5 s, 1,4 s puis 3 s.

### Découpage automatique

Le scanner travaille normalement par blocs de 50 enchères.

Si un bloc de 50 continue de répondre en erreur après les retries, WikiDex
couvre exactement la même zone en deux blocs de 25.

Si un bloc de 25 échoue encore, il est découpé en cinq blocs de 5.

Ainsi, par exemple, un échec de `page=57&limit=50` n'oblige plus à abandonner
les milliers d'enchères déjà parcourues.

### Dernier recours

Si même un bloc de 5 reste illisible, WikiDex le note comme segment manquant
et continue le scan au lieu de tout annuler.

L'interface indique alors le nombre maximal d'enchères qui n'ont pas pu être lues.

### Sécurité

Le scan reste limité à l'équivalent de 250 blocs de 50.

La logique d'auto-enchère n'est pas modifiée.
Aucun POST `/bid` n'est retenté automatiquement.
