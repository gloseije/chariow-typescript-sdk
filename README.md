# SDK TypeScript Chariow

SDK TypeScript **open source et non officiel** pour intégrer à une application SaaS les paiements et les
licences logicielles de [Chariow](https://chariow.com). Il couvre trois domaines :

- **Checkout** : création d'un paiement (`POST /checkout`) ;
- **Licences** : lecture, validation, activation, révocation et historique d'activations ;
- **Pulses** : webhooks HTTP signés, avec vérification de signature, typage des événements et dédoublonnage.

| Package | Rôle |
|---|---|
| [`@gloseije/chariow-sdk`](packages/core) | Client indépendant de tout framework (Node.js ≥ 20, `fetch` natif, aucune dépendance) |
| [`@gloseije/nestjs-chariow`](packages/nestjs) | Module NestJS 10/11/12 qui injecte et réutilise le client core |

> Le scope npm `@gloseije` est provisoire. Pour le changer : `npm run set-scope -- @mon-scope`.

Tout ce que fait le SDK s'appuie sur la documentation officielle (https://docs.chariow.com). Le contrat d'API
vérifié, avec les pages sources, se trouve dans [`docs/API_CONTRACT.md`](docs/API_CONTRACT.md).

## Sommaire

- [Prérequis](#prérequis)
- [Installation](#installation)
- [Configuration](#configuration)
- [Utilisation en TypeScript](#utilisation-en-typescript)
- [Utilisation avec NestJS](#utilisation-avec-nestjs)
- [Recevoir les Pulses](#recevoir-les-pulses)
- [Flux achat → licence → activation](#flux-achat--licence--activation)
- [Erreurs](#erreurs)
- [Sécurité](#sécurité)
- [Limitations et points non vérifiés](#limitations-et-points-non-vérifiés)
- [Développement](#développement)
- [Avant publication npm](#avant-publication-npm)
- [Liens officiels Chariow](#liens-officiels-chariow)

## Prérequis

- Node.js ≥ 20 (`fetch` et `AbortController` natifs). Le SDK s'exécute **uniquement côté serveur** : il
  manipule votre clé API secrète.
- Une boutique Chariow et une clé API (`sk_...`) créée dans le tableau de bord, avec les scopes nécessaires :

| Fonction | Scope |
|---|---|
| `checkout.create` | `checkout.write` |
| `sales.list` / `sales.get` | `sales.read` |
| `licenses.list` / `get` / `validate` / `listActivations` | `licenses.read` |
| `licenses.activate` / `revoke` | `licenses.write` (inclut `licenses.read`) |
| `pulses.list` / `pulses.get` | `webhooks.read` |

- Pour les Pulses : un Pulse configuré dans **Automation → Pulses** (URL HTTPS obligatoire) et son secret de
  signature `whsec_...`.
- NestJS 10, 11 ou 12 si vous utilisez le package NestJS.

## Installation

Les packages ne sont **pas encore publiés sur npm**. Une fois qu'ils le seront :

```bash
npm install @gloseije/chariow-sdk
# avec NestJS
npm install @gloseije/nestjs-chariow @gloseije/chariow-sdk
```

D'ici là, vous pouvez les installer depuis une archive locale (voir [Développement](#développement)).
Les deux packages fournissent des builds ESM et CommonJS ainsi que leurs déclarations TypeScript.

## Configuration

```ts
import { Chariow } from '@gloseije/chariow-sdk';

const chariow = new Chariow({
  apiKey: process.env.CHARIOW_API_KEY!,             // obligatoire, sk_...
  pulseSecret: process.env.CHARIOW_PULSE_SECRET,     // facultatif, whsec_... (pour chariow.webhooks)
  timeoutMs: 30_000,                                 // facultatif, 30 s par défaut
  // baseUrl: 'https://api.chariow.com/v1',          // valeur par défaut
  // fetch: customFetch,                             // facultatif, fetch global par défaut
});
```

| Option | Type | Défaut | Description |
|---|---|---|---|
| `apiKey` | `string` | — | Clé API secrète. Elle est traitée comme une chaîne opaque, sans contrôle de format. |
| `pulseSecret` | `string \| string[]` | — | Secret(s) de signature des Pulses, à fournir pour `chariow.webhooks`. |
| `baseUrl` | `string` | `https://api.chariow.com/v1` | HTTPS obligatoire (HTTP seulement accepté pour `localhost`, en test). |
| `timeoutMs` | `number` | `30000` | Délai maximal par requête. Il peut être redéfini à chaque appel. |
| `fetch` | `(url, init) => Promise<Response>` | `globalThis.fetch` | Implémentation `fetch` personnalisée. |

Une configuration invalide lève `ChariowConfigurationError` dès la construction du client.
Chaque méthode accepte aussi `{ signal?: AbortSignal; timeoutMs?: number }` en dernier argument.

## Utilisation en TypeScript

### Créer un checkout

```ts
import { getCheckoutUrl } from '@gloseije/chariow-sdk';

const session = await chariow.checkout.create({
  product_id: 'prd_abc123',               // ID public ou slug d'un produit publié
  email: 'client@example.com',
  first_name: 'Awa',
  last_name: 'Koné',
  phone: { number: '0700000000', country_code: 'CI' },
  custom_metadata: { user_id: 'usr_42' }, // renvoyé dans les Pulses de vente (10 clés max, 255 caractères max)
  redirect_url: 'https://app.example.com/merci',
});

switch (session.step) {
  case 'payment':
    // Redirigez l'acheteur vers la page de paiement hébergée par Chariow
    return redirect(getCheckoutUrl(session)!);
  case 'completed':
    // Rien à payer (produit gratuit ou remise à 100 %)
    break;
  case 'already_purchased':
    // Aucune vente n'a été créée
    break;
}
```

Avant tout appel réseau, le SDK vérifie les contraintes documentées : champs obligatoires, longueurs maximales,
limites de `custom_metadata` et de `embed_origins`. Une requête non conforme lève `ChariowInvalidRequestError`.

> ⚠️ Le retour du navigateur sur `redirect_url` **ne prouve pas le paiement**. Confirmez-le côté serveur à
> partir d'un Pulse signé `successful.sale` ou de `chariow.sales.get(saleId)`.

### Confirmer une vente côté serveur

```ts
const sale = await chariow.sales.get(session.purchase!.id);
const paid = sale.status === 'completed' || sale.status === 'settled';
```

### Licences

```ts
// Lecture (clé de licence ou ID public)
const license = await chariow.licenses.get('ABCD-1234-EFGH-5678');

// Validation, à partir des champs documentés is_active / is_expired / status
const result = await chariow.licenses.validate('ABCD-1234-EFGH-5678');
if (!result.valid) {
  console.log(result.reason); // 'not_found' | 'revoked' | 'expired' | 'pending_activation' | 'inactive'
}

// Activation sur un appareil (device_identifier : 255 caractères max)
const { license: activated } = await chariow.licenses.activate('ABCD-1234-EFGH-5678', {
  device_identifier: 'macbook-pro-awa',
});

// Historique d'activations
const { data: activations } = await chariow.licenses.listActivations('ABCD-1234-EFGH-5678');

// Révocation : définitive (raison : 500 caractères max, non conservée par Chariow)
await chariow.licenses.revoke('ABCD-1234-EFGH-5678', { reason: 'Remboursement' });
```

`activate` renvoie une erreur 400 (`ChariowBadRequestError`) dans ces cas : licence révoquée ou expirée, limite
d'activations atteinte, ou licence déjà active sur un produit configuré sans activation
(`requires_activation: false`). Pour ce dernier type de produit, utilisez `validate`.

### Pagination

Les listes utilisent la pagination par curseur documentée (`per_page` ≤ 100, `cursor`) :

```ts
const page = await chariow.licenses.list({ status: 'active', per_page: 100 });
console.log(page.pagination.next_cursor);

for await (const license of chariow.licenses.listAll({ product_id: 'prd_abc123' })) {
  // parcourt toutes les pages
}
```

`sales`, `pulses` et `licenses.listActivations` fonctionnent de la même façon (`listAll`, `listAllActivations`).

### Endpoints non encapsulés

Les endpoints documentés non couverts par le SDK (`/store`, `/products`, `/customers`, `/discounts`,
`/affiliates`) restent accessibles via la requête bas niveau authentifiée :

```ts
const { body } = await chariow.request({ method: 'GET', path: '/products', query: { per_page: 20 } });
```

## Utilisation avec NestJS

### Enregistrement du module

```ts
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { ChariowModule } from '@gloseije/nestjs-chariow';

@Module({
  imports: [
    ConfigModule.forRoot(),
    ChariowModule.forRootAsync({
      isGlobal: true,
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (config: ConfigService) => ({
        apiKey: config.getOrThrow<string>('CHARIOW_API_KEY'),
        pulseSecret: config.getOrThrow<string>('CHARIOW_PULSE_SECRET'),
      }),
    }),
  ],
})
export class AppModule {}
```

Il existe aussi `ChariowModule.forRoot({ apiKey, pulseSecret })` pour une configuration statique, ainsi que
`forRootAsync({ useClass })` et `forRootAsync({ useExisting })` avec une classe qui implémente
`ChariowOptionsFactory`. Le client est créé, et sa configuration validée, au démarrage de l'application : une
configuration invalide empêche donc le démarrage.

Le module expose :

| Fournisseur | Description |
|---|---|
| `ChariowService` | Façade injectable (voir ci-dessous) |
| `CHARIOW_CLIENT` | Instance `Chariow` du core (`@Inject(CHARIOW_CLIENT)`) |
| `CHARIOW_PULSE_PROCESSOR` | `PulseEventProcessor` partagé |
| `ChariowPulseGuard` | Guard de vérification des signatures des Pulses |

### `ChariowService`

```ts
@Injectable()
export class BillingService {
  constructor(private readonly chariow: ChariowService) {}

  async buy(user: User) {
    const { checkoutUrl, session } = await this.chariow.createCheckout({
      product_id: 'prd_abc123',
      email: user.email,
      first_name: user.firstName,
      last_name: user.lastName,
      phone: { number: user.phone, country_code: user.country },
      custom_metadata: { user_id: user.id },
    });
    return checkoutUrl ?? session.step;
  }

  isPaid(saleId: string) {
    return this.chariow.getSalePaymentStatus(saleId); // { sale, paid }
  }

  checkLicense(key: string) {
    return this.chariow.validateLicense(key);
  }
}
```

Autres méthodes : `activateLicense`, `revokeLicense`, `constructPulseEvent`, `onPulse`, `onUnknownPulse`,
`dispatchPulse` et `handlePulse`. Les accesseurs `checkout`, `licenses`, `sales`, `pulses` et `client` donnent
accès à toute l'API du core. Le package NestJS n'émet aucune requête HTTP lui-même : il délègue tout au core.

### Contrôleur de Pulses

Le module ne vous impose aucun contrôleur. Vous écrivez le vôtre et y appliquez `ChariowPulseGuard` :

```ts
// main.ts — le corps brut est indispensable pour vérifier la signature
const app = await NestFactory.create(AppModule, { rawBody: true });
```

```ts
import { Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import type { PulseEvent } from '@gloseije/chariow-sdk';
import { ChariowPulse, ChariowPulseGuard, ChariowService } from '@gloseije/nestjs-chariow';

@Controller('webhooks')
export class ChariowWebhookController {
  constructor(private readonly chariow: ChariowService) {
    chariow.onPulse('license.issued', async (event) => {
      // Événement de licence : la clé se trouve dans event.payload.license?.key
    });
    chariow.onPulse('successful.sale', async (event) => {
      const userId = event.payload.sale.custom_metadata?.user_id;
      // accordez l'accès à userId...
    });
  }

  @Post('chariow')
  @HttpCode(200)
  @UseGuards(ChariowPulseGuard)          // 401 si la signature est absente ou invalide, 400 si le corps est invalide
  async receive(@ChariowPulse() event: PulseEvent) {
    await this.chariow.dispatchPulse(event); // ignore les doublons (x-pulse-delivery-id)
  }
}
```

Si un handler lève une exception, l'identifiant de livraison est libéré et la requête répond en erreur :
Chariow retentera alors la livraison.

## Recevoir les Pulses

Fonctionnement vérifié dans la documentation (`/en/guides/pulses`, `/en/guides/pulse-security`) :

- requête `POST` en JSON vers votre URL HTTPS ;
- en-tête `x-chariow-signature: sha256=<hex>`, calculé en HMAC-SHA256 du **corps brut** avec le secret du Pulse
  (`whsec_...`, distinct de la clé API) ;
- en-têtes `x-pulse-id`, `x-pulse-event` et `x-pulse-delivery-id`. Ce dernier est stable d'une tentative à
  l'autre : c'est votre clé d'idempotence ;
- la signature ne contient **pas d'horodatage**. La protection contre les rejeux repose donc sur le
  dédoublonnage par `x-pulse-delivery-id` ;
- en cas d'échec, Chariow fait 5 tentatives au total (après 10 s, 100 s, ~17 min puis ~2 h 47) et désactive le
  Pulse si toutes échouent. Répondez vite avec un code 2xx et traitez les tâches lourdes en arrière-plan.

Exemple avec Express (sans NestJS) :

```ts
import express from 'express';
import {
  Chariow,
  ChariowWebhookVerificationError,
  InMemoryPulseIdempotencyStore,
  PulseEventProcessor,
} from '@gloseije/chariow-sdk';

const chariow = new Chariow({
  apiKey: process.env.CHARIOW_API_KEY!,
  pulseSecret: process.env.CHARIOW_PULSE_SECRET!,
});

const processor = new PulseEventProcessor({ idempotencyStore: new InMemoryPulseIdempotencyStore() })
  .on('successful.sale', async ({ payload }) => {
    // payload.sale, payload.customer, payload.product, payload.sale.custom_metadata
  })
  .on('license.issued', async ({ payload }) => {
    // structure non documentée explicitement : champs facultatifs
    const key = payload.license?.key;
  })
  .onUnknown(async (event) => {
    console.info('Pulse non géré', event.type); // les événements inconnus ne provoquent pas d'erreur
  });

const app = express();
app.post('/webhooks/chariow', express.raw({ type: 'application/json' }), async (req, res) => {
  let event;
  try {
    event = chariow.webhooks.constructEvent({ rawBody: req.body, headers: req.headers });
  } catch (error) {
    if (error instanceof ChariowWebhookVerificationError) return res.status(401).send('Invalid signature');
    return res.status(400).send('Invalid payload');
  }
  await processor.process(event); // 'processed' | 'duplicate' | 'unhandled'
  res.sendStatus(200);
});
```

Fonctions utiles : `verifyPulseSignature`, `isValidPulseSignature`, `computePulseSignature`,
`constructPulseEvent`, `PulseWebhooks` et `KNOWN_PULSE_EVENTS`.

Si plusieurs Pulses, chacun avec son propre secret, envoient vers le même endpoint, passez un tableau de
secrets à `pulseSecret`.

> `InMemoryPulseIdempotencyStore` ne convient qu'à une seule instance. Sur plusieurs instances, implémentez
> `PulseIdempotencyStore` (`claim` / `release`) au-dessus d'une contrainte d'unicité en base de données ou d'un
> `SET NX` Redis.

### Événements typés

| Événement | Typage |
|---|---|
| `successful.sale` | Complet (exemple documenté) |
| `license.activated` | Complet (exemple documenté) |
| `license.nearing_expiry` | Complet, avec `days_until_expiry` |
| `affiliate.joined` | Complet (exemple documenté) |
| `abandoned.sale`, `failed.sale` | **Partiel** : structure non documentée explicitement, champs de vente facultatifs |
| `license.issued`, `license.expired`, `license.revoked` | **Partiel** : structure non documentée explicitement, champs de licence facultatifs |
| tout autre nom | `known: false`, payload transmis tel quel |

## Flux achat → licence → activation

1. **Serveur** : `checkout.create(...)` avec `custom_metadata: { user_id }` pour relier la vente à votre utilisateur.
2. **Navigateur** : redirection vers `payment.checkout_url`, paiement chez Chariow, puis retour sur `redirect_url`.
   Ce retour sert uniquement à l'affichage.
3. **Pulse `successful.sale`** (signé) : confirmation fiable du paiement, avec `sale.custom_metadata` et `customer`.
4. **Pulse `license.issued`** : la clé de licence est générée automatiquement à l'achat d'un produit de type
   licence. Elle se trouve dans le payload des événements `license.*`, pas dans `successful.sale`.
5. Votre application **enregistre** la clé et l'associe à l'utilisateur, en s'appuyant sur `customer.id` /
   `customer.email` et `product.id` (voir limitations).
6. **Application cliente** : elle envoie la clé à **votre** serveur, qui appelle `licenses.activate(key, { device_identifier })`.
7. **Contrôles suivants** : `licenses.validate(key)` côté serveur, avec un cache raisonnable (limite de 100 requêtes/min par clé API).

Une alternative au point 4 : `licenses.list({ product_id, search: email })`, puis filtrer sur `customer.id`.

## Erreurs

Toutes les erreurs héritent de `ChariowError`.

| Classe | Quand |
|---|---|
| `ChariowConfigurationError` | Option invalide (clé absente, URL non HTTPS, timeout invalide, secret de Pulse manquant) |
| `ChariowInvalidRequestError` | Contrainte documentée non respectée, détectée avant l'envoi (`issues`) |
| `ChariowNetworkError` | Chariow injoignable (`cause` contient l'erreur d'origine) |
| `ChariowTimeoutError` | Délai dépassé (`timeoutMs`), hérite de `ChariowNetworkError` |
| `ChariowAbortError` | Annulation via `AbortSignal` |
| `ChariowResponseError` | Réponse 2xx dont le corps n'a pas le format documenté |
| `ChariowApiError` | Réponse non 2xx : `status`, `apiMessage`, `errors`, `data`, `method`, `path` |
| ↳ `ChariowBadRequestError` | 400 : règle métier (licence révoquée, limite d'activations atteinte...) |
| ↳ `ChariowAuthenticationError` | 401 : clé absente, invalide ou révoquée |
| ↳ `ChariowPermissionError` | 403 : scopes manquants (`missingScopes`) |
| ↳ `ChariowNotFoundError` | 404 |
| ↳ `ChariowConflictError` | 409 (documenté pour les achats en cadeau) |
| ↳ `ChariowValidationError` | 422 : `fieldErrors` (`{ champ: string[] }`) |
| ↳ `ChariowRateLimitError` | 429 : `rateLimit` (`Retry-After`, `X-RateLimit-*`) |
| ↳ `ChariowServerError` | 5xx |
| `ChariowWebhookVerificationError` | Signature de Pulse invalide (`reason`). Répondez 401. |
| `ChariowWebhookPayloadError` | Corps de Pulse signé mais invalide |

```ts
try {
  await chariow.licenses.activate(key, { device_identifier });
} catch (error) {
  if (error instanceof ChariowPermissionError) console.error('Scopes manquants', error.missingScopes);
  else if (error instanceof ChariowBadRequestError) console.warn(error.apiMessage);
  else if (error instanceof ChariowRateLimitError) await sleep((error.retryAfterSeconds ?? 60) * 1000);
  else throw error;
}
```

Chariow traduit `message` selon la langue : ne basez pas votre logique dessus, utilisez la classe d'erreur,
`status` et `missingScopes`. Le SDK **ne relance aucune requête automatiquement**, car aucune politique de
nouvel essai n'est documentée et `POST /checkout` n'a pas de clé d'idempotence documentée.

## Sécurité

- **La clé API et le secret des Pulses restent côté serveur.** Chargez-les depuis des variables d'environnement
  ou un gestionnaire de secrets, et ne les envoyez jamais au navigateur ni dans une application distribuée.
- Le SDK n'écrit aucun log. Ses messages d'erreur ne contiennent ni la clé API, ni la clé de licence (le
  chemin est masqué : `/licenses/{licenseKey}`). `JSON.stringify(chariow)` n'expose pas la clé.
- TLS n'est jamais désactivé. Une URL de base non HTTPS est refusée, sauf pour `localhost`.
- Vérifiez **toujours** la signature d'un Pulse avant de lire son contenu. Le SDK compare en temps constant et
  exige le corps brut, sans resérialisation.
- Dédoublonnez sur `x-pulse-delivery-id`. Un rejeu manuel depuis le tableau de bord produit un nouvel
  identifiant : c'est le comportement prévu.
- Le retour navigateur (`redirect_url`) et ses paramètres ne prouvent jamais un paiement.
- **Ce qui relève de votre application** : stocker les clés de licence, les associer à vos utilisateurs, gérer
  les autorisations, faire tourner les secrets (la rotation d'un secret de Pulse est immédiate) et décider des
  accès lors d'une révocation ou d'un remboursement.

## Limitations et points non vérifiés

Ces points **ne sont pas documentés par Chariow** et ne sont donc **pas implémentés** :

- **Environnement de test / sandbox** : aucune clé de test n'est documentée. Les tests du SDK utilisent des
  simulations. Le tableau de bord permet d'envoyer un Pulse de test (`successful.sale` avec des identifiants `test_`).
- **Lien direct vente ↔ licence** : l'objet `License` ne contient pas d'identifiant de vente, et `successful.sale`
  ne contient pas la clé. La corrélation passe par `customer` et `product`, ou par les événements `license.*`.
- **Désactivation d'une activation** et **remboursement** : aucun endpoint dédié. La révocation (définitive) est
  le seul mécanisme documenté.
- **Création, modification ou suppression de Pulses via l'API** : seules la lecture (`GET /pulses`) et la
  configuration dans le tableau de bord sont documentées.
- **Structure exacte** des payloads `abandoned.sale`, `failed.sale`, `license.issued`, `license.expired` et
  `license.revoked` : typés partiellement, avec des champs facultatifs.
- **Clé d'idempotence** pour `POST /checkout`, **identifiant de requête** et **politique de nouvel essai**
  côté client : non documentés, donc absents du SDK.
- Les types de produits service, coaching et prix libre ne sont pas pris en charge par le checkout API (limite
  documentée par Chariow).
- Les modèles détaillés de `/store`, `/products`, `/customers`, `/discounts` et `/affiliates` ne sont pas
  encapsulés (utilisez `chariow.request`).

## Développement

```bash
npm install
npm run lint        # ESLint (typescript-eslint strict, type-checked)
npm run typecheck   # tsc --noEmit sur src + tests des deux packages
npm run build       # ESM + CJS + .d.ts dans packages/*/dist
npm test            # Vitest (fetch simulé + serveur HTTP local + application NestJS réelle)
npm run check       # tout ce qui précède
npm run pack:dry    # contenu des archives npm, sans rien publier
```

Pour tester localement dans un autre projet sans rien publier :

```bash
npm run build
npm pack --workspace packages/core --workspace packages/nestjs
# dans votre projet :
npm install /chemin/vers/gloseije-chariow-sdk-0.1.0.tgz /chemin/vers/gloseije-nestjs-chariow-0.1.0.tgz
```

Le développement nécessite Node.js ≥ 22.12 (Vitest 4). Les packages publiés, eux, supportent Node.js ≥ 20.

## Avant publication npm

1. Choisir le scope définitif : `npm run set-scope -- @votre-scope`, puis `npm install`.
2. Renseigner `author` dans les `package.json` (`repository`, `homepage` et `bugs` pointent déjà vers ce dépôt).
3. Vérifier `npm run check` et `npm run pack:dry`.
4. Valider le flux complet sur une vraie boutique Chariow, avec un produit gratuit ou une remise à 100 % (pas de
   paiement réel) et un Pulse de test.
5. Publier dans l'ordre `core` puis `nestjs` (`npm publish --workspace ...`), **après validation explicite du mainteneur**.

## Liens officiels Chariow

- Documentation : https://docs.chariow.com
- Référence API : https://docs.chariow.com/api-reference/introduction
- Authentification et scopes : https://docs.chariow.com/en/introduction/authentication
- Checkout : https://docs.chariow.com/en/guides/checkout
- Licences : https://docs.chariow.com/en/guides/licenses
- Intégration SaaS : https://docs.chariow.com/en/guides/saas-license-integration
- Pulses : https://docs.chariow.com/en/guides/pulses
- Sécurité des Pulses : https://docs.chariow.com/en/guides/pulse-security
- Erreurs : https://docs.chariow.com/en/resources/errors
- Limites de débit : https://docs.chariow.com/en/resources/rate-limits

## Licence

[MIT](LICENSE). Projet communautaire, non affilié à Chariow.
