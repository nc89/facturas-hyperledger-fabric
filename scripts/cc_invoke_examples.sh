#!/usr/bin/env bash
set -euo pipefail
source "$(dirname "$0")/../scripts/env.sh"

# Mint (Org1)
docker exec tools bash -lc "\
CORE_PEER_LOCALMSPID=${ORG1_MSP} \
CORE_PEER_MSPCONFIGPATH=/organizations/peerOrganizations/${ORG1_NAME}/users/Admin@${ORG1_NAME}/msp \
CORE_PEER_ADDRESS=${ORG1_PEER0_NAME}:${ORG1_PEER0_PORT} \
CORE_PEER_TLS_ROOTCERT_FILE=/organizations/peerOrganizations/${ORG1_NAME}/peers/${ORG1_PEER0_NAME}/tls/ca.crt \
peer chaincode invoke -o ${ORDERER_NAME}:${ORDERER_PORT} --ordererTLSHostnameOverride ${ORDERER_NAME} \
  --tls --cafile \$ORDERER_CA -C ${CHANNEL_NAME} -n ${CC_NAME} \
  --peerAddresses ${ORG1_PEER0_NAME}:${ORG1_PEER0_PORT} --tlsRootCertFiles /organizations/peerOrganizations/${ORG1_NAME}/peers/${ORG1_PEER0_NAME}/tls/ca.crt \
  --peerAddresses ${ORG2_PEER0_NAME}:${ORG2_PEER0_PORT} --tlsRootCertFiles /organizations/peerOrganizations/${ORG2_NAME}/peers/${ORG2_PEER0_NAME}/tls/ca.crt \
  -c '{\"Args\":[\"MintFactura\",\"{\\\"tokenId\\\":\\\"123\\\",\\\"numero\\\":\\\"FAC-2025-0001\\\",\\\"receptorId\\\":\\\"${ORG2_MSP}\\\",\\\"moneda\\\":\\\"COP\\\",\\\"montoTotal\\\":1200000,\\\"hashPDF\\\":\\\"sha256:abc...\\\"}\",\"{\\\"items\\\":[{\\\"descripcion\\\":\\\"Servicio\\\",\\\"cantidad\\\":1,\\\"precioUnit\\\":1200000}]}"]}' \
  --waitForEvent"

# Aceptar (Org2)
docker exec tools bash -lc "\
CORE_PEER_LOCALMSPID=${ORG2_MSP} \
CORE_PEER_MSPCONFIGPATH=/organizations/peerOrganizations/${ORG2_NAME}/users/Admin@${ORG2_NAME}/msp \
CORE_PEER_ADDRESS=${ORG2_PEER0_NAME}:${ORG2_PEER0_PORT} \
CORE_PEER_TLS_ROOTCERT_FILE=/organizations/peerOrganizations/${ORG2_NAME}/peers/${ORG2_PEER0_NAME}/tls/ca.crt \
peer chaincode invoke -o ${ORDERER_NAME}:${ORDERER_PORT} --ordererTLSHostnameOverride ${ORDERER_NAME} \
  --tls --cafile \$ORDERER_CA -C ${CHANNEL_NAME} -n ${CC_NAME} \
  --peerAddresses ${ORG1_PEER0_NAME}:${ORG1_PEER0_PORT} --tlsRootCertFiles /organizations/peerOrganizations/${ORG1_NAME}/peers/${ORG1_PEER0_NAME}/tls/ca.crt \
  --peerAddresses ${ORG2_PEER0_NAME}:${ORG2_PEER0_PORT} --tlsRootCertFiles /organizations/peerOrganizations/${ORG2_NAME}/peers/${ORG2_PEER0_NAME}/tls/ca.crt \
  -c '{\"Args\":[\"AceptarFactura\",\"123\"]}' --waitForEvent"

# Get
docker exec tools bash -lc "\
peer chaincode query -C ${CHANNEL_NAME} -n ${CC_NAME} \
  -c '{\"Args\":[\"GetFactura\",\"123\"]}'"
