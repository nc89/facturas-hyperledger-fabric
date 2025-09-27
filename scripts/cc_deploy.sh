#!/usr/bin/env bash

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.."; pwd)"
cd "${ROOT_DIR}"

if [[ -f "${ROOT_DIR}/.env" ]]; then
  # shellcheck disable=SC2046
  export $(grep -Ev '^\s*#' "${ROOT_DIR}/.env" | xargs -d '\n') || true
fi

: "${CC_NAME:?Variable not set or empty}"
: "${CC_VERSION:?Variable not set or empty}"
: "${CC_SRC_PATH:?Variable not set or empty}"
: "${CC_SEQUENCE:?Variable not set or empty}"
: "${ORG1_MSP:?Variable not set or empty}"
: "${ORG1_NAME:?Variable not set or empty}"
: "${ORG1_PEER0_NAME:?Variable not set or empty}"
: "${ORG1_PEER0_PORT:?Variable not set or empty}"
: "${ORG2_MSP:?Variable not set or empty}"
: "${ORG2_NAME:?Variable not set or empty}"
: "${ORG2_PEER0_NAME:?Variable not set or empty}"
: "${ORG2_PEER0_PORT:?Variable not set or empty}"
: "${CHANNEL_NAME:?Variable not set or empty}"
: "${ORDERER_NAME:?Variable not set or empty}"
: "${ORDERER_PORT:?Variable not set or empty}"
: "${CC_COLL_CONFIG:?Variable not set or empty}"

docker run --rm \
  -v "${PWD}/${CC_SRC_PATH}":/workspace \
  -w /workspace \
  node:18 bash -lc "npm install && npm run build"

PKG_LABEL=${CC_NAME}_${CC_VERSION}

# Normaliza la política de endoso en caso de que venga con comillas
CC_POLICY=${CC_END_POLICY:-AND('Org1MSP.peer','Org2MSP.peer')}
CC_POLICY=$(printf '%s' "${CC_POLICY}" | sed -e 's/^"//' -e 's/"$//')

ORDERER_DOMAIN=${ORDERER_NAME#*.}
ORDERER_CA_PATH=${ORDERER_CA:-/organizations/ordererOrganizations/${ORDERER_DOMAIN}/orderers/${ORDERER_NAME}/msp/tlscacerts/tlsca.${ORDERER_DOMAIN}-cert.pem}

if [[ ! -d "${CRYPTO_DIR}/peerOrganizations/${ORG1_NAME}/users/Admin@${ORG1_NAME}/msp" ]]; then
  echo "ERROR: No encuentro el MSP en ${CRYPTO_DIR}/peerOrganizations/${ORG1_NAME}/users/Admin@${ORG1_NAME}/msp"
  exit 1
fi

docker_exec_peer() {
  local org_msp=$1
  local org_name=$2
  local peer_name=$3
  local peer_port=$4
  shift 4

  docker exec \
    -e CORE_PEER_LOCALMSPID="${org_msp}" \
    -e CORE_PEER_MSPCONFIGPATH="/organizations/peerOrganizations/${org_name}/users/Admin@${org_name}/msp" \
    -e CORE_PEER_ADDRESS="${peer_name}:${peer_port}" \
    -e CORE_PEER_TLS_ROOTCERT_FILE="/organizations/peerOrganizations/${org_name}/peers/${peer_name}/tls/ca.crt" \
    -e FABRIC_LOGGING_SPEC=ERROR \
    tools "$@"
}

query_installed_package() {
  local org_msp=$1
  local org_name=$2
  local peer_name=$3
  local peer_port=$4

  docker_exec_peer "${org_msp}" "${org_name}" "${peer_name}" "${peer_port}" \
    peer lifecycle chaincode queryinstalled --output json 2>/dev/null | \
    jq -r --arg label "${PKG_LABEL}" '.installed_chaincodes[]? | select(.label==$label).package_id'
}

install_chaincode_if_needed() {
  local org_msp=$1
  local org_name=$2
  local peer_name=$3
  local peer_port=$4

  local package_id
  package_id=$(query_installed_package "${org_msp}" "${org_name}" "${peer_name}" "${peer_port}")

  if [[ -n "${package_id}" ]]; then
    echo "INFO: ${PKG_LABEL} ya instalado en ${peer_name} (${package_id})."
    return
  fi

  echo "INFO: Instalando ${PKG_LABEL} en ${peer_name}..."
  docker_exec_peer "${org_msp}" "${org_name}" "${peer_name}" "${peer_port}" \
    peer lifecycle chaincode install /artifacts/${CC_NAME}.tar.gz
}

query_committed_sequence() {
  docker_exec_peer "${ORG1_MSP}" "${ORG1_NAME}" "${ORG1_PEER0_NAME}" "${ORG1_PEER0_PORT}" \
    peer lifecycle chaincode querycommitted -C "${CHANNEL_NAME}" --output json 2>/dev/null | \
    jq -r --arg name "${CC_NAME}" '.chaincode_definitions[]? | select(.name==$name).sequence'
}

echo "INFO: Empaquetando chaincode ${CC_NAME} v${CC_VERSION}..."
docker exec -e FABRIC_LOGGING_SPEC=ERROR tools \
  peer lifecycle chaincode package /artifacts/${CC_NAME}.tar.gz \
  --path ${CC_SRC_PATH} \
  --lang node \
  --label ${PKG_LABEL}

install_chaincode_if_needed "${ORG1_MSP}" "${ORG1_NAME}" "${ORG1_PEER0_NAME}" "${ORG1_PEER0_PORT}"
install_chaincode_if_needed "${ORG2_MSP}" "${ORG2_NAME}" "${ORG2_PEER0_NAME}" "${ORG2_PEER0_PORT}"

PACKAGE_ID=$(query_installed_package "${ORG1_MSP}" "${ORG1_NAME}" "${ORG1_PEER0_NAME}" "${ORG1_PEER0_PORT}")
if [[ -z "${PACKAGE_ID}" ]]; then
  echo "ERROR: No pude obtener el PACKAGE_ID para ${PKG_LABEL} en ${ORG1_PEER0_NAME}."
  exit 1
fi

echo "INFO: PACKAGE_ID=${PACKAGE_ID}"

docker_exec_peer "${ORG1_MSP}" "${ORG1_NAME}" "${ORG1_PEER0_NAME}" "${ORG1_PEER0_PORT}" \
  peer lifecycle chaincode approveformyorg \
  -o ${ORDERER_NAME}:${ORDERER_PORT} \
  --ordererTLSHostnameOverride ${ORDERER_NAME} \
  --channelID ${CHANNEL_NAME} \
  --name ${CC_NAME} \
  --version ${CC_VERSION} \
  --sequence ${CC_SEQUENCE} \
  --signature-policy ${CC_POLICY} \
  --collections-config ${CC_COLL_CONFIG} \
  --package-id ${PACKAGE_ID} \
  --tls \
  --cafile ${ORDERER_CA_PATH}

docker_exec_peer "${ORG2_MSP}" "${ORG2_NAME}" "${ORG2_PEER0_NAME}" "${ORG2_PEER0_PORT}" \
  peer lifecycle chaincode approveformyorg \
  -o ${ORDERER_NAME}:${ORDERER_PORT} \
  --ordererTLSHostnameOverride ${ORDERER_NAME} \
  --channelID ${CHANNEL_NAME} \
  --name ${CC_NAME} \
  --version ${CC_VERSION} \
  --sequence ${CC_SEQUENCE} \
  --signature-policy ${CC_POLICY} \
  --collections-config ${CC_COLL_CONFIG} \
  --package-id ${PACKAGE_ID} \
  --tls \
  --cafile ${ORDERER_CA_PATH}

CURRENT_SEQUENCE=$(query_committed_sequence)

if [[ "${CURRENT_SEQUENCE}" == "${CC_SEQUENCE}" ]]; then
  echo "INFO: Chaincode ${CC_NAME} (sequence ${CC_SEQUENCE}) ya está comprometido en ${CHANNEL_NAME}."
else
  echo "INFO: Committing ${CC_NAME} sequence ${CC_SEQUENCE} en ${CHANNEL_NAME}..."
  docker_exec_peer "${ORG1_MSP}" "${ORG1_NAME}" "${ORG1_PEER0_NAME}" "${ORG1_PEER0_PORT}" \
    peer lifecycle chaincode commit \
    -o ${ORDERER_NAME}:${ORDERER_PORT} \
    --ordererTLSHostnameOverride ${ORDERER_NAME} \
    --channelID ${CHANNEL_NAME} \
    --name ${CC_NAME} \
    --version ${CC_VERSION} \
    --sequence ${CC_SEQUENCE} \
    --signature-policy ${CC_POLICY} \
    --collections-config ${CC_COLL_CONFIG} \
    --tls \
    --cafile ${ORDERER_CA_PATH} \
    --peerAddresses ${ORG1_PEER0_NAME}:${ORG1_PEER0_PORT} \
    --tlsRootCertFiles /organizations/peerOrganizations/${ORG1_NAME}/peers/${ORG1_PEER0_NAME}/tls/ca.crt \
    --peerAddresses ${ORG2_PEER0_NAME}:${ORG2_PEER0_PORT} \
    --tlsRootCertFiles /organizations/peerOrganizations/${ORG2_NAME}/peers/${ORG2_PEER0_NAME}/tls/ca.crt

  echo "INFO: Chaincode ${CC_NAME} v${CC_VERSION} comprometido en ${CHANNEL_NAME}"
fi
