# WikiDex Cloud POC

This directory started as a **non-destructive** Cloudflare proof of concept and now also contains a guarded real AutoBid engine. Real writes are disabled by default.

It tests two prerequisites for a future 24/7 multi-user WikiDex:

1. Can a Cloudflare Durable Object wake up every ~2 seconds?
2. Can a Cloudflare Worker perform an authenticated **read-only** request to WikiMasters without a browser being open?

The read-only probes and dry-run remain available. A real `POST /bid` path now exists only inside the guarded AutoBid Durable Object. It cannot run unless the global write gate is explicitly enabled and an individual auction is explicitly armed. There is still no discard endpoint.

## 1. Install and log in

From the repository root:

```powershell
cd cloud
npm install
npx wrangler login
```

## 2. Deploy

```powershell
npm run deploy
```

Wrangler prints a URL similar to:

```text
https://wikidex-cloud-poc.<your-subdomain>.workers.dev
```

Test it:

```powershell
Invoke-RestMethod "https://wikidex-cloud-poc.<your-subdomain>.workers.dev/health"
```

## 3. Protect the probe endpoints

Generate a local random key:

```powershell
$probeKey = [guid]::NewGuid().ToString("N")
$probeKey | npx wrangler secret put PROBE_KEY
```

Keep `$probeKey` in the current PowerShell session.

## 4. Test 2-second Durable Object alarms

Start 10 ticks spaced at 2 seconds:

```powershell
$base = "https://wikidex-cloud-poc.<your-subdomain>.workers.dev"

Invoke-RestMethod -Method Post -Uri "$base/probe/timer/start" -Headers @{"x-wikidex-probe-key"=$probeKey} -ContentType "application/json" -Body '{"intervalMs":2000,"count":10}'
```

Wait about 25 seconds, then:

```powershell
Invoke-RestMethod -Uri "$base/probe/timer/status" -Headers @{"x-wikidex-probe-key"=$probeKey}
```

Important fields:

- `observedTicks`
- `averageDeltaMs`
- `minDeltaMs`
- `maxDeltaMs`

## 5. Test server-side WikiMasters authentication

Do **not** send your cookie, JWT, access token, or refresh token in GitHub or ChatGPT.

On your own computer, open WikiMasters while logged in and inspect an authenticated request such as:

```text
GET /api/my-collection?sort=rarity&rarity=C&page=0&stats=0
```

Copy the value of its `Cookie` request header locally, then run:

```powershell
npx wrangler secret put WIKIMASTERS_COOKIE
```

Wrangler asks for the value interactively. Paste it there. It is stored as a Cloudflare Worker secret and is **not committed to Git**.

If the browser request also contains an `Authorization` header, add its complete value separately:

```powershell
npx wrangler secret put WIKIMASTERS_AUTHORIZATION
```

Then call:

```powershell
Invoke-RestMethod -Uri "$base/probe/auth" -Headers @{"x-wikidex-probe-key"=$probeKey}
```

Expected success:

```json
{
  "ok": true,
  "authenticated": true,
  "upstreamStatus": 200,
  "hasCollectionShape": true
}
```

The Worker deliberately does not return card IDs, titles, cookies, or tokens.

## What comes next if both probes pass?

The next iteration can add:

- per-user WikiDex accounts;
- encrypted WikiMasters credentials;
- refresh-token/session renewal;
- one scheduler per active auction;
- adaptive polling (for example 60 s far from the end, then 10 s / 5 s / 2 s);
- idempotency records before every bid attempt;
- **no automatic retry of an ambiguous POST /bid**;
- web UI usable from iPhone, Edge, Chrome, etc.

Do not add any real account credential to this repository.


## Guarded real AutoBid engine

The real engine lives in `src/autobid.js` and is intentionally inert after deployment.

### Safety invariants

- real writes require the Cloudflare secret `AUTOBID_WRITES_ENABLED` to equal `true`;
- starting one auction also requires `confirm: "REAL_BIDS"`;
- seller accounts are rejected;
- no bid is sent if the account is already highest;
- the +10% next bid is rounded upward and must remain within the configured ceiling;
- no bid is sent in the final 500 ms;
- the decision key is persisted **before** the state-changing request;
- a decision key is attempted at most once;
- `POST /bid` is called exactly once per attempt;
- rejected or ambiguous writes are never automatically retried;
- the next cycle reconciles state with a read-only `GET`;
- the alarm handler absorbs errors instead of throwing, because Durable Object alarms are at-least-once;
- polling is adaptive: 60 s far from the end, then 30 s / 10 s / 5 s / 2 s.

### Deployment does not enable writes

Deploy normally:

```powershell
git pull
npm run deploy
```

Do **not** set the following secret until real bidding is intentionally being enabled:

```powershell
npx wrangler secret put AUTOBID_WRITES_ENABLED
```

Its value must be exactly:

```text
true
```

Without that secret, `POST /autobid/start` refuses to arm an auction.

### Real AutoBid routes

All routes are currently protected by the same `x-wikidex-probe-key` used by the POC.

Status:

```text
GET /autobid/status?listing=<uuid>
```

Stop immediately:

```text
POST /autobid/stop?listing=<uuid>
```

Update the ceiling:

```json
POST /autobid/max
{
  "listing": "<uuid>",
  "max": 200
}
```

Explicitly arm a real auction:

```json
POST /autobid/start
{
  "listing": "<uuid>",
  "max": 200,
  "confirm": "REAL_BIDS"
}
```

Calling the start route while `AUTOBID_WRITES_ENABLED` is absent or not equal to `true` returns an error and schedules no alarm.

For a future multi-user production version, replace the shared Worker-level WikiMasters credential and probe key with per-user authentication plus encrypted per-account credentials.
