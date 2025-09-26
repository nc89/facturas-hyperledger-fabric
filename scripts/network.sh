#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "$0")/.."; pwd)"
COMPOSE_FILE="$ROOT_DIR/docker-compose.yaml"

if [[ ! -f "$COMPOSE_FILE" ]]; then
  echo "❌ No encuentro $COMPOSE_FILE"; exit 1
fi

# Cargar .env si existe
if [[ -f "$ROOT_DIR/.env" ]]; then
  # shellcheck disable=SC2046
  export $(grep -Ev '^\s*#' "$ROOT_DIR/.env" | xargs -d '\n') || true
fi

DC=(docker compose -f "$COMPOSE_FILE")

# Nombres REALES de servicios según tu docker-compose.yaml
SVC_ORDERER="orderer.example.com"
SVC_COUCH1="couchdb.peer0.org1.example.com"
SVC_PEER1="peer0.org1.example.com"
SVC_COUCH2="couchdb.peer0.org2.example.com"
SVC_PEER2="peer0.org2.example.com"
SVC_TOOLS="tools"

require_services() {
  local missing=()
  mapfile -t services < <("${DC[@]}" config --services)
  for s in "$@"; do
    if ! printf '%s\n' "${services[@]}" | grep -qx "$s"; then
      missing+=("$s")
    fi
  done
  if (( ${#missing[@]} )); then
    echo "❌ Faltan servicios: ${missing[*]}"
    echo "   Servicios disponibles:"; printf '   - %s\n' "${services[@]}"
    exit 1
  fi
}

cmd=${1:-help}

case "$cmd" in
  up)
    require_services "$SVC_ORDERER" "$SVC_COUCH1" "$SVC_PEER1" "$SVC_COUCH2" "$SVC_PEER2" "$SVC_TOOLS"
    echo "ℹ️  Levantando red…"
    "${DC[@]}" up -d --remove-orphans "$SVC_ORDERER" "$SVC_COUCH1" "$SVC_PEER1" "$SVC_COUCH2" "$SVC_PEER2" "$SVC_TOOLS"
    "${DC[@]}" ps
    ;;

  down)
    echo "ℹ️  Bajando red…"
    "${DC[@]}" down -v
    ;;

  ps)
    "${DC[@]}" ps
    ;;

  logs)
    "${DC[@]}" logs -f
    ;;

    createChannel)
    require_services "$SVC_TOOLS"

    # Defaults por si no están en .env
    : "${ORDERER_NAME:=orderer.example.com}"
    : "${ORDERER_PORT:=7050}"
    : "${CHANNEL_NAME:=facturas-channel}"
    : "${ORG1_NAME:=org1.example.com}"
    : "${ORG1_MSP:=Org1MSP}"
    : "${ORG1_PEER0_NAME:=peer0.org1.example.com}"
    : "${ORG1_PEER0_PORT:=7051}"
    : "${ORG2_NAME:=org2.example.com}"
    : "${ORG2_MSP:=Org2MSP}"
    : "${ORG2_PEER0_NAME:=peer0.org2.example.com}"
    : "${ORG2_PEER0_PORT:=9051}"

    # CA del orderer (TLS)
    ORDERER_CA="/organizations/ordererOrganizations/example.com/orderers/${ORDERER_NAME}/msp/tlscacerts/tlsca.example.com-cert.pem"

    echo "ℹ️  Verificando si el canal ${CHANNEL_NAME} ya existe (fetch bloque 0)…"
    if docker exec "$SVC_TOOLS" bash -lc "
      peer channel fetch 0 /artifacts/${CHANNEL_NAME}.block \
        -o ${ORDERER_NAME}:${ORDERER_PORT} \
        --ordererTLSHostnameOverride ${ORDERER_NAME} \
        -c ${CHANNEL_NAME} --tls --cafile ${ORDERER_CA} >/dev/null 2>&1
    "; then
      echo "ℹ️  Canal ${CHANNEL_NAME} ya existe en el orderer. Usando /artifacts/${CHANNEL_NAME}.block"
    else
      echo "ℹ️  Creando canal ${CHANNEL_NAME}…"
      docker exec "$SVC_TOOLS" bash -lc "
        peer channel create \
          -o ${ORDERER_NAME}:${ORDERER_PORT} \
          --ordererTLSHostnameOverride ${ORDERER_NAME} \
          -c ${CHANNEL_NAME} \
          -f /artifacts/${CHANNEL_NAME}.tx \
          --outputBlock /artifacts/${CHANNEL_NAME}.block \
          --tls --cafile ${ORDERER_CA}
      "

      # (Paranoia) Trae nuevamente el bloque 0 del orderer para asegurar sincronía
      docker exec "$SVC_TOOLS" bash -lc "
        peer channel fetch 0 /artifacts/${CHANNEL_NAME}.block \
          -o ${ORDERER_NAME}:${ORDERER_PORT} \
          --ordererTLSHostnameOverride ${ORDERER_NAME} \
          -c ${CHANNEL_NAME} --tls --cafile ${ORDERER_CA}
      "
    fi

    echo "ℹ️  Join peer Org1…"
    docker exec "$SVC_TOOLS" bash -lc "
      CORE_PEER_LOCALMSPID=${ORG1_MSP} \
      CORE_PEER_MSPCONFIGPATH=/organizations/peerOrganizations/${ORG1_NAME}/users/Admin@${ORG1_NAME}/msp \
      CORE_PEER_ADDRESS=${ORG1_PEER0_NAME}:${ORG1_PEER0_PORT} \
      CORE_PEER_TLS_ROOTCERT_FILE=/organizations/peerOrganizations/${ORG1_NAME}/peers/${ORG1_PEER0_NAME}/tls/ca.crt \
      peer channel join -b /artifacts/${CHANNEL_NAME}.block
    " || echo '⚠️  Org1 quizá ya está unido (join idempotente).'

    echo "ℹ️  Join peer Org2…"
    docker exec "$SVC_TOOLS" bash -lc "
      CORE_PEER_LOCALMSPID=${ORG2_MSP} \
      CORE_PEER_MSPCONFIGPATH=/organizations/peerOrganizations/${ORG2_NAME}/users/Admin@${ORG2_NAME}/msp \
      CORE_PEER_ADDRESS=${ORG2_PEER0_NAME}:${ORG2_PEER0_PORT} \
      CORE_PEER_TLS_ROOTCERT_FILE=/organizations/peerOrganizations/${ORG2_NAME}/peers/${ORG2_PEER0_NAME}/tls/ca.crt \
      peer channel join -b /artifacts/${CHANNEL_NAME}.block
    " || echo '⚠️  Org2 quizá ya está unido (join idempotente).'

    echo "ℹ️  Actualizando anchor peer Org1…"
    docker exec "$SVC_TOOLS" bash -lc "
      CORE_PEER_LOCALMSPID=${ORG1_MSP} \
      CORE_PEER_MSPCONFIGPATH=/organizations/peerOrganizations/${ORG1_NAME}/users/Admin@${ORG1_NAME}/msp \
      CORE_PEER_ADDRESS=${ORG1_PEER0_NAME}:${ORG1_PEER0_PORT} \
      CORE_PEER_TLS_ROOTCERT_FILE=/organizations/peerOrganizations/${ORG1_NAME}/peers/${ORG1_PEER0_NAME}/tls/ca.crt \
      peer channel update \
        -o ${ORDERER_NAME}:${ORDERER_PORT} \
        --ordererTLSHostnameOverride ${ORDERER_NAME} \
        -c ${CHANNEL_NAME} \
        -f /artifacts/Org1MSPanchors.tx \
        --tls --cafile ${ORDERER_CA}
    " || echo '⚠️  Anchor Org1 ya aplicado o no necesario.'

    echo "ℹ️  Actualizando anchor peer Org2…"
    docker exec "$SVC_TOOLS" bash -lc "
      CORE_PEER_LOCALMSPID=${ORG2_MSP} \
      CORE_PEER_MSPCONFIGPATH=/organizations/peerOrganizations/${ORG2_NAME}/users/Admin@${ORG2_NAME}/msp \
      CORE_PEER_ADDRESS=${ORG2_PEER0_NAME}:${ORG2_PEER0_PORT} \
      CORE_PEER_TLS_ROOTCERT_FILE=/organizations/peerOrganizations/${ORG2_NAME}/peers/${ORG2_PEER0_NAME}/tls/ca.crt \
      peer channel update \
        -o ${ORDERER_NAME}:${ORDERER_PORT} \
        --ordererTLSHostnameOverride ${ORDERER_NAME} \
        -c ${CHANNEL_NAME} \
        -f /artifacts/Org2MSPanchors.tx \
        --tls --cafile ${ORDERER_CA}
    " || echo '⚠️  Anchor Org2 ya aplicado o no necesario.'

    echo "✅ Canal ${CHANNEL_NAME} listo (create/fetch + join + anchors)."
    ;;


  *)
    echo "Uso: $0 {up|down|ps|logs|createChannel}"
    exit 1
    ;;
esac
