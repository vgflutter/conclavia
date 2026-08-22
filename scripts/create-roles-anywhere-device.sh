#!/usr/bin/env bash

set -euo pipefail

DEVICE_COMMON_NAME="${CONCLAVIA_DEVICE_COMMON_NAME:-conclavia-ram020}"
CA_COMMON_NAME="Conclavia Device CA"
HELPER_PATH="${CONCLAVIA_SIGNING_HELPER_PATH:-/Users/vincenzo/.local/bin/aws_signing_helper}"
STATE_DIRECTORY="${CONCLAVIA_ROLES_ANYWHERE_STATE_DIR:-/Users/vincenzo/Library/Application Support/Conclavia/roles-anywhere}"
LOGIN_KEYCHAIN="/Users/vincenzo/Library/Keychains/login.keychain-db"
CA_PASSWORD_SERVICE="com.conclavia.roles-anywhere.ca"
CA_KEY="$STATE_DIRECTORY/device-ca.key.pem"
CA_CERT="$STATE_DIRECTORY/device-ca.cert.pem"
CA_SERIAL="$STATE_DIRECTORY/device-ca.srl"

if [[ ! -x "$HELPER_PATH" ]]; then
  echo "aws_signing_helper non trovato in $HELPER_PATH"
  exit 1
fi
if [[ -f "$CA_KEY" || -f "$CA_CERT" ]]; then
  echo "Identità Roles Anywhere già presente in $STATE_DIRECTORY"
  exit 1
fi
if security find-certificate -c "$DEVICE_COMMON_NAME" "$LOGIN_KEYCHAIN" >/dev/null 2>&1; then
  echo "Un'identità $DEVICE_COMMON_NAME è già presente nel Portachiavi."
  exit 1
fi
if security find-certificate -c "$CA_COMMON_NAME" "$LOGIN_KEYCHAIN" >/dev/null 2>&1; then
  echo "Una CA $CA_COMMON_NAME è già presente nel Portachiavi."
  exit 1
fi

umask 077
mkdir -p "$STATE_DIRECTORY"
chmod 700 "$STATE_DIRECTORY"

temporary_directory=$(mktemp -d)
completed=false
cleanup() {
  rm -rf "$temporary_directory"
  if [[ "$completed" != "true" ]]; then
    rm -f "$CA_KEY" "$CA_CERT" "$CA_SERIAL"
    security delete-generic-password \
      -a "$USER" \
      -s "$CA_PASSWORD_SERVICE" >/dev/null 2>&1 || true
    security delete-identity \
      -c "$DEVICE_COMMON_NAME" \
      "$LOGIN_KEYCHAIN" >/dev/null 2>&1 || true
    security delete-certificate \
      -c "$CA_COMMON_NAME" \
      "$LOGIN_KEYCHAIN" >/dev/null 2>&1 || true
  fi
}
trap cleanup EXIT

ca_password=$(openssl rand -base64 48 | tr -d '\r\n')
p12_password=$(openssl rand -base64 48 | tr -d '\r\n')
security add-generic-password \
  -a "$USER" \
  -s "$CA_PASSWORD_SERVICE" \
  -w "$ca_password" \
  -U >/dev/null

openssl genpkey \
  -algorithm RSA \
  -pkeyopt rsa_keygen_bits:3072 \
  -aes-256-cbc \
  -pass "pass:$ca_password" \
  -out "$CA_KEY" >/dev/null 2>&1
openssl req \
  -x509 \
  -new \
  -sha384 \
  -days 3650 \
  -key "$CA_KEY" \
  -passin "pass:$ca_password" \
  -subj "/O=Conclavia/OU=Device Identity/CN=$CA_COMMON_NAME" \
  -addext "basicConstraints=critical,CA:TRUE,pathlen:0" \
  -addext "keyUsage=critical,keyCertSign,cRLSign" \
  -addext "subjectKeyIdentifier=hash" \
  -out "$CA_CERT"

openssl genpkey \
  -algorithm RSA \
  -pkeyopt rsa_keygen_bits:3072 \
  -out "$temporary_directory/device.key.pem" >/dev/null 2>&1
openssl req \
  -new \
  -sha384 \
  -key "$temporary_directory/device.key.pem" \
  -subj "/O=Conclavia/OU=Studio Controller/CN=$DEVICE_COMMON_NAME" \
  -out "$temporary_directory/device.csr.pem"

printf '%s\n' \
  "basicConstraints=critical,CA:FALSE" \
  "keyUsage=critical,digitalSignature" \
  "extendedKeyUsage=clientAuth" \
  "subjectKeyIdentifier=hash" \
  "authorityKeyIdentifier=keyid,issuer" \
  >"$temporary_directory/device.extensions"
openssl x509 \
  -req \
  -sha384 \
  -days 397 \
  -in "$temporary_directory/device.csr.pem" \
  -CA "$CA_CERT" \
  -CAkey "$CA_KEY" \
  -passin "pass:$ca_password" \
  -CAserial "$CA_SERIAL" \
  -CAcreateserial \
  -extfile "$temporary_directory/device.extensions" \
  -out "$temporary_directory/device.cert.pem" >/dev/null 2>&1

openssl pkcs12 \
  -export \
  -legacy \
  -inkey "$temporary_directory/device.key.pem" \
  -in "$temporary_directory/device.cert.pem" \
  -certfile "$CA_CERT" \
  -name "$DEVICE_COMMON_NAME" \
  -passout "pass:$p12_password" \
  -out "$temporary_directory/device.identity.p12"
security import "$temporary_directory/device.identity.p12" \
  -k "$LOGIN_KEYCHAIN" \
  -P "$p12_password" \
  -T "$HELPER_PATH" >/dev/null
security add-trusted-cert \
  -r trustRoot \
  -p basic \
  -k "$LOGIN_KEYCHAIN" \
  "$CA_CERT"

chmod 600 "$CA_KEY" "$CA_CERT" "$CA_SERIAL"
openssl verify -CAfile "$CA_CERT" "$temporary_directory/device.cert.pem" >/dev/null
certificate_data=$("$HELPER_PATH" read-certificate-data \
  --cert-selector "Key=x509Subject,Value=CN=$DEVICE_COMMON_NAME,OU=Studio Controller,O=Conclavia")
if [[ "$certificate_data" != *"Matching identities"* ]]; then
  echo "Il Portachiavi non espone l'identità al credential helper AWS."
  exit 1
fi

completed=true
echo "Identità dispositivo creata nel Portachiavi macOS."
echo "CA pubblica: $CA_CERT"
echo "CA privata cifrata: $CA_KEY"
