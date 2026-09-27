# WikiDex Cloud POC

This is a **non-destructive** Cloudflare proof of concept.

It tests two prerequisites for a future 24/7 multi-user WikiDex:

1. Can a Cloudflare Durable Object wake up every ~2 seconds?
2. Can a Cloudflare Worker perform an authenticated **read-only** request to WikiMasters without a browser being open?

There is **no bid endpoint** and no discard endpoint in this POC.

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
