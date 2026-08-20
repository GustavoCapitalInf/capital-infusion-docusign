# DocuSign completed-envelope webhook

A dependency-free Node.js service that receives DocuSign Connect notifications at
`POST /api/webhooks/docusign`, acknowledges them immediately, then retrieves and
stores every completed-envelope document in the background.

## Configure

Requirements: Node.js 20 or newer, a DocuSign demo integration key with an RSA key,
and one-time user consent for the `signature impersonation` scopes.

1. Copy `.env.example` to your secrets manager or shell environment. This project
   deliberately does not load dotenv files. The existing local `env` file and all
   `.env`, `.pem`, and `.key` files are ignored by Git.
2. Set `DOCUSIGN_USER_ID` to the API user GUID being impersonated. This user must
   have permission to read the envelopes; it does not need to be the sender's email.
3. Set `DOCUSIGN_ACCOUNT_ID` and the account's API base URI. In demo, the base URI
   is commonly `https://demo.docusign.net`, but use the `base_uri` returned by
   DocuSign's `/oauth/userinfo` response for the impersonated user.
4. In the DocuSign Connect configuration, enable JSON notifications for Envelope
   Completed, create an HMAC key, and put that exact HMAC key in
   `DOCUSIGN_CONNECT_HMAC_SECRET`. Do not use the RSA private key here.
5. Grant consent once while signed in as the API user by opening (replace values):

   ```text
   https://account-d.docusign.com/oauth/auth?response_type=code&scope=signature%20impersonation&client_id=INTEGRATION_KEY&redirect_uri=REGISTERED_REDIRECT_URI
   ```

The authorization code produced by that redirect is not used by JWT Grant. If the
API user cannot grant individual consent, an administrator can grant organization
consent instead.

Example shell setup:

```bash
set -a
source env
set +a
npm start
```

`GET /health` returns `{"status":"ok"}`. Configure Connect to deliver to a public
HTTPS URL ending in `/api/webhooks/docusign` (a secure tunnel is fine for demo).

## Storage and behavior

Events are claimed atomically under `data/docusign/events`, keyed by provider,
envelope ID, and event type. A processed or in-flight duplicate is acknowledged but
not downloaded again; a later delivery retries a failed event. Documents are saved
under `data/docusign/envelopes/<envelope-id>/documents`, and `metadata.json` records
the original filename, DocuSign document ID, byte count, and category:

- `application`: normal envelope documents
- `certificate`: completion certificate/summary files
- `supplemental`: attachments or other DocuSign file types

The sender allowlist is comma-separated and case-insensitive. When sender data is
absent from the webhook, the processor fetches envelope metadata before applying
the allowlist. An empty `DOCUSIGN_ALLOWED_SENDERS` allows all senders.

HMAC validation is on by default and uses the unmodified raw body plus any of the
`X-DocuSign-Signature-1` through `-5` headers. For an explicit local replay only,
set `DOCUSIGN_REQUIRE_HMAC=false`; never use that setting on a public endpoint.

## Test

```bash
npm test
```

For the end-to-end demo: start the public endpoint, use DocuSign's Connect test,
send and complete a demo envelope, then verify the structured logs and the new
envelope directory under `data/docusign`. Access tokens, key material, and document
contents are never logged.

## Render deployment

The existing Render web service is configured with:

```text
Build Command: npm install
Start Command: npm start
Health Check Path: /health
Health Check URL: https://capital-infusion-docusign.onrender.com/health
DocuSign Webhook: https://capital-infusion-docusign.onrender.com/api/webhooks/docusign
```

Add these environment variables in the Render dashboard:

```text
LOG_LEVEL=info
DOCUSIGN_INTEGRATION_KEY=<integration-key-guid>
DOCUSIGN_USER_ID=<api-user-guid>
DOCUSIGN_ACCOUNT_ID=<account-guid>
DOCUSIGN_PRIVATE_KEY_PATH=/etc/secrets/docusign-private.key
DOCUSIGN_AUTH_SERVER=account-d.docusign.com
DOCUSIGN_BASE_URL=https://demo.docusign.net
DOCUSIGN_ALLOWED_SENDERS=hr@capital-infusion.com
DOCUSIGN_CONNECT_HMAC_SECRET=<connect-hmac-secret>
DOCUSIGN_REQUIRE_HMAC=true
DOCUSIGN_STORAGE_DIR=./data/docusign
DOCUSIGN_MAX_WEBHOOK_BYTES=1048576
R2_ACCOUNT_ID=<cloudflare-account-id>
R2_ENDPOINT=https://<cloudflare-account-id>.r2.cloudflarestorage.com
R2_BUCKET_NAME=capital-infusion-docusign
R2_ACCESS_KEY_ID=<r2-access-key-id>
R2_SECRET_ACCESS_KEY=<r2-secret-access-key>
CONTRACT_NOTIFICATION_EMAIL=gustavo@capital-infusion.com
CONTRACT_EMAIL_PROVIDER=resend
CONTRACT_EMAIL_FROM=Capital Infusion Contracts <contracts@your-verified-domain.com>
RESEND_API_KEY=<resend-api-key>
```

Do not set `PORT` manually unless the Render service requires an override; Render
provides it automatically and the server binds it on `0.0.0.0`. Local development
continues to default to port `3000`.

In the service's **Environment → Secret Files** section, create a secret file named
`docusign-private.key`. Paste the complete RSA PEM file, including
its `BEGIN` and `END` lines, as the file contents. Render exposes it at runtime as
`/etc/secrets/docusign-private.key`, which is the exact value to use for
`DOCUSIGN_PRIVATE_KEY_PATH`.

### Storage warning

When all five `R2_*` variables are absent, the application uses
`DOCUSIGN_STORAGE_DIR=./data/docusign` for local development. Render's filesystem is
ephemeral, so local files can disappear after a deploy, restart, or free service
spin-down.

When any `R2_*` variable is present, all five are required and the application uses
Cloudflare R2. It will not silently fall back to ephemeral storage if R2 is only
partially configured. Startup logs the selected provider and bucket name but never
credentials.

The R2 bucket must remain private. Do not enable public access, an `r2.dev` URL,
public ACLs, or browser/frontend access. All access uses the server-side S3-compatible
client with region `auto`. Objects use this structure:

```text
docusign/
  envelopes/
    {envelopeId}/
      documents/
        {documentId}-{safeFilename}.pdf
        certificate-Summary.pdf
      metadata.json
  events/
    {eventHash}.json
    {eventHash}.json.lock
```

Event locks are created with conditional `If-None-Match: *` writes. This prevents
concurrent duplicate processing, while deterministic object keys make a retry safe
if an earlier upload only partially completed. Stale locks can be reclaimed after
15 minutes with an ETag-conditioned write.

To test R2 safely after deployment, run:

```bash
curl -X POST https://capital-infusion-docusign.onrender.com/api/storage/test-r2
```

The check uploads a tiny uniquely named object under `healthchecks/`, verifies it
with `HEAD`, and deletes it. It returns only booleans, provider, bucket, and a safe
error code. This temporary endpoint should be removed after production setup has
been verified.

## Rep-centric document catalog

Completed envelopes are grouped by the authoritative completed DocuSign signer,
not by the sender. `DOCUSIGN_ALLOWED_SENDERS` remains an independent ingestion
control: for example, HR may be the allowed sender while `gustavoprietop@gmail.com`
is the signer and therefore the rep. Signer email is normalized to lowercase and
is the stable rep ID. DocuSign's signer name is preferred; otherwise a readable
name is derived from the email username.

The resolver considers only DocuSign `signers` whose status is `completed` or that
have a signing timestamp. Carbon-copy recipients are excluded. Repeated signer
records with the same normalized email are deduplicated. Exactly one unique
completed signer resolves the rep; zero becomes `unassigned`, and multiple distinct
completed signers become `requires-resolution` instead of being guessed.

R2 keeps the canonical envelope layout unchanged and adds logical JSON indexes:

```text
docusign/reps/index.json
docusign/reps/{encodedRepId}/index.json
docusign/envelopes/index.json
```

Index updates use ETag conditions and replace entries by envelope ID, so duplicate
webhooks cannot append duplicate rep-envelope relationships. If indexes do not yet
exist, the first catalog request backfills them by listing envelope prefixes and
reading only `metadata.json`—document bodies are not scanned or downloaded.

At startup, legacy sender-based metadata is detected by its missing
`repSource: completed_signer` marker. The migration requests only recipient metadata
from DocuSign, rewrites the envelope's sender and signer identity fields, and then
rebuilds schema-versioned indexes from `metadata.json`. It never downloads document
bodies. Stale sender groups are emptied, and unique envelope IDs prevent count
inflation.

Catalog APIs:

```text
GET /api/reps
GET /api/reps/:repId/envelopes
GET /api/docusign/envelopes
GET /api/docusign/envelopes/:envelopeId
GET /api/docusign/envelopes/:envelopeId/documents/:documentId
```

The listing APIs support `search` and `sort` query parameters. Document access
validates the envelope and document IDs against private metadata, then streams the
object through the backend with private/no-store headers. Clients never submit or
receive an R2 object key, credential, or permanent object URL. Add `?download=true`
to request a download instead of inline viewing.

The internal interface is available at:

```text
/documents
/documents/reps/:repId
/documents/envelopes/:envelopeId
```

It uses the catalog APIs for rep search, rep/envelope sorting, detail views, and
private PDF viewing/downloading. A normal refresh reflects indexes updated by the
latest completed-envelope webhook.

## Contract lifecycle and renewal reminders

Only PDF names matching the case-insensitive, whitespace-tolerant
`Capital Infusion - <Rep Name>.pdf` convention affect contract state. The completed
signer's normalized email remains the rep ID; the name in the filename is never an
identity key. Other envelope documents remain stored and counted normally.

Contract state is stored separately from the immutable envelope/document layout:

```text
docusign/contracts/reps/{encodedRepId}/lifecycle.json
docusign/contracts/notifications/{encodedEnvelopeIdAndThreshold}.json
```

Unique tracked envelopes are sorted by completion time. The first is Tier 1, the
second Tier 2, and the third and later contracts remain Tier 3. Previous contracts
remain in history as `superseded`; the newest is `active`. Expiration uses six UTC
calendar months with end-of-month clamping, not 180 days. Multiple matching PDFs
in one envelope create `requires_contract_resolution` without advancing a tier.

Startup backfill reads existing envelope `metadata.json` files, uses the stored
signer identity and document names, and reconstructs lifecycle history without
downloading PDFs. It merges with any concurrently created lifecycle record and does
not delete envelope or notification data.

Lifecycle APIs:

```text
GET /api/reps/:repId/contract
GET /api/contracts/renewals
```

`GET /api/reps` and `GET /api/reps/:repId/envelopes` also include safe contract
summaries. Envelope counts continue to represent every completed envelope. The UI
adds tier/expiration information, a renewal dashboard, and contract history without
showing compensation data.

### Daily reminder job

The email adapter uses Resend's HTTP API. Configure a verified sender in
`CONTRACT_EMAIL_FROM`, the destination in `CONTRACT_NOTIFICATION_EMAIL`, and the API
secret in `RESEND_API_KEY`. Secrets must be Render environment variables, never
source-controlled.

Create a Render Cron Job from this repository with:

```text
Command:  npm run contract-reminders
Schedule: 0 13 * * *
```

Render evaluates schedules in UTC, so this runs daily at 13:00 UTC. Give the cron
job the same `R2_*` variables as the web service plus the four contract-email
variables above. The command performs one scan and exits; it does not start the web
server.

Tier 1 and Tier 2 contracts use 30/15/7/0-day thresholds. If a run is missed, only
the nearest crossed threshold is eligible: 14 days remaining selects the 15-day
reminder and never the older 30-day reminder. Each send first conditionally creates
the persistent `{envelopeId}:{threshold}` notification record. The same identity is
also sent as Resend's `Idempotency-Key`, and successful delivery changes the record
to `sent`. Logs contain counts, rep ID, and threshold only—never document bodies or
provider credentials.

Startup reports only the names of missing DocuSign variables. It does not print
their values, and `/health` remains available while DocuSign processing is being
configured.

### Temporary JWT authentication diagnostic

During integration setup, call:

```text
GET https://capital-infusion-docusign.onrender.com/api/docusign/test-auth
```

The endpoint checks that the RSA Secret File can be loaded and parsed, exchanges a
JWT using the `signature impersonation` scopes, calls DocuSign `/oauth/userinfo`, and
returns only the selected account ID, account name, and API base URI. It never
returns the private key, JWT assertion, access token, or authorization header.

This endpoint is temporary and should be removed or access-controlled after JWT
setup has been verified.

### Temporary HMAC diagnostics

During Connect HMAC troubleshooting, the webhook logs only safe request metadata:
content type, whether the raw body is a Buffer, its byte length, signature-header
presence/count, whether the HMAC secret is configured, and the validation result.
The latest in-memory result is also available at:

```text
GET https://capital-infusion-docusign.onrender.com/api/docusign/hmac-diagnostics
```

Neither the log nor diagnostic endpoint includes the request body, supplied or
calculated signature, HMAC secret, private key, JWT, or access token. The diagnostic
endpoint is temporary and should be removed after HMAC setup is verified.

Useful DocuSign references:

- [Build a Connect listener](https://developers.docusign.com/platform/webhooks/connect/build-listener/)
- [JWT Grant authentication](https://developers.docusign.com/platform/auth/jwt/)
- [eSignature REST API](https://developers.docusign.com/docs/esign-rest-api/)
- [Render environment variables and secret files](https://render.com/docs/configure-environment-variables)
- [Render Cron Jobs](https://render.com/docs/cronjobs)
- [Render persistent disks](https://render.com/docs/disks)
- [Resend send-email API and idempotency header](https://resend.com/docs/api-reference/emails/send-email)
