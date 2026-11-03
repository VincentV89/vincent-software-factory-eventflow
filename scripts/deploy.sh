#!/usr/bin/env bash
# Builds and deploys EventFlow (backend + frontend) with AWS CDK in one step.
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGION="${EVENTFLOW_REGION:-$(node -p "require('$ROOT/infra/cdk.json').context['eventflow:region']")}"
STACK="$(node -p "require('$ROOT/infra/cdk.json').context['eventflow:stackName']")"

# Some environments (e.g. container/role credentials only visible to the AWS CLI) need the
# CLI's resolved credentials passed to CDK/Node. Values are exported to this process only, never printed.
if [ -z "${AWS_ACCESS_KEY_ID:-}" ] && [ -z "${AWS_PROFILE:-}" ]; then
  eval "$(aws configure export-credentials --format env 2>/dev/null || true)"
fi
echo "==> AWS identity"
ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
echo "    account=$ACCOUNT region=$REGION stack=$STACK"

export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION" CDK_DEFAULT_REGION="$REGION" CDK_DEFAULT_ACCOUNT="$ACCOUNT"

cd "$ROOT"
[ -d node_modules ] || npm ci
echo "==> Build"
npm run build
echo "==> Ensure CDK bootstrap (no-op if already bootstrapped)"
if ! aws ssm get-parameter --name /cdk-bootstrap/hnb659fds/version --region "$REGION" >/dev/null 2>&1; then
  (cd infra && npx cdk bootstrap "aws://$ACCOUNT/$REGION")
fi
echo "==> Deploy"
(cd infra && npx cdk deploy --require-approval never --outputs-file outputs.json "$@")
echo "==> Done"
node -e "const o=require('$ROOT/infra/outputs.json');const s=Object.values(o)[0];console.log('Website: '+s.WebsiteUrl+'\nAPI:     '+s.ApiUrl)"
