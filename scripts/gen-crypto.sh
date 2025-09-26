#!/usr/bin/env bash

set -euo pipefail
source "$(dirname "$0")/../scripts/env.sh"

mkdir -p "${ORG_DIR}"
docker run --rm -v ${PWD}:/workspace -w /workspace hyperledger/fabric-tools:${FABRIC_VERSION} bash -c \
"cryptogen generate --config=./config/crypto-config.yaml --output=./config/organizations"

echo "✅ Certificados (MSP/TLS) generados en ${ORG_DIR}"
