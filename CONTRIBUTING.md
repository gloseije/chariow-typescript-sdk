# Contribuer

Merci de votre intérêt ! Ce dépôt est un monorepo npm workspaces :

- `packages/core` : SDK TypeScript indépendant de tout framework ;
- `packages/nestjs` : intégration NestJS, qui réutilise le core.

## Prérequis

- Node.js ≥ 22.12 pour développer (Vitest 4) ; les packages publiés supportent Node.js ≥ 20.
- npm ≥ 10.

## Démarrer

```bash
npm install
npm run check   # lint + typecheck + build + tests
```

Scripts disponibles : `build`, `typecheck`, `lint`, `test`, `test:watch`, `pack:dry`, `set-scope`.

## Règles

1. **Aucune fonctionnalité non documentée.** Chaque endpoint, paramètre, en-tête ou format de réponse ajouté
   doit être référencé dans la documentation officielle Chariow (https://docs.chariow.com). Mettez à jour
   `docs/API_CONTRACT.md` avec la page source.
2. **Aucun secret.** N'utilisez jamais de vraie clé API ni de secret de Pulse dans le code, les tests ou les
   issues. Les tests utilisent des faux secrets et un `fetch` simulé ou un serveur HTTP local.
3. **Aucun paiement réel** dans les tests.
4. Pas de `any` ; les erreurs exposées ne doivent contenir ni clé API, ni clé de licence complète.
5. Le package NestJS ne doit pas faire d'appel HTTP lui-même : il délègue au core.
6. Ajoutez des tests pour tout changement de comportement.

## Publication

La publication npm est réservée aux mainteneurs. Voir la section « Avant publication » du README.
