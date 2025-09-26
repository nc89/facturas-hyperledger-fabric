# 1. Generar certificados autofirmados (MSP/TLS)
./scripts/gen-crypto.sh

# 2. Generar génesis y transacción de canal
./scripts/gen-artifacts.sh

# 3. Levantar la red
./scripts/network.sh up

# 4. Crear canal y unir peers
./scripts/network.sh createChannel

# 5. Desplegar chaincode (compila TS, lifecycle completo)
./scripts/cc_deploy.sh

# PROBAR TRANSACCIONES
./scripts/cc_invoke_examples.sh

# Apagar todo y limpiar
./scripts/network.sh down

