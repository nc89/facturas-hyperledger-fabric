#!/usr/bin/env bash

set -euo pipefail

# Asegurarse que estamos en el directorio correcto
ROOT_DIR="$(cd "$(dirname "$0")/.."; pwd)"
cd "${ROOT_DIR}"

# Cargar variables de entorno
if [[ -f "${ROOT_DIR}/.env" ]]; then
  # shellcheck disable=SC2046
  export $(grep -Ev '^\s*#' "${ROOT_DIR}/.env" | xargs -d '\n') || true
fi

# Verificar variables requeridas
: "${CC_NAME:?Variable not set or empty}"
: "${CC_VERSION:?Variable not set or empty}"
: "${CC_SRC_PATH:?Variable not set or empty}"
: "${ORG1_MSP:?Variable not set or empty}"
: "${ORG1_NAME:?Variable not set or empty}"
: "${ORG1_PEER0_NAME:?Variable not set or empty}"
: "${ORG1_PEER0_PORT:?Variable not set or empty}"

# Compila TS -> JS
pushd "${CC_SRC_PATH}"
npm install
npm run build
popd

PKG_LABEL=${CC_NAME}_${CC_VERSION}

# Verificar que el MSP existe antes de continuar
if [[ ! -d "${CRYPTO_DIR}/peerOrganizations/${ORG1_NAME}/users/Admin@${ORG1_NAME}/msp" ]]; then
  echo "❌ No encuentro el MSP en ${CRYPTO_DIR}/peerOrganizations/${ORG1_NAME}/users/Admin@${ORG1_NAME}/msp"
  exit 1
fi

echo "ℹ️  Empaquetando chaincode ${CC_NAME} v${CC_VERSION}..."
docker exec tools bash -lc "\
  peer lifecycle chaincode package /artifacts/${CC_NAME}.tar.gz \
  --path ${CC_SRC_PATH} \
  --lang node \
  --label ${PKG_LABEL}"

echo "ℹ️  Instalando en Org1..."
docker exec tools bash -lc "\
  CORE_PEER_LOCALMSPID=${ORG1_MSP} \
  CORE_PEER_MSPCONFIGPATH=/organizations/peerOrganizations/${ORG1_NAME}/users/Admin@${ORG1_NAME}/msp \
  CORE_PEER_ADDRESS=${ORG1_PEER0_NAME}:${ORG1_PEER0_PORT} \
  CORE_PEER_TLS_ROOTCERT_FILE=/organizations/peerOrganizations/${ORG1_NAME}/peers/${ORG1_PEER0_NAME}/tls/ca.crt \
  peer lifecycle chaincode install /artifacts/${CC_NAME}.tar.gz"

# Install on Org2
docker exec tools bash -lc "\
CORE_PEER_LOCALMSPID=${ORG2_MSP} \
CORE_PEER_MSPCONFIGPATH=/organizations/peerOrganizations/${ORG2_NAME}/users/Admin@${ORG2_NAME}/msp \
CORE_PEER_ADDRESS=${ORG2_PEER0_NAME}:${ORG2_PEER0_PORT} \
CORE_PEER_TLS_ROOTCERT_FILE=/organizations/peerOrganizations/${ORG2_NAME}/peers/${ORG2_PEER0_NAME}/tls/ca.crt \
peer lifecycle chaincode install /artifacts/${CC_NAME}.tar.gz"

# Query installed to get PACKAGE_ID
PACKAGE_ID=$(docker exec tools bash -lc "\
CORE_PEER_LOCALMSPID=${ORG1_MSP} \
CORE_PEER_MSPCONFIGPATH=/organizations/peerOrganizations/${ORG1_NAME}/users/Admin@${ORG1_NAME}/msp \
CORE_PEER_ADDRESS=${ORG1_PEER0_NAME}:${ORG1_PEER0_PORT} \
CORE_PEER_TLS_ROOTCERT_FILE=/organizations/peerOrganizations/${ORG1_NAME}/peers/${ORG1_PEER0_NAME}/tls/ca.crt \
peer lifecycle chaincode queryinstalled --output json | jq -r '.installed_chaincodes[] | select(.label==\"${PKG_LABEL}\").package_id'")

echo "PACKAGE_ID=${PACKAGE_ID}"

# Approve for Org1
docker exec tools bash -lc "\
CORE_PEER_LOCALMSPID=${ORG1_MSP} \
CORE_PEER_MSPCONFIGPATH=/organizations/peerOrganizations/${ORG1_NAME}/users/Admin@${ORG1_NAME}/msp \
CORE_PEER_ADDRESS=${ORG1_PEER0_NAME}:${ORG1_PEER0_PORT} \
CORE_PEER_TLS_ROOTCERT_FILE=/organizations/peerOrganizations/${ORG1_NAME}/peers/${ORG1_PEER0_NAME}/tls/ca.crt \
peer lifecycle chaincode approveformyorg -o ${ORDERER_NAME}:${ORDERER_PORT} --ordererTLSHostnameOverride ${ORDERER_NAME} \
  --channelID ${CHANNEL_NAME} --name ${CC_NAME} --version ${CC_VERSION} --sequence ${CC_SEQUENCE} \
  --signature-policy \"${CC_END_POLICY}\" --collections-config ${CC_COLL_CONFIG} \
  --package-id ${PACKAGE_ID} --tls --cafile \$ORDERER_CA"

# Approve for Org2
docker exec tools bash -lc "\
CORE_PEER_LOCALMSPID=${ORG2_MSP} \
CORE_PEER_MSPCONFIGPATH=/organizations/peerOrganizations/${ORG2_NAME}/users/Admin@${ORG2_NAME}/msp \
CORE_PEER_ADDRESS=${ORG2_PEER0_NAME}:${ORG2_PEER0_PORT} \
CORE_PEER_TLS_ROOTCERT_FILE=/organizations/peerOrganizations/${ORG2_NAME}/peers/${ORG2_PEER0_NAME}/tls/ca.crt \
peer lifecycle chaincode approveformyorg -o ${ORDERER_NAME}:${ORDERER_PORT} --ordererTLSHostnameOverride ${ORDERER_NAME} \
  --channelID ${CHANNEL_NAME} --name ${CC_NAME} --version ${CC_VERSION} --sequence ${CC_SEQUENCE} \
  --signature-policy \"${CC_END_POLICY}\" --collections-config ${CC_COLL_CONFIG} \
  --package-id ${PACKAGE_ID} --tls --cafile \$ORDERER_CA"

# Commit
docker exec tools bash -lc "\
peer lifecycle chaincode commit -o ${ORDERER_NAME}:${ORDERER_PORT} --ordererTLSHostnameOverride ${ORDERER_NAME} \
  --channelID ${CHANNEL_NAME} --name ${CC_NAME} --version ${CC_VERSION} --sequence ${CC_SEQUENCE} \
  --signature-policy \"${CC_END_POLICY}\" --collections-config ${CC_COLL_CONFIG} --tls --cafile \$ORDERER_CA \
  --peerAddresses ${ORG1_PEER0_NAME}:${ORG1_PEER0_PORT} \
  --tlsRootCertFiles /organizations/peerOrganizations/${ORG1_NAME}/peers/${ORG1_PEER0_NAME}/tls/ca.crt \
  --peerAddresses ${ORG2_PEER0_NAME}:${ORG2_PEER0_PORT} \
  --tlsRootCertFiles /organizations/peerOrganizations/${ORG2_NAME}/peers/${ORG2_PEER0_NAME}/tls/ca.crt"

echo "✅ Chaincode ${CC_NAME} v${CC_VERSION} comprometido en ${CHANNEL_NAME}"
