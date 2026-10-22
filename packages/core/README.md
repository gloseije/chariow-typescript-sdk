# @gloseije/chariow-sdk

SDK TypeScript non officiel pour l'API [Chariow](https://chariow.com) : checkout, licences logicielles et
Pulses (webhooks signés HMAC-SHA256). Il ne dépend d'aucun framework ni d'aucun package, et fonctionne avec le
`fetch` natif de Node.js ≥ 20.

```ts
import { Chariow } from '@gloseije/chariow-sdk';

const chariow = new Chariow({ apiKey: process.env.CHARIOW_API_KEY! });
const result = await chariow.licenses.validate('ABCD-1234-EFGH-5678');
```

Documentation complète (en français) : voir le README du monorepo.
Licence MIT. Projet non affilié à Chariow.
