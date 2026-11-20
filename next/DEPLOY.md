# Cloudflare deployment checklist — do not deploy until ALL gates pass

This is a NEW `finance-manager-v2` Worker and D1 database. The existing
`finance-manager-web` Worker remains untouched.

1. Create a NEW D1 database in Cloudflare dashboard named `finance-manager-v2`
   (or `npx wrangler d1 create finance-manager-v2`).
2. Copy `next/server/wrangler.toml.example` to `next/server/wrangler.toml`,
   then replace `SET_REAL_DATABASE_ID_HERE` with the returned database UUID.
   Do not commit account credentials. This file is gitignored.
3. Apply migrations from the repo using
   `npx wrangler d1 migrations apply finance-manager-v2 --remote --config next/server/wrangler.toml`.
4. Set up a **Cloudflare Access application for the FULL workers.dev hostname**
   of the new Worker. Use an Allow policy listing only approved user emails;
   do not use a Bypass policy or make the API publicly accessible.
5. Run the following in `next/server`:
   `npx wrangler secret put ACCESS_TEAM_DOMAIN`
   `npx wrangler secret put ACCESS_AUD`
   `npx wrangler secret put ACCESS_ALLOWED_EMAILS`
   Use the Access team domain (https://<team>.cloudflareaccess.com),
   application AUD tag, and comma-separated allowed emails.
6. Configure `PUBLIC_ORIGIN` as a Worker variable or secret with the **exact**
   browser origin (e.g. https://finance-manager-v2.<subdomain>.workers.dev).
7. Compile Rust client to `next/dist` and Rust Worker using `worker-build`.
8. Verify: no JWT -> 401, bad JWT -> 401, valid email -> 200,
   idempotent D1 writes, no cross-tenant reads, browser E2E.
9. Only then `npx wrangler deploy --config next/server/wrangler.toml`.

Source code is public; D1 and Worker secrets are never public by being in GitHub.
Do not delete or alter the original Google Sheets until a verified migration is approved.
