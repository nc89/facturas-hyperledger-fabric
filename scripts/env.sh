#!/usr/bin/env bash
set -euo pipefail

export PATH=${PWD}/bin:$PATH   # si luego traes binarios locales
export FABRIC_CFG_PATH=${PWD}/config

# Atajos para rutas
export ORG_DIR=./config/organizations
export ART_DIR=./channel-artifacts
source .env
