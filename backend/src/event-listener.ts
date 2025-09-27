import { ContractListener, ContractEvent } from 'fabric-network';
import { getBindings } from './auth';
import { bindingsStore } from './bindings-store';
import { fabricService } from './fabric';

const CHANNEL_NAME = process.env.CHANNEL_NAME || 'facturas-channel';
const CHAINCODE_NAME = process.env.CC_NAME || 'nftinvoice';
const EVENT_NAME = 'FacturaConsultada';

interface ConsultaEventPayload {
  tokenId?: string;
  hashedId?: string;
  actorMspId?: string;
  consultedAt?: number;
  [key: string]: unknown;
}

export interface ConsultaEventRecord {
  tokenId: string;
  hashedId: string;
  actorMspId: string;
  consultedAt: number;
  blockNumber: number;
  transactionId: string;
  receivedAt: number;
  raw?: ConsultaEventPayload;
}

const consultaEvents: ConsultaEventRecord[] = [];
let listenerHandle: ContractListener | undefined;
let listenerBindingToken: string | undefined;
let listenerInitialized = false;

function chooseBinding() {
  const bindings = getBindings();
  if (bindings.length === 0) {
    console.warn('[event-listener] No hay API keys configuradas; se omite listener de eventos.');
    return undefined;
  }
  const preferredToken = process.env.FABRIC_EVENT_API_KEY;
  if (preferredToken) {
    const binding = bindings.find((b) => b.apiKey === preferredToken);
    if (!binding) {
      console.warn(`[event-listener] FABRIC_EVENT_API_KEY=${preferredToken} no coincide con ninguna entrada de bindings.`);
    }
    if (binding) {
      return binding;
    }
  }
  return bindings[0];
}

function parsePayload(event: ContractEvent): ConsultaEventPayload | undefined {
  const payload = event.payload?.toString('utf8');
  if (!payload) {
    return undefined;
  }
  try {
    return JSON.parse(payload) as ConsultaEventPayload;
  } catch (err) {
    console.warn('[event-listener] No se pudo parsear payload de evento:', err);
    return undefined;
  }
}

export async function startConsultaListener(): Promise<void> {
  if (listenerInitialized) {
    return;
  }

  const binding = chooseBinding();
  if (!binding) {
    listenerInitialized = false;
    return;
  }
  listenerInitialized = true;

  const consultaListener: ContractListener = async (event: ContractEvent) => {
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
    } catch {
      blockNumber = 0;
    }
    const consultedAt = payload?.consultedAt ?? Math.floor((txEvent.timestamp?.getTime?.() ?? Date.now()) / 1000);
    const record: ConsultaEventRecord = {
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
    listenerHandle = await fabricService.addContractListener(
      binding,
      CHANNEL_NAME,
      CHAINCODE_NAME,
      consultaListener,
    );
    listenerBindingToken = binding.apiKey;
    console.log('[event-listener] Listener de FacturaConsultada inicializado.');
  } catch (err) {
    console.error('[event-listener] Error al registrar listener:', err);
  }
}

export function getConsultaEventRecords(): ConsultaEventRecord[] {
  return [...consultaEvents];
}

export function clearConsultaEventRecords(): void {
  consultaEvents.length = 0;
}

export async function stopConsultaListener(): Promise<void> {
  if (!listenerHandle || !listenerBindingToken) {
    listenerHandle = undefined;
    listenerBindingToken = undefined;
    listenerInitialized = false;
    return;
  }
  const binding = bindingsStore.get(listenerBindingToken);
  try {
    if (binding) {
      await fabricService.removeContractListener(binding, CHANNEL_NAME, CHAINCODE_NAME, listenerHandle);
    }
  } catch (err) {
    console.error('[event-listener] Error al remover listener:', err);
  } finally {
    listenerHandle = undefined;
    listenerBindingToken = undefined;
    listenerInitialized = false;
  }
}
