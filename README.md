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

Useful DocuSign references:

- [Build a Connect listener](https://developers.docusign.com/platform/webhooks/connect/build-listener/)
- [JWT Grant authentication](https://developers.docusign.com/platform/auth/jwt/)
- [eSignature REST API](https://developers.docusign.com/docs/esign-rest-api/)
