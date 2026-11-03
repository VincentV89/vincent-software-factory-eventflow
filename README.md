# EventFlow

EventFlow is a serverless event registration and management platform. This repo is the CloudSummit 2027 tech conference (300 seats). Visitors register on a public site. Organizers sign in to a Cognito-protected dashboard to see KPIs, charts and a searchable attendee table, and to cancel registrations.

| Layer | Technology |
|---|---|
| Frontend | React 19, TypeScript, Vite, Tailwind CSS v4, [Cloudscape Design System](https://cloudscape.design) (components + charts) |
| Hosting | Private Amazon S3 bucket behind Amazon CloudFront with Origin Access Control (OAC), HTTPS only, security headers / CSP |
| API | Amazon API Gateway **HTTP API** with Cognito JWT authorizer, CORS restricted to the CloudFront origin, throttling |
| Compute | AWS Lambda, Node.js 22 (arm64), one least-privilege function per route |
| Data | Amazon DynamoDB, on-demand capacity, single-table design, PITR, encryption at rest |
| Auth | Amazon Cognito user pool (invite only, no self sign-up), `organizers` group |
| Observability | Amazon CloudWatch Logs (structured JSON Lambda logs + API access logs, 30-day retention, no PII) |
| IaC | AWS CDK v2 (TypeScript) |

```
Browser ──HTTPS──▶ CloudFront ──OAC──▶ S3 (SPA + config.json)
   │
   ├──HTTPS──▶ API Gateway HTTP API ──▶ Lambda (get-event, register)           ──▶ DynamoDB
   │                 └─ JWT authorizer ─▶ Lambda (list, cancel; organizers only) ──▶ DynamoDB
   └──HTTPS──▶ Cognito User Pool (organizer sign-in)
```

## API

| Method & path | Auth | Description |
|---|---|---|
| `GET /events/{eventId}` | public | Event details and **aggregate** counts only (capacity, registered, available, %). No attendee data. |
| `POST /events/{eventId}/registrations` | public | Body `{ name, email, organization }`. Returns `201` with `confirmationId`, `400` on validation errors, `409 DUPLICATE_REGISTRATION`, `409 EVENT_FULL`. |
| `GET /events/{eventId}/registrations` | Cognito access token + `organizers` group | Full attendee list. |
| `DELETE /events/{eventId}/registrations/{confirmationId}` | Cognito access token + `organizers` group | Cancels the registration and frees the seat. |

### Data model (single table)

| PK | SK | Purpose |
|---|---|---|
| `EVENT#<eventId>` | `META` | Event details, `capacity` and the `registeredCount` counter |
| `EVENT#<eventId>` | `REG#<confirmationId>` | Registration (name, email, organization, status, timestamps) |
| `EVENT#<eventId>` | `EMAIL#<sha256(email)>` | Uniqueness lock for active registrations (the key holds a hash, never the raw email) |

**Capacity and duplicate guarantees.** Each registration is a single DynamoDB `TransactWriteItems` call that does three things:

1. Increments `registeredCount`, but only if `registeredCount < capacity`.
2. Creates the email lock, but only if it doesn't already exist.
3. Creates the registration item.

Either all three writes succeed or none do. Even with many concurrent requests, the counter can't go over capacity and the same email can't register twice. Transaction conflicts are retried with jittered backoff. The smoke test checks this by sending 30 parallel registrations at a 5-seat event; exactly 5 succeed. Cancelling is also one transaction: it marks the registration `CANCELLED`, deletes the email lock and decrements the counter.

Confirmation IDs look like `EVF-XXXXXXXXXX`: 10 random Crockford base32 characters (50 bits). The registration item's `attribute_not_exists` condition guarantees each ID is unique.

## Security

- **No secrets in the frontend.** The SPA loads `/config.json`, which the CDK deployment writes. It holds public identifiers only: API URL, user pool ID, app client ID and region. The Cognito app client is public and has no secret.
- **Organizer APIs are protected twice.** The API Gateway JWT authorizer checks the token's signature, issuer, client and expiry. The Lambda then requires membership of the `organizers` group (`cognito:groups`), so any other signed-in user gets `403`.
- **Public endpoints never return attendee data.**
- **Input validation:** JSON content type only, body ≤ 4 KB, length limits, a strict email check, and control characters and `<>` are rejected. Unexpected errors return a generic `500`.
- **Least-privilege IAM:** each Lambda gets only the DynamoDB actions it needs (for example, register gets `PutItem` + `UpdateItem`), scoped to this one table. No function has `Scan` or `*`.
- **CORS** allows only the CloudFront origin, plus anything you explicitly add to `eventflow:extraCorsOrigins` in `infra/cdk.json`.
- **Logs:** Lambda logs contain only event IDs, confirmation IDs and error codes. API access logs contain request metadata only (no bodies, headers or tokens).
- **Hosting:** S3 Block Public Access is on and TLS is enforced. CloudFront redirects to HTTPS and sends HSTS, a CSP, `X-Frame-Options: DENY`, `nosniff` and a referrer policy.
- **Cognito:** self sign-up is disabled, passwords need at least 12 characters with mixed character classes, temporary passwords must be changed on first sign-in, and tokens are stored in `sessionStorage` only.

## Prerequisites

- Node.js ≥ 20 and npm
- AWS CLI v2 with credentials for the target account (`aws sts get-caller-identity` must work)
- The account/region must be CDK-bootstrapped. `scripts/deploy.sh` runs `cdk bootstrap` automatically if it isn't.

## Deploy

```bash
npm ci
npm run deploy          # = bash scripts/deploy.sh
```

The script does the following:

1. Prints the AWS account and region.
2. Builds the backend, frontend and infra.
3. Runs `cdk deploy`.

The deploy creates all resources, uploads the SPA and writes `config.json`, so the frontend is wired to the new API automatically. It also invalidates CloudFront. A one-time CDK **Trigger** then creates the event and seeds **168 fictional registrations**, about 6% of them cancelled. All seeded emails use `*.example` domains. Stack outputs are written to `infra/outputs.json`.

The stack name and region live in `infra/cdk.json` (`eventflow:stackName`, `eventflow:region`). To skip seeding, set `eventflow:seedMockData` to `false` before the first deploy.

## Organizer login

No credentials are hardcoded anywhere. To create an organizer account, run:

```bash
# Cognito emails a temporary password to the address:
npm run create-organizer -- --email you@company.com

# Or keep it out of email: store the temporary password as an SSM SecureString and read it yourself
npm run create-organizer -- --email you@company.com --store-ssm
aws ssm get-parameter --region us-east-1 --with-decryption \
  --name '/eventflow/<stackName>/organizer-temp-password/you@company.com' --query Parameter.Value --output text

# Or print it once in your own terminal:
npm run create-organizer -- --email you@company.com --print
```

Then open `https://<WebsiteUrl>/organizer/login`, sign in with the email and temporary password, and choose a new password. The new password must be at least 12 characters with upper and lower case letters, a digit and a symbol. You'll land on the dashboard.

Running the script again for an existing user resets that user's temporary password.

## Test

```bash
npm test                 # backend unit tests (vitest + aws-sdk-client-mock) and CDK assertion tests
npm run build            # type-check everything and build the SPA
npm run smoke-test       # end-to-end tests against the deployed stack
```

The smoke test covers:

- CloudFront and `config.json`, security headers, SPA deep links
- CORS allow/deny
- The public event endpoint, validation, registration and the case-insensitive duplicate guard
- Persistence: reads the item directly from DynamoDB
- `401` without a token, `403` for a signed-in non-organizer, `200` for an organizer
- Cancellation, freeing the seat, and re-registering afterwards
- A concurrency race on a throwaway 5-seat event

It creates temporary Cognito users and test items, and deletes them all when it finishes.

## Local development

```bash
# after deploying, point the dev server at the deployed backend:
node -e "const o=Object.values(require('./infra/outputs.json'))[0];require('fs').writeFileSync('frontend/public/config.json',JSON.stringify({apiUrl:o.ApiUrl,region:'us-east-1',userPoolId:o.UserPoolId,userPoolClientId:o.UserPoolClientId,eventId:o.EventId}))"
```

Add `"http://localhost:5173"` to `eventflow:extraCorsOrigins` in `infra/cdk.json`, redeploy, then run `npm run dev -w frontend`.

## Cleanup

```bash
npm run destroy          # = bash scripts/destroy.sh
```

This deletes the whole CloudFormation stack: the CloudFront distribution, the S3 bucket and its objects, the API, the Lambdas, their log groups, the DynamoDB table **and all its data**, and the Cognito user pool. It also deletes any SSM parameters under `/eventflow/<stackName>/` created by `create-organizer --store-ssm`. The shared CDK bootstrap stack (`CDKToolkit`) isn't touched.

## Cost notes

Everything is pay-per-use. DynamoDB on-demand, Lambda, HTTP API and CloudFront (PriceClass 100) cost close to nothing at demo traffic. The Cognito Lite tier is free up to 10k monthly active users. PITR adds a negligible per-GB charge for this tiny table.

A few supporting resources aren't in the core architecture list but are created by CDK and cost nothing while idle:

- **BucketDeployment:** a Lambda that uploads the SPA and `config.json`.
- **Trigger:** runs the one-time seed function.
- **autoDeleteObjects:** a custom resource that empties the bucket on destroy.

## Current development deployment

| | |
|---|---|
| Account / region | `879594333699` / `us-east-1` |
| CloudFormation stack | `bgagent-dev-vincentv89-vincent-software-factory-eventflow-2496381a358f` (configured in `infra/cdk.json`) |
| Website | https://d1p2af49hpm8dh.cloudfront.net |
| API | https://1a6tw32ipl.execute-api.us-east-1.amazonaws.com |
| Organizer login | https://d1p2af49hpm8dh.cloudfront.net/organizer/login, user `organizer@eventflow.example`. To get the temporary password, run `aws ssm get-parameter --region us-east-1 --with-decryption --name '/eventflow/bgagent-dev-vincentv89-vincent-software-factory-eventflow-2496381a358f/organizer-temp-password/organizer_eventflow.example' --query Parameter.Value --output text`. Alternatively, create your own account with `npm run create-organizer -- --email you@company.com`. |

Resources in the stack:

- CloudFront distribution and response-headers policy
- Private S3 bucket `eventflow-dev-site-879594333699-us-east-1`
- API Gateway HTTP API with a JWT authorizer
- 5 Lambda functions (get-event, register, list, cancel, seed), plus the CDK helper Lambdas for BucketDeployment, Trigger and S3 auto-delete
- DynamoDB table (on-demand)
- Cognito user pool, app client and `organizers` group
- CloudWatch log groups
- IAM roles
