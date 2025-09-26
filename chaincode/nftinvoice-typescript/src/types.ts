export type EstadoFactura = 'DRAFT' | 'EMITIDA' | 'ACEPTADA' | 'RECHAZADA' | 'PAGADA' | 'ANULADA';

export interface FacturaPublic {
  tokenId: string;
  numero: string;
  emisorId: string;
  receptorId: string;
  moneda: string;
  montoTotal: number;
  estado: EstadoFactura;
  hashPDF?: string;
  createdAt: number;
  updatedAt: number;
}

export interface FacturaPrivada {
  items?: Array<{ descripcion: string; cantidad: number; precioUnit: number; iva?: number }>;
  observaciones?: string;
  adjuntos?: Array<{ nombre: string; uri: string; hash?: string }>;
}
