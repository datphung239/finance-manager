# Finance Manager V2 — deploy to a NEW D1 and a NEW Worker

Decision: **start with an empty D1**. No Google Sheets import or sync.
Do **NOT** change the existing `finance-manager-web` project or its domain.

## Prerequisites
- Cloudflare account access and Wrangler authentication on your own machine.
- Rust + wasm32-unknown-unknown, Node.js, Python 3.11+, and `worker-build`.
- Cloudflare Zero Trust team and a valid Access allowlist.
- Keep credentials out of public GitHub and screenshots.

## 1. Prepare a separate V2 deployment

From repo root, on branch `rebuild/rust-d1-access`:

```bash
rustup target add wasm32-unknown-unknown
cargo install worker-build --locked
npm install --global wrangler
npx wrangler whoami
npx wrangler d1 create finance-manager-v2
cp next/server/wrangler.toml.example next/server/wrangler.toml
```

Copy the **newly returned database UUID** into
`next/server/wrangler.toml` in place of `SET_REAL_DATABASE_ID_HERE`.
That config is ignored by Git. Do not copy the ID of any existing project.
The database name and Worker name intentionally differ from V1.

Check the values:

```bash
python3 next/scripts/preflight.py next/server/wrangler.toml
```

## 2. Apply EMPTY database schema

Optional local validation (does not touch remote data):

```bash
npx wrangler d1 migrations apply finance-manager-v2 --local --config next/server/wrangler.toml
```

Apply to the **new** D1 database explicitly:

```bash
npx wrangler d1 migrations apply finance-manager-v2 --remote --config next/server/wrangler.toml
```

Verify there are **zero business rows** after migrations:

```bash
npx wrangler d1 execute finance-manager-v2 --remote --config next/server/wrangler.toml --command "SELECT (SELECT COUNT(*) FROM accounts) AS accounts, (SELECT COUNT(*) FROM transactions) AS transactions, (SELECT COUNT(*) FROM debts) AS debts, (SELECT COUNT(*) FROM bank_inbox) AS bank_inbox"
```

All four figures must be **0**. Do not run any `INSERT` seed script on
the real finance database. `d1_migrations` is an internal migration log
and is not financial data.

## 3. Compile and dry-run (no deployment)

```bash
bash next/scripts/build-client.sh
npx wrangler deploy --dry-run --config next/server/wrangler.toml
```

If the dry-run cannot find `worker-build`, confirm
`~/.cargo/bin` is on your PATH. CI includes a release dry-run gate.

## 4. Cloudflare Access and Worker secrets

Create a **Cloudflare Access** self-hosted application/policy covering
the *entire* V2 `workers.dev` hostname, not just `/api/*`.
Restrict users to the selected email addresses. Never use Bypass.
The Rust API independently checks JWT signature via Access JWKS, issuer,
audience, expiry and allowed email. Until it is configured correctly,
every `/api/*` call rejects access (fail closed).

Set the following Worker secrets through Wrangler (in a secure terminal,
NOT in your GitHub repository):

```bash
npx wrangler secret put ACCESS_TEAM_DOMAIN --config next/server/wrangler.toml
npx wrangler secret put ACCESS_AUD --config next/server/wrangler.toml
npx wrangler secret put ACCESS_ALLOWED_EMAILS --config next/server/wrangler.toml
npx wrangler secret put PUBLIC_ORIGIN --config next/server/wrangler.toml
```

Expected values:
- `ACCESS_TEAM_DOMAIN`: full team URL, such as
  `https://<your-team>.cloudflareaccess.com` (no trailing slash).
- `ACCESS_AUD`: application AUD tag provided by Cloudflare Access.
- `ACCESS_ALLOWED_EMAILS`: comma-separated **exact email addresses**.
- `PUBLIC_ORIGIN`: exact HTTPS browser origin of your V2 Worker (no slash).

You might first need to create the V2 Worker so its `workers.dev` route can
be protected in the Cloudflare dashboard. Its Rust API denies unauthenticated
requests by design. Enable Access immediately after the first deploy.

## 5. Deploy V2 only

```bash
npx wrangler deploy --config next/server/wrangler.toml
```

Never use `wrangler.jsonc` from repository root; that targets the old V1
website. The config above names the separate `finance-manager-v2` Worker.

## 6. Post-deploy acceptance gates

1. Unauthenticated `/api/bootstrap`: Access login redirect or HTTP 401,
   never a D1 response with private rows.
2. Unauthorized email: denied by Access and Worker allowlist.
3. Allowed email: Access login succeeds; `/api/bootstrap` returns zero
   accounts, transactions and debts.
4. Opening balance is set by the user when creating an account, without
   being counted as revenue.
5. Test money writes on an isolated development D1; never insert fake
   financial records into the production empty database.
6. Test Android notification parsing only with redacted synthetic messages.
7. Run browser E2E on mobile and desktop against a properly protected
   development Worker, including retry/idempotency and tenant isolation.

**Do not cut over, merge into main, remove V1, or delete old Google Sheets**
until real Cloudflare Access + D1 acceptance tests pass.

Rust source is open source. Secrets, D1 rows and Cloudflare credentials
are private and must never appear in client JavaScript or GitHub.
