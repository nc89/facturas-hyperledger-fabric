#!/usr/bin/env bash

set -euo pipefail
source "$(dirname "$0")/../scripts/env.sh"

mkdir -p "${ART_DIR}"

docker run --rm -v ${PWD}:/workspace -w /workspace hyperledger/fabric-tools:${FABRIC_VERSION} bash -c "\
configtxgen -configPath ./config -profile FacturasOrdererGenesis -channelID system-channel -outputBlock ${ART_DIR}/genesis.block && \
configtxgen -configPath ./config -profile FacturasApplicationChannel -channelID ${CHANNEL_NAME} -outputCreateChannelTx ${ART_DIR}/${CHANNEL_NAME}.tx && \
configtxgen -configPath ./config -profile FacturasApplicationChannel -channelID ${CHANNEL_NAME} -outputAnchorPeersUpdate ${ART_DIR}/Org1MSPanchors.tx -asOrg Org1MSP && \
configtxgen -configPath ./config -profile FacturasApplicationChannel -channelID ${CHANNEL_NAME} -outputAnchorPeersUpdate ${ART_DIR}/Org2MSPanchors.tx -asOrg Org2MSP"

echo "✅ Artefactos de canal en ${ART_DIR}"
