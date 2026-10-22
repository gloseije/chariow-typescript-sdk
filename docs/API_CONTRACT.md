# Contrat API Chariow vérifié (source : MCP documentation Chariow)

Toutes les informations ci-dessous proviennent de la documentation officielle consultée via le MCP
(`/openapi/api-reference/openapi.json` et les guides `/en/guides/*`). Rien n'a été déduit hors documentation,
sauf mention « NON DOCUMENTÉ ».

## Généralités
- Base URL : `https://api.chariow.com/v1` (openapi `servers`, `/api-reference/introduction`).
- Auth : `Authorization: Bearer <clé>` ; clés `sk_...` à traiter comme chaînes opaques (`/en/introduction/authentication`).
- Scopes : `checkout.write`, `licenses.read`, `licenses.write` (inclut read), `sales.read`, `webhooks.read`, etc.
- Format : ressource unique `{ "data": {...} }` ; liste `{ "data": [...], "pagination": {...} }` ;
  erreur `{ "message", "errors", "data"? }`. `activate`/`revoke` renvoient aussi `message` à côté de `data`.
- Pagination par curseur : query `per_page` (défaut 10, max 100), `cursor`. Réponse `pagination` :
  `count, path, per_page, next_cursor, next_page_url, prev_cursor, prev_page_url, has_more_pages, has_pages`.
- Erreurs (`/en/resources/errors`) : 400 (règle métier, `errors: []`), 401 (`errors: []`, pas de `data`),
  403 (`errors.scopes: string[]`, en-tête `WWW-Authenticate: Bearer error="insufficient_scope", scope="..."`),
  404, 409 (checkout cadeau), 422 (`errors: { champ: string[] }`), 429 (`Retry-After`, `X-RateLimit-Limit`,
  `X-RateLimit-Remaining`, `X-RateLimit-Reset`), 500. Le `message` est traduit : utiliser `errors.scopes` en code.
- Rate limits : 100 req/min par clé (toutes routes sauf checkout) + compteur séparé 100 req/min pour `POST /checkout`.
- Pas de clé de test / sandbox documentée. Pas d'en-tête Idempotency-Key documenté. Pas de request-id documenté.

## Endpoints utilisés par le SDK
| Méthode | Chemin | Scope | Notes |
|---|---|---|---|
| POST | `/checkout` | checkout.write | `CheckoutRequest` -> `CheckoutResponse` |
| GET | `/sales` | sales.read | filtres `status, customer_id, search, from, to, period` |
| GET | `/sales/{saleId}` | sales.read | `SaleDetail` (statut + `payment.status`) |
| GET | `/licenses` | licenses.read | filtres `status, product_id, search` (pas de filtre client) |
| GET | `/licenses/{licenseKey}` | licenses.read | clé OU id public ; validation via `is_active`, `is_expired`, `can_activate` |
| POST | `/licenses/{licenseKey}/activate` | licenses.write | body `{ device_identifier?: string(<=255) }` ; 400 si révoquée/expirée/limite/déjà active sans activation requise |
| POST | `/licenses/{licenseKey}/revoke` | licenses.write | body `{ reason?: string(<=500) }` (non stocké) ; 400 si déjà révoquée ; permanent |
| GET | `/licenses/{licenseKey}/activations` | licenses.read | paginé, `Activation` |
| GET | `/pulses` | webhooks.read | filtre `search` |
| GET | `/pulses/{pulseId}` | webhooks.read | `Pulse` (secret masqué uniquement) |

Non couverts par le SDK (existent dans l'API) : `/store`, `/products`, `/customers`, `/discounts`, `/affiliates/*`.
Accessibles via `chariow.request()`.

## Checkout
Requis : `product_id` (id ou slug, publié), `email`, `first_name`(<=50), `last_name`(<=50),
`phone { number, country_code }`. Optionnels : `price_variant_id`, `discount_code`, `affiliate_code`,
`payment_currency`, `campaign_id`, `custom_fields` (objet), `redirect_url` (<=2048), `custom_metadata`
(<=10 clés, valeurs string <=255, incluses dans les Pulses de vente), `customer_ip`, `shipping {address, city, state, country, zip}`,
`embed_origins` (<=4 origines HTTPS canoniques), `gift {recipient_email, recipient_first_name, recipient_last_name, message?}`.
Réponse `data` : `step` (`payment` | `completed` | `already_purchased`), `message`, `purchase` (`SaleSummary` | null),
`payment { checkout_url, transaction_id, gateway }`. Produits non supportés : service, coaching, prix libre.
Le `redirect_url` sert l'UX uniquement ; la confirmation fiable passe par les Pulses (`/en/guides/best-practices`).

## Licences
Objet `License` : `id, status (pending_activation|active|expired|revoked), customer, product,
license { key, masked_key }, is_active, is_expired, can_activate, activations { count, max, remaining },
certificate_url (expire 30 min), metadata, activated_at, expires_at, expired_at, revoked_at, created_at, updated_at`.
`requires_activation=false` (réglage produit) : licences émises déjà actives ; activer renvoie 400.
Clé après paiement : générée automatiquement à l'achat ; transmise dans les Pulses `license.*` (`license.key`).
L'événement `successful.sale` NE contient PAS la clé. L'objet License ne contient PAS d'identifiant de vente
(NON DOCUMENTÉ) ; le lien vente↔licence se fait via `customer.id` + `product.id`.

## Pulses (webhooks HTTP)
- POST signé vers une URL HTTPS configurée dans le tableau de bord (Automation → Pulses → Add Pulse).
- En-têtes : `x-chariow-signature: sha256=<hex>`, `x-pulse-id`, `x-pulse-delivery-id` (clé d'idempotence,
  stable entre tentatives), `x-pulse-event`, `Content-Type: application/json; charset=utf-8`,
  `User-Agent: Pulse | Chariow +https://chariow.com`.
- Signature : HMAC-SHA256(corps brut, secret `whsec_...` propre à chaque Pulse), hex minuscule, préfixe `sha256=`.
  Pas d'horodatage (par design). Comparaison en temps constant. Préfixe différent = schéma non supporté.
  Répondre 401 si signature absente/invalide. Ne jamais re-sérialiser le JSON (slashes échappés `\/`).
- Rotation : immédiate, l'ancien secret cesse de fonctionner.
- Retries : 5 tentatives (10 s, 100 s, ~17 min, ~2 h 47), timeout 30 s, désactivation auto du Pulse après 5 échecs.
- Rejeu manuel : nouveau `x-pulse-delivery-id`.
- Événements : `successful.sale`, `abandoned.sale`, `failed.sale`, `license.activated`, `license.expired`,
  `license.issued`, `license.nearing_expiry` (+ `days_until_expiry`), `license.revoked`, `affiliate.joined`.
- Payloads documentés par exemple : `successful.sale`, `license.activated`, `license.nearing_expiry`, `affiliate.joined`.
  Les autres (`abandoned.sale`, `failed.sale`, `license.issued|expired|revoked`) : structure NON DOCUMENTÉE explicitement
  (les exemples de handlers utilisent `payload.sale`/`payload.license`, `customer`, `store`).
- Événement de test : `successful.sale` avec ids préfixés `test_`, champ `note` supplémentaire, `sale` réduit,
  `custom_fields` = liste `{name, value}`.
- Triggers API (`PulseTrigger.value`) : `all, successful_sale, abandoned_sale, failed_sale, license_activated,
  license_expired, license_issued, license_nearing_expiry, license_revoked, affiliate_joined`.
