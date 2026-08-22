#!/usr/bin/env bash

set -euo pipefail

AWS_REGION="${CONCLAVIA_AWS_REGION:-eu-central-1}"
AWS_PROFILE_NAME="${CONCLAVIA_AWS_PROFILE:-conclavia-studio}"
BOOTSTRAP_PROFILE="${CONCLAVIA_AWS_BOOTSTRAP_PROFILE:-}"
STACK_NAME="${CONCLAVIA_ROLES_ANYWHERE_STACK:-conclavia-roles-anywhere}"
DEVICE_COMMON_NAME="${CONCLAVIA_DEVICE_COMMON_NAME:-conclavia-ram020}"
HELPER_PATH="${CONCLAVIA_SIGNING_HELPER_PATH:-/Users/vincenzo/.local/bin/aws_signing_helper}"

if [[ ! -x "$HELPER_PATH" ]]; then
  echo "aws_signing_helper non trovato in $HELPER_PATH"
  exit 1
fi

bootstrap_arguments=(--region "$AWS_REGION")
if [[ -n "$BOOTSTRAP_PROFILE" ]]; then
  bootstrap_arguments+=(--profile "$BOOTSTRAP_PROFILE")
fi

read -r role_arn profile_arn trust_anchor_arn < <(
  aws cloudformation describe-stacks \
    --stack-name "$STACK_NAME" \
    "${bootstrap_arguments[@]}" \
    --query 'Stacks[0].[Outputs[?OutputKey==`DeviceRoleArn`].OutputValue | [0], Outputs[?OutputKey==`ProfileArn`].OutputValue | [0], Outputs[?OutputKey==`TrustAnchorArn`].OutputValue | [0]]' \
    --output text
)

if [[ -z "$role_arn" || -z "$profile_arn" || -z "$trust_anchor_arn" ]]; then
  echo "Output Roles Anywhere incompleti nello stack $STACK_NAME."
  exit 1
fi

certificate_selector="Key=x509Subject,Value=CN=$DEVICE_COMMON_NAME,OU=Studio Controller,O=Conclavia"
credential_process="$HELPER_PATH credential-process --cert-selector \"$certificate_selector\" --use-latest-expiring-certificate --role-arn $role_arn --profile-arn $profile_arn --trust-anchor-arn $trust_anchor_arn --region $AWS_REGION"

aws configure set region "$AWS_REGION" --profile "$AWS_PROFILE_NAME"
aws configure set output json --profile "$AWS_PROFILE_NAME"
aws configure set credential_process "$credential_process" --profile "$AWS_PROFILE_NAME"
aws sts get-caller-identity \
  --profile "$AWS_PROFILE_NAME" \
  --region "$AWS_REGION" \
  --query '{Account:Account,Arn:Arn}' \
  --output json

echo "Profilo AWS $AWS_PROFILE_NAME configurato con credenziali temporanee Roles Anywhere."
