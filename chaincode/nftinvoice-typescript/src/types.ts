export type EstadoFactura = 'EMITIDA' | 'ACEPTADA' | 'RECHAZADA' | 'PAGADA' | 'ANULADA';

export interface ActorInfo {
  mspId: string;
  enrollmentId?: string;
  subject?: string;
  idHash: string;
}

export type FacturaAccion = EstadoFactura;

export interface FacturaAuditEntry {
  accion: FacturaAccion;
  actor: ActorInfo;
  timestamp: number;
  txId: string;
  metadata?: Record<string, unknown>;
}

export interface FacturaPublic {
  tokenId: string;
  numero: string;
  emisorId: string;
  receptorId: string;
  moneda: string;
  montoTotal: number;
  estado: EstadoFactura;
  hashPDF?: string;
  privateDataHash?: string;
  version: number;
  lastUpdatedBy: string;
  lastAction: FacturaAccion;
  createdBy: ActorInfo;
  lastActor: ActorInfo;
  historial: FacturaAuditEntry[];
  createdAt: number;
  updatedAt: number;
}

export interface FacturaPrivada {
  items?: Array<{ descripcion: string; cantidad: number; precioUnit: number; iva?: number }>;
  observaciones?: string;
  adjuntos?: Array<{ nombre: string; uri: string; hash?: string }>;
  metadata?: Record<string, unknown>;
}

export interface MintFacturaInput {
  tokenId: string;
  numero: string;
  receptorId: string;
  moneda?: string;
  montoTotal?: number;
  hashPDF?: string;
}

export interface ConsultaLog {
  tokenId: string;
  hashedId: string;
  actorMspId: string;
  consultedAt: number;
}
