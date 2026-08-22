#!/usr/bin/env bash

set -euo pipefail

AWS_REGION="eu-central-1"
AWS_PROFILE="${CONCLAVIA_AWS_PROFILE:-conclavia-studio}"
INSTANCE_ID="i-033248199865f3e6e"
SECURITY_GROUP_ID="sg-0b2e4054a32145ed7"
AUTO_STOP_BUCKET="conclavia-unreal-poc-transfer-194000006241"
AUTO_STOP_MINUTES="${CONCLAVIA_3D_MAX_RUNTIME_MINUTES:-120}"
export AWS_PROFILE

if ! [[ "$AUTO_STOP_MINUTES" =~ ^[0-9]+$ ]] \
  || (( AUTO_STOP_MINUTES < 15 || AUTO_STOP_MINUTES > 720 )); then
  echo "CONCLAVIA_3D_MAX_RUNTIME_MINUTES deve essere compreso tra 15 e 720."
  exit 1
fi

command -v node >/dev/null || {
  echo "Node.js non trovato."
  exit 1
}
if ! aws sts get-caller-identity --region "$AWS_REGION" >/dev/null 2>&1; then
  echo "Profilo AWS $AWS_PROFILE non disponibile. Esegui una volta il bootstrap IAM Roles Anywhere."
  exit 1
fi

echo "Avvio della GPU Unreal…"
# EC2 rejects a start request while a previous stop is still settling. Waiting
# here also prevents the stale SSM agent from making the script report a false
# ready state for an instance that is still stopping.
CURRENT_STATE=$(aws ec2 describe-instances \
  --region "$AWS_REGION" \
  --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].State.Name' \
  --output text)
if [[ "$CURRENT_STATE" == "stopping" ]]; then
  aws ec2 wait instance-stopped \
    --region "$AWS_REGION" \
    --instance-ids "$INSTANCE_ID"
fi
aws ec2 start-instances \
  --region "$AWS_REGION" \
  --instance-ids "$INSTANCE_ID" \
  --output text >/dev/null
aws ec2 wait instance-running \
  --region "$AWS_REGION" \
  --instance-ids "$INSTANCE_ID"
aws ec2 wait instance-status-ok \
  --region "$AWS_REGION" \
  --instance-ids "$INSTANCE_ID"

PUBLIC_IP=$(aws ec2 describe-instances \
  --region "$AWS_REGION" \
  --instance-ids "$INSTANCE_ID" \
  --query 'Reservations[0].Instances[0].PublicIpAddress' \
  --output text)
CLIENT_IP=$(curl --fail --silent --show-error https://checkip.amazonaws.com | tr -d '[:space:]')

if [[ -z "$PUBLIC_IP" || "$PUBLIC_IP" == "None" || -z "$CLIENT_IP" ]]; then
  echo "Impossibile determinare l'indirizzo pubblico dello studio o del Mac."
  exit 1
fi

# Keep the expensive renderer private to this Mac. Old test rules are removed
# because both addresses can change whenever the instance or network restarts.
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

authorize_ingress() {
  local permission="$1"
  local output
  if ! output=$(aws ec2 authorize-security-group-ingress \
    --region "$AWS_REGION" \
    --group-id "$SECURITY_GROUP_ID" \
    --ip-permissions "$permission" \
    --output text 2>&1); then
    # EC2 security-group changes are eventually consistent. A fast restart can
    # still see a just-revoked rule and report it as a duplicate. The desired
    # access is already present in that case, so continuing is safe.
    if [[ "$output" != *"InvalidPermission.Duplicate"* ]]; then
      echo "$output" >&2
      return 1
    fi
  fi
}

authorize_ingress "IpProtocol=tcp,FromPort=8080,ToPort=8080,IpRanges=[{CidrIp=$CLIENT_IP/32,Description='Conclavia Pixel Streaming player'}]"
authorize_ingress "IpProtocol=tcp,FromPort=8090,ToPort=8090,IpRanges=[{CidrIp=$CLIENT_IP/32,Description='Conclavia protected supervisor'}]"
authorize_ingress "IpProtocol=tcp,FromPort=19303,ToPort=19303,IpRanges=[{CidrIp=$CLIENT_IP/32,Description='Conclavia TURN relay'}]"
authorize_ingress "IpProtocol=udp,FromPort=19303,ToPort=19303,IpRanges=[{CidrIp=$CLIENT_IP/32,Description='Conclavia TURN relay'}]"
authorize_ingress "IpProtocol=udp,FromPort=49152,ToPort=65535,IpRanges=[{CidrIp=$CLIENT_IP/32,Description='Conclavia WebRTC media'}]"

echo "Attendo Systems Manager e il supervisore…"
for _ in $(seq 1 60); do
  PING=$(aws ssm describe-instance-information \
    --region "$AWS_REGION" \
    --filters "Key=InstanceIds,Values=$INSTANCE_ID" \
    --query 'InstanceInformationList[0].PingStatus' \
    --output text 2>/dev/null || true)
  [[ "$PING" == "Online" ]] && break
  sleep 3
done

if [[ "$PING" != "Online" ]]; then
  echo "Systems Manager non è diventato disponibile: interrompo l'avvio per sicurezza."
  aws ec2 stop-instances \
    --region "$AWS_REGION" \
    --instance-ids "$INSTANCE_ID" \
    --output text >/dev/null
  exit 1
fi

echo "Imposto lo spegnimento automatico a ${AUTO_STOP_MINUTES} minuti…"
AUTO_STOP_OBJECT="automation/install-3d-auto-stop.ps1"
aws s3 cp \
  scripts/install-3d-auto-stop.ps1 \
  "s3://$AUTO_STOP_BUCKET/$AUTO_STOP_OBJECT" \
  --region "$AWS_REGION" \
  --only-show-errors
AUTO_STOP_URL=$(aws s3 presign \
  "s3://$AUTO_STOP_BUCKET/$AUTO_STOP_OBJECT" \
  --region "$AWS_REGION" \
  --expires-in 900)
AUTO_STOP_PARAMETERS=$(AUTO_STOP_URL="$AUTO_STOP_URL" AUTO_STOP_MINUTES="$AUTO_STOP_MINUTES" node <<'NODE'
const url = process.env.AUTO_STOP_URL;
const minutes = Number(process.env.AUTO_STOP_MINUTES);
process.stdout.write(JSON.stringify({ commands: [
  "$ErrorActionPreference = \"Stop\"",
  "Invoke-WebRequest -Uri \"" + url + "\" -OutFile \"C:\\ConclaviaStudio\\Scripts\\Install-ConclaviaAutoStop.ps1\" -UseBasicParsing",
  "& \"C:\\ConclaviaStudio\\Scripts\\Install-ConclaviaAutoStop.ps1\" -MaxRuntimeMinutes " + minutes,
] }));
NODE
)
AUTO_STOP_COMMAND_ID=$(aws ssm send-command \
  --region "$AWS_REGION" \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunPowerShellScript \
  --parameters "$AUTO_STOP_PARAMETERS" \
  --query Command.CommandId \
  --output text)
aws ssm wait command-executed \
  --region "$AWS_REGION" \
  --command-id "$AUTO_STOP_COMMAND_ID" \
  --instance-id "$INSTANCE_ID"
AUTO_STOP_RESULT=$(aws ssm get-command-invocation \
  --region "$AWS_REGION" \
  --command-id "$AUTO_STOP_COMMAND_ID" \
  --instance-id "$INSTANCE_ID" \
  --query StandardOutputContent \
  --output text | tr -d '\r\n')
if [[ "$AUTO_STOP_RESULT" != *'"enabled":true'* ]]; then
  echo "Il watchdog di spegnimento non è stato confermato; arresto la GPU."
  aws ec2 stop-instances \
    --region "$AWS_REGION" \
    --instance-ids "$INSTANCE_ID" \
    --output text >/dev/null
  exit 1
fi

# Recreate the Windows guest-firewall rules on every boot. AWS ingress alone
# cannot make TURN reachable when Windows drops port 19303 or the allocated UDP
# relay ports; that failure presents as a negotiated but permanently black
# Pixel Streaming player.
FIREWALL_COMMAND_ID=$(aws ssm send-command \
  --region "$AWS_REGION" \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunPowerShellScript \
  --parameters 'commands=["$ErrorActionPreference=\"Stop\"","Get-NetFirewallRule -DisplayName \"Conclavia TURN 19303 TCP\" -ErrorAction SilentlyContinue | Remove-NetFirewallRule","Get-NetFirewallRule -DisplayName \"Conclavia TURN 19303 UDP\" -ErrorAction SilentlyContinue | Remove-NetFirewallRule","Get-NetFirewallRule -DisplayName \"Conclavia WebRTC relay UDP\" -ErrorAction SilentlyContinue | Remove-NetFirewallRule","New-NetFirewallRule -DisplayName \"Conclavia TURN 19303 TCP\" -Direction Inbound -Action Allow -Protocol TCP -LocalPort 19303 -Profile Any | Out-Null","New-NetFirewallRule -DisplayName \"Conclavia TURN 19303 UDP\" -Direction Inbound -Action Allow -Protocol UDP -LocalPort 19303 -Profile Any | Out-Null","New-NetFirewallRule -DisplayName \"Conclavia WebRTC relay UDP\" -Direction Inbound -Action Allow -Protocol UDP -LocalPort 49152-65535 -Profile Any | Out-Null"]' \
  --query Command.CommandId \
  --output text)
aws ssm wait command-executed \
  --region "$AWS_REGION" \
  --command-id "$FIREWALL_COMMAND_ID" \
  --instance-id "$INSTANCE_ID"

COMMAND_ID=$(aws ssm send-command \
  --region "$AWS_REGION" \
  --instance-ids "$INSTANCE_ID" \
  --document-name AWS-RunPowerShellScript \
  --parameters 'commands=["Get-Content C:\ConclaviaStudio\Saved\supervisor.token -Raw"]' \
  --query Command.CommandId \
  --output text)
aws ssm wait command-executed \
  --region "$AWS_REGION" \
  --command-id "$COMMAND_ID" \
  --instance-id "$INSTANCE_ID"
SUPERVISOR_TOKEN=$(aws ssm get-command-invocation \
  --region "$AWS_REGION" \
  --command-id "$COMMAND_ID" \
  --instance-id "$INSTANCE_ID" \
  --query StandardOutputContent \
  --output text | tr -d '\r\n')

if [[ -z "$SUPERVISOR_TOKEN" ]]; then
  echo "Il token del supervisore non è disponibile."
  exit 1
fi

UNREAL_IP="$PUBLIC_IP" UNREAL_TOKEN="$SUPERVISOR_TOKEN" node <<'NODE'
const fs = require("node:fs");
const path = ".env.local";
const ip = process.env.UNREAL_IP;
const token = process.env.UNREAL_TOKEN;
const replacements = {
  UNREAL_STUDIO_PLAYER_URL: `http://${ip}:8080/conclavia.html`,
  UNREAL_STUDIO_CONTROL_URL: `http://${ip}:8090`,
  UNREAL_STUDIO_SUPERVISOR_URL: `http://${ip}:8090`,
  UNREAL_STUDIO_TOKEN: token,
  UNREAL_STUDIO_PROFILE: "lipsync58",
};
let source = fs.existsSync(path) ? fs.readFileSync(path, "utf8") : "";
for (const [key, value] of Object.entries(replacements)) {
  const line = `${key}=${value}`;
  const pattern = new RegExp(`^${key}=.*$`, "m");
  source = pattern.test(source)
    ? source.replace(pattern, line)
    : `${source.trimEnd()}\n${line}\n`;
}
fs.writeFileSync(path, source.replace(/^\n+/, ""), { mode: 0o600 });
NODE

SUPERVISOR_READY=false
for _ in $(seq 1 40); do
  if curl --fail --silent \
    --header "Authorization: Bearer $SUPERVISOR_TOKEN" \
    "http://$PUBLIC_IP:8090/health" >/dev/null; then
    SUPERVISOR_READY=true
    break
  fi
  sleep 3
done

if [[ "$SUPERVISOR_READY" != "true" ]]; then
  echo "Il supervisore Unreal non è raggiungibile; lo studio non è pronto."
  exit 1
fi

echo "Studio 3D pronto. Avvia l'app con: npm run dev"
echo "Poi scegli 'Studio 3D · Unreal' nel talk e avvia la diretta."
echo "Spegnimento automatico attivo tra ${AUTO_STOP_MINUTES} minuti."
echo "A fine prova esegui: npm run studio:3d:stop"
