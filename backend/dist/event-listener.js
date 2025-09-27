"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.startConsultaListener = startConsultaListener;
exports.getConsultaEventRecords = getConsultaEventRecords;
exports.clearConsultaEventRecords = clearConsultaEventRecords;
exports.stopConsultaListener = stopConsultaListener;
const auth_1 = require("./auth");
const fabric_1 = require("./fabric");
const CHANNEL_NAME = process.env.CHANNEL_NAME || 'facturas-channel';
const CHAINCODE_NAME = process.env.CC_NAME || 'nftinvoice';
const EVENT_NAME = 'FacturaConsultada';
const consultaEvents = [];
let listenerHandle;
let listenerBindingToken;
let listenerInitialized = false;
function chooseBinding() {
    const bindings = (0, auth_1.getBindings)();
    if (bindings.size === 0) {
        console.warn('[event-listener] No hay API keys configuradas; se omite listener de eventos.');
        return undefined;
    }
    const preferredToken = process.env.FABRIC_EVENT_API_KEY;
    if (preferredToken) {
        const binding = bindings.get(preferredToken);
        if (!binding) {
            console.warn(`[event-listener] FABRIC_EVENT_API_KEY=${preferredToken} no coincide con ninguna entrada en FABRIC_API_KEYS.`);
        }
        if (binding) {
            return binding;
        }
    }
    // fallback: primer binding disponible
    const [first] = bindings.values();
    return first;
}
function parsePayload(event) {
    const payload = event.payload?.toString('utf8');
    if (!payload) {
        return undefined;
    }
    try {
        return JSON.parse(payload);
    }
    catch (err) {
        console.warn('[event-listener] No se pudo parsear payload de evento:', err);
        return undefined;
    }
}
async function startConsultaListener() {
    if (listenerInitialized) {
        return;
    }
    listenerInitialized = true;
    const binding = chooseBinding();
    if (!binding) {
        return;
    }
    const consultaListener = async (event) => {
        if (event.eventName !== EVENT_NAME) {
            return;
        }
        const payload = parsePayload(event);
        const txEvent = event.getTransactionEvent();
        const blockEvent = txEvent.getBlockEvent();
        let blockNumber = 0;
        try {
            // fabric-network utiliza Long; convertimos a number de forma segura
            blockNumber = Number(blockEvent.blockNumber?.toString?.() ?? 0);
        }
        catch {
            blockNumber = 0;
        }
        const consultedAt = payload?.consultedAt ?? Math.floor((txEvent.timestamp?.getTime?.() ?? Date.now()) / 1000);
        const record = {
            tokenId: payload?.tokenId ?? 'unknown',
            hashedId: payload?.hashedId ?? 'unknown',
            actorMspId: payload?.actorMspId ?? binding.mspId,
            consultedAt,
            blockNumber,
            transactionId: txEvent.transactionId,
            receivedAt: Date.now(),
            raw: payload,
        };
        consultaEvents.push(record);
    };
    try {
        listenerHandle = await fabric_1.fabricService.addContractListener(binding, CHANNEL_NAME, CHAINCODE_NAME, consultaListener);
        listenerBindingToken = binding.apiKey;
        console.log('[event-listener] Listener de FacturaConsultada inicializado.');
    }
    catch (err) {
        console.error('[event-listener] Error al registrar listener:', err);
    }
}
function getConsultaEventRecords() {
    return [...consultaEvents];
}
function clearConsultaEventRecords() {
    consultaEvents.length = 0;
}
async function stopConsultaListener() {
    if (!listenerHandle || !listenerBindingToken) {
        listenerHandle = undefined;
        listenerBindingToken = undefined;
        listenerInitialized = false;
        return;
    }
    const bindings = (0, auth_1.getBindings)();
    const binding = bindings.get(listenerBindingToken);
    if (!binding) {
        listenerHandle = undefined;
        listenerBindingToken = undefined;
        listenerInitialized = false;
        return;
    }
    try {
        await fabric_1.fabricService.removeContractListener(binding, CHANNEL_NAME, CHAINCODE_NAME, listenerHandle);
    }
    catch (err) {
        console.error('[event-listener] Error al remover listener:', err);
    }
    finally {
        listenerHandle = undefined;
        listenerBindingToken = undefined;
        listenerInitialized = false;
    }
}
