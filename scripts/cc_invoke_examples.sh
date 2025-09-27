#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/../scripts/env.sh"

mint_payload=$(
  jq -nc --arg receptor "${ORG2_MSP}" '
    {
      Args: [
        "MintFactura",
        ({
          "tokenId": "123",
          "numero": "FAC-2025-0001",
          "receptorId": $receptor,
          "moneda": "COP",
          "montoTotal": 1200000,
          "hashPDF": "sha256:abc..."
        } | @json),
        ({
          "items": [
            {
              "descripcion": "Servicio",
              "cantidad": 1,
              "precioUnit": 1200000
            }
          ]
        } | @json)
      ]
    }
  '
)

accept_payload=$(jq -nc '{Args:["AceptarFactura","123"]}')
get_payload=$(jq -nc '{Args:["GetFactura","123"]}')

docker exec \
  -e CORE_PEER_LOCALMSPID="${ORG1_MSP}" \
  -e CORE_PEER_MSPCONFIGPATH="/organizations/peerOrganizations/${ORG1_NAME}/users/Admin@${ORG1_NAME}/msp" \
  -e CORE_PEER_ADDRESS="${ORG1_PEER0_NAME}:${ORG1_PEER0_PORT}" \
  -e CORE_PEER_TLS_ROOTCERT_FILE="/organizations/peerOrganizations/${ORG1_NAME}/peers/${ORG1_PEER0_NAME}/tls/ca.crt" \
  -e CC_PAYLOAD="${mint_payload}" \
  tools bash -lc "\
peer chaincode invoke -o ${ORDERER_NAME}:${ORDERER_PORT} --ordererTLSHostnameOverride ${ORDERER_NAME} \
  --tls --cafile \$ORDERER_CA -C ${CHANNEL_NAME} -n ${CC_NAME} \
  --peerAddresses ${ORG1_PEER0_NAME}:${ORG1_PEER0_PORT} --tlsRootCertFiles /organizations/peerOrganizations/${ORG1_NAME}/peers/${ORG1_PEER0_NAME}/tls/ca.crt \
  --peerAddresses ${ORG2_PEER0_NAME}:${ORG2_PEER0_PORT} --tlsRootCertFiles /organizations/peerOrganizations/${ORG2_NAME}/peers/${ORG2_PEER0_NAME}/tls/ca.crt \
  -c \"\$CC_PAYLOAD\" --waitForEvent"

docker exec \
  -e CORE_PEER_LOCALMSPID="${ORG2_MSP}" \
  -e CORE_PEER_MSPCONFIGPATH="/organizations/peerOrganizations/${ORG2_NAME}/users/Admin@${ORG2_NAME}/msp" \
  -e CORE_PEER_ADDRESS="${ORG2_PEER0_NAME}:${ORG2_PEER0_PORT}" \
  -e CORE_PEER_TLS_ROOTCERT_FILE="/organizations/peerOrganizations/${ORG2_NAME}/peers/${ORG2_PEER0_NAME}/tls/ca.crt" \
  -e CC_PAYLOAD="${accept_payload}" \
  tools bash -lc "\
peer chaincode invoke -o ${ORDERER_NAME}:${ORDERER_PORT} --ordererTLSHostnameOverride ${ORDERER_NAME} \
  --tls --cafile \$ORDERER_CA -C ${CHANNEL_NAME} -n ${CC_NAME} \
  --peerAddresses ${ORG1_PEER0_NAME}:${ORG1_PEER0_PORT} --tlsRootCertFiles /organizations/peerOrganizations/${ORG1_NAME}/peers/${ORG1_PEER0_NAME}/tls/ca.crt \
  --peerAddresses ${ORG2_PEER0_NAME}:${ORG2_PEER0_PORT} --tlsRootCertFiles /organizations/peerOrganizations/${ORG2_NAME}/peers/${ORG2_PEER0_NAME}/tls/ca.crt \
  -c \"\$CC_PAYLOAD\" --waitForEvent"

docker exec \
  -e CC_PAYLOAD="${get_payload}" \
  tools bash -lc "\
peer chaincode query -C ${CHANNEL_NAME} -n ${CC_NAME} \
  -c \"\$CC_PAYLOAD\""
