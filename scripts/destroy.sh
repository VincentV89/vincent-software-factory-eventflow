#!/usr/bin/env bash
# Removes every resource created by the EventFlow stack (including all registration data).
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"
REGION="${EVENTFLOW_REGION:-$(node -p "require('$ROOT/infra/cdk.json').context['eventflow:region']")}"
STACK="$(node -p "require('$ROOT/infra/cdk.json').context['eventflow:stackName']")"
if [ -z "${AWS_ACCESS_KEY_ID:-}" ] && [ -z "${AWS_PROFILE:-}" ]; then
  eval "$(aws configure export-credentials --format env 2>/dev/null || true)"
fi
export AWS_REGION="$REGION" AWS_DEFAULT_REGION="$REGION" CDK_DEFAULT_REGION="$REGION"
export CDK_DEFAULT_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
[ -d "$ROOT/frontend/dist" ] || (cd "$ROOT" && npm run build -w frontend)
(cd "$ROOT/infra" && npx cdk destroy --force)
# Optional organizer temp-password parameters created by scripts/create-organizer.mjs --store-ssm
for p in $(aws ssm get-parameters-by-path --path "/eventflow/$STACK/" --recursive --region "$REGION" --query 'Parameters[].Name' --output text 2>/dev/null); do
  aws ssm delete-parameter --name "$p" --region "$REGION" && echo "deleted $p"
done
echo "EventFlow stack $STACK removed from $REGION."
