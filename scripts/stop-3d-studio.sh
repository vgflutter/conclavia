#!/usr/bin/env bash

set -euo pipefail

AWS_REGION="eu-central-1"
AWS_PROFILE="${CONCLAVIA_AWS_PROFILE:-conclavia-studio}"
INSTANCE_ID="i-033248199865f3e6e"
SECURITY_GROUP_ID="sg-0b2e4054a32145ed7"
export AWS_PROFILE

if ! aws sts get-caller-identity --region "$AWS_REGION" >/dev/null 2>&1; then
  echo "Profilo AWS $AWS_PROFILE non disponibile. Esegui una volta il bootstrap IAM Roles Anywhere."
  exit 1
fi

if [[ -f .env.local ]]; then
  readarray_output=$(node <<'NODE'
const fs = require("node:fs");
const env = Object.fromEntries(
  fs.readFileSync(".env.local", "utf8")
    .split(/\r?\n/)
    .filter((line) => line && !line.startsWith("#") && line.includes("="))
    .map((line) => {
      const index = line.indexOf("=");
      return [line.slice(0, index), line.slice(index + 1).replace(/^['"]|['"]$/g, "")];
    }),
);
process.stdout.write(`${env.UNREAL_STUDIO_SUPERVISOR_URL ?? ""}\n${env.UNREAL_STUDIO_TOKEN ?? ""}`);
NODE
)
  SUPERVISOR_URL=$(printf '%s\n' "$readarray_output" | sed -n '1p')
  SUPERVISOR_TOKEN=$(printf '%s\n' "$readarray_output" | sed -n '2p')
  if [[ -n "$SUPERVISOR_URL" && -n "$SUPERVISOR_TOKEN" ]]; then
    curl --fail --silent \
      --connect-timeout 3 \
      --max-time 8 \
      --request POST \
      --header "Authorization: Bearer $SUPERVISOR_TOKEN" \
      --header "Content-Type: application/json" \
      --data '{}' \
      "$SUPERVISOR_URL/stop" >/dev/null || true
  fi
fi

echo "Spengo la GPU Unreal…"
aws ec2 stop-instances \
  --region "$AWS_REGION" \
  --instance-ids "$INSTANCE_ID" \
  --output text >/dev/null

STOPPED=false
for _ in $(seq 1 36); do
  INSTANCE_STATE=$(aws ec2 describe-instances \
    --region "$AWS_REGION" \
    --instance-ids "$INSTANCE_ID" \
    --query 'Reservations[0].Instances[0].State.Name' \
    --output text)
  if [[ "$INSTANCE_STATE" == "stopped" ]]; then
    STOPPED=true
    break
  fi
  sleep 5
done

if [[ "$STOPPED" != "true" ]]; then
  echo "Windows non ha completato l'arresto: applico lo stop EC2 forzato."
  aws ec2 stop-instances \
    --region "$AWS_REGION" \
    --instance-ids "$INSTANCE_ID" \
    --force \
    --skip-os-shutdown \
    --output text >/dev/null
  aws ec2 wait instance-stopped \
    --region "$AWS_REGION" \
    --instance-ids "$INSTANCE_ID"
fi

for RULE_ID in $(aws ec2 describe-security-group-rules \
  --region "$AWS_REGION" \
  --filters "Name=group-id,Values=$SECURITY_GROUP_ID" \
  --query 'SecurityGroupRules[?IsEgress==`false` && (FromPort==`8080` || FromPort==`8090` || FromPort==`19303` || FromPort==`49152`)].SecurityGroupRuleId' \
  --output text); do
  aws ec2 revoke-security-group-ingress \
    --region "$AWS_REGION" \
    --group-id "$SECURITY_GROUP_ID" \
    --security-group-rule-ids "$RULE_ID" \
    --output text >/dev/null
done

echo "Studio 3D spento; il costo compute della g6 è arrestato."
