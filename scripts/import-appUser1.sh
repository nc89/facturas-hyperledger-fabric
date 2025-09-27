#!/usr/bin/env bash
set -euo pipefail

source "$(dirname "$0")/env.sh"

IDENTITY_NAME=${1:-appUser1}
WALLET_DIR=${2:-backend/../wallet}

CERT_PATH="${CRYPTO_DIR}/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp/signcerts/Admin@org1.example.com-cert.pem"
KEY_DIR="${CRYPTO_DIR}/peerOrganizations/org1.example.com/users/Admin@org1.example.com/msp/keystore"
KEY_FILE=$(ls "$KEY_DIR" 2>/dev/null | head -n 1)

if [[ -z "${KEY_FILE}" ]]; then
  echo "No se encontró clave privada en $KEY_DIR"
  exit 1
fi

mkdir -p "${WALLET_DIR}"

node - <<'NODE'
const fs = require('fs');
const path = require('path');
const { Wallets } = require('fabric-network');

const walletPath = process.argv[2];
const identityName = process.argv[3];
const certFile = process.argv[4];
const keyFile = process.argv[5];

(async () => {
  const wallet = await Wallets.newFileSystemWallet(walletPath);
  const certificate = fs.readFileSync(certFile).toString();
  const privateKey = fs.readFileSync(keyFile).toString();
  await wallet.put(identityName, {
    credentials: { certificate, privateKey },
    mspId: 'Org1MSP',
    type: 'X.509'
  });
  console.log(`Importada identidad ${identityName} en ${walletPath}`);
})();
NODE
