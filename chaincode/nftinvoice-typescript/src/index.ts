import { Context, Contract } from 'fabric-contract-api';
import * as crypto from 'crypto';
import { ActorInfo, ConsultaLog, FacturaAccion, FacturaAuditEntry, FacturaPrivada, FacturaPublic, MintFacturaInput } from './types';

const PRIVATE_COLLECTION = 'FacturaPrivada';
const LOG_OBJECT_TYPE = 'factura-log';

function now(): number {
  return Math.floor(Date.now() / 1000);
}

function hashBuffer(buf: Buffer): string {
  return crypto.createHash('sha256').update(buf).digest('hex');
}

function hashString(value: string): string {
  return hashBuffer(Buffer.from(value, 'utf8'));
}

function parseJson<T>(raw: string, label: string): T {
  try {
    return JSON.parse(raw) as T;
  } catch (err) {
    throw new Error(`${label}: JSON inválido`);
  }
}

export class NftInvoiceContract extends Contract {
  private getInvoiceKey(tokenId: string): string {
    return `invoice:${tokenId}`;
  }

  private getMSP(ctx: Context): string {
    return ctx.clientIdentity.getMSPID();
  }

  private getActorInfo(ctx: Context): ActorInfo {
    const mspId = this.getMSP(ctx);
    let enrollmentId: string | undefined;
    try {
      enrollmentId = ctx.clientIdentity.getAttributeValue('hf.EnrollmentID') || undefined;
    } catch {
      enrollmentId = undefined;
    }

    const identity = ctx.clientIdentity.getID();
    let subject: string | undefined;
    const parts = identity.split('::');
    if (parts.length >= 2) {
      subject = parts[1];
    }
    const idHash = hashString(identity);

    return {
      mspId,
      enrollmentId,
      subject,
      idHash,
    };
  }

  private async exists(ctx: Context, key: string): Promise<boolean> {
    const data = await ctx.stub.getState(key);
    return !!(data && data.length > 0);
  }

  private async readFactura(ctx: Context, tokenId: string): Promise<FacturaPublic> {
    const key = this.getInvoiceKey(tokenId);
    const buf = await ctx.stub.getState(key);
    if (!buf || buf.length === 0) {
      throw new Error(`Factura ${tokenId} no existe`);
    }
    return this.normalizeFactura(JSON.parse(buf.toString()));
  }

  private async writeFactura(ctx: Context, factura: FacturaPublic): Promise<void> {
    const key = this.getInvoiceKey(factura.tokenId);
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(factura)));
  }

  private normalizeFactura(raw: any): FacturaPublic {
    const factura = raw as FacturaPublic & {
      historial?: FacturaAuditEntry[];
      createdBy?: ActorInfo;
      lastActor?: ActorInfo;
      lastAction?: string;
    };
    if (!Array.isArray(factura.historial)) {
      factura.historial = [];
    }

    if (!factura.createdBy) {
      factura.createdBy = {
        mspId: factura.emisorId,
        idHash: hashString(`${factura.emisorId}:${factura.tokenId}:created`),
      };
    }

    if (!factura.lastActor) {
      const lastEntry = factura.historial[factura.historial.length - 1];
      factura.lastActor = lastEntry?.actor || factura.createdBy;
    }

    if (!factura.lastAction) {
      factura.lastAction = factura.estado;
    }

    if (!factura.lastUpdatedBy) {
      factura.lastUpdatedBy = factura.lastActor.mspId;
    }

    factura.historial = factura.historial.map((entry) => ({
      ...entry,
      actor: {
        idHash: entry.actor.idHash,
        mspId: entry.actor.mspId,
        enrollmentId: entry.actor.enrollmentId,
        subject: entry.actor.subject,
      },
    }));

    return factura as FacturaPublic;
  }

  private ensureString(value: unknown, field: string): string {
    if (typeof value !== 'string' || value.trim().length === 0) {
      throw new Error(`${field} es requerido`);
    }
    return value.trim();
  }

  private sanitizeMintPayload(raw: string): MintFacturaInput {
    const dto = parseJson<MintFacturaInput>(raw, 'MintFactura');
    const monto = Number(dto.montoTotal ?? 0);
    if (!Number.isFinite(monto) || monto < 0) {
      throw new Error('montoTotal inválido');
    }
    return {
      tokenId: this.ensureString(dto.tokenId, 'tokenId'),
      numero: this.ensureString(dto.numero, 'numero'),
      receptorId: this.ensureString(dto.receptorId, 'receptorId'),
      moneda: dto.moneda ? this.ensureString(dto.moneda, 'moneda') : 'COP',
      montoTotal: monto,
      hashPDF: dto.hashPDF ? this.ensureString(dto.hashPDF, 'hashPDF') : undefined,
    };
  }

  private ensureAccess(ctx: Context, factura: FacturaPublic, role: 'EMISOR' | 'RECEPTOR' | 'AMBOS'): void {
    const msp = this.getMSP(ctx);
    const isEmisor = msp === factura.emisorId;
    const isReceptor = msp === factura.receptorId;
    if (role === 'EMISOR' && !isEmisor) {
      throw new Error('MSP no autorizada (se requiere emisor)');
    }
    if (role === 'RECEPTOR' && !isReceptor) {
      throw new Error('MSP no autorizada (se requiere receptor)');
    }
    if (role === 'AMBOS' && !(isEmisor || isReceptor)) {
      throw new Error('MSP no autorizada para consultar la factura');
    }
  }

  private async readPrivate(ctx: Context, tokenId: string): Promise<FacturaPrivada | undefined> {
    try {
      const buf = await ctx.stub.getPrivateData(PRIVATE_COLLECTION, this.getInvoiceKey(tokenId));
      if (buf && buf.length > 0) {
        return JSON.parse(buf.toString()) as FacturaPrivada;
      }
      return undefined;
    } catch {
      return undefined;
    }
  }

  private getTransientBuffer(ctx: Context, key: string): Buffer | undefined {
    const map = ctx.stub.getTransient();
    if (!map || map.size === 0) {
      return undefined;
    }
    const value = map.get(key);
    if (!value || value.length === 0) {
      return undefined;
    }
    return Buffer.from(value);
  }

  private async storePrivate(ctx: Context, tokenId: string, payload?: Buffer): Promise<string | undefined> {
    if (!payload) {
      return undefined;
    }
    await ctx.stub.putPrivateData(PRIVATE_COLLECTION, this.getInvoiceKey(tokenId), payload);
    return hashBuffer(payload);
  }

  private async appendConsultaLog(ctx: Context, log: ConsultaLog): Promise<void> {
    const compositeKey = ctx.stub.createCompositeKey(LOG_OBJECT_TYPE, [log.tokenId, log.consultedAt.toString(), log.hashedId]);
    await ctx.stub.putPrivateData(PRIVATE_COLLECTION, compositeKey, Buffer.from(JSON.stringify(log)));
  }

  private createAuditEntry(ctx: Context, accion: FacturaAccion, metadata?: Record<string, unknown>): FacturaAuditEntry {
    const actor = this.getActorInfo(ctx);
    const entry: FacturaAuditEntry = {
      accion,
      actor,
      timestamp: now(),
      txId: ctx.stub.getTxID(),
    };
    if (metadata && Object.keys(metadata).length > 0) {
      entry.metadata = metadata;
    }
    return entry;
  }

  private applyAction(
    ctx: Context,
    factura: FacturaPublic,
    estado: FacturaAccion,
    metadata?: Record<string, unknown>,
  ): FacturaPublic {
    const entry = this.createAuditEntry(ctx, estado, metadata);
    const historial = Array.isArray(factura.historial) ? [...factura.historial, entry] : [entry];
    return {
      ...factura,
      estado,
      version: factura.version + 1,
      lastUpdatedBy: entry.actor.mspId,
      lastAction: estado,
      lastActor: entry.actor,
      updatedAt: entry.timestamp,
      historial,
    };
  }

  private async getConsultaLogs(ctx: Context, tokenId: string): Promise<ConsultaLog[]> {
    const iterator = ctx.stub.getPrivateDataByPartialCompositeKey(PRIVATE_COLLECTION, LOG_OBJECT_TYPE, [tokenId]);
    const logs: ConsultaLog[] = [];
    for await (const item of iterator as AsyncIterable<any>) {
      if (item.value) {
        const buffer = item.value.value || item.value;
        logs.push(JSON.parse(buffer.toString()) as ConsultaLog);
      }
    }
    logs.sort((a, b) => a.consultedAt - b.consultedAt);
    return logs;
  }

  async MintFactura(ctx: Context, dtoJson: string, privateJson?: string): Promise<string> {
    const actorInfo = this.getActorInfo(ctx);
    if (actorInfo.mspId !== 'Org1MSP') {
      throw new Error('Solo Org1MSP puede emitir facturas en esta versión');
    }

    const dto = this.sanitizeMintPayload(dtoJson);
    const key = this.getInvoiceKey(dto.tokenId);

    if (await this.exists(ctx, key)) {
      throw new Error('tokenId ya existe');
    }

    let transientPayload = this.getTransientBuffer(ctx, 'private');
    if (!transientPayload && privateJson) {
      transientPayload = Buffer.from(privateJson, 'utf8');
    }
    let privateDataHash: string | undefined;
    if (transientPayload) {
      // Validate private payload is valid JSON before storing
      parseJson<FacturaPrivada>(transientPayload.toString(), 'private');
      privateDataHash = await this.storePrivate(ctx, dto.tokenId, transientPayload);
    }

    const entry = this.createAuditEntry(ctx, 'EMITIDA', { numero: dto.numero });
    const factura: FacturaPublic = {
      tokenId: dto.tokenId,
      numero: dto.numero,
      emisorId: actorInfo.mspId,
      receptorId: dto.receptorId,
      moneda: dto.moneda || 'COP',
      montoTotal: dto.montoTotal ?? 0,
      estado: 'EMITIDA',
      hashPDF: dto.hashPDF,
      privateDataHash,
      version: 1,
      lastUpdatedBy: entry.actor.mspId,
      lastAction: 'EMITIDA',
      createdBy: entry.actor,
      lastActor: entry.actor,
      historial: [entry],
      createdAt: entry.timestamp,
      updatedAt: entry.timestamp,
    };

    await this.writeFactura(ctx, factura);
    await ctx.stub.setEvent('FacturaEmitida', Buffer.from(JSON.stringify({
      tokenId: factura.tokenId,
      numero: factura.numero,
      actor: entry.actor,
      timestamp: entry.timestamp,
      txId: entry.txId,
    })));
    return factura.tokenId;
  }

  async AceptarFactura(ctx: Context, tokenId: string): Promise<void> {
    const factura = await this.readFactura(ctx, tokenId);
    this.ensureAccess(ctx, factura, 'RECEPTOR');
    if (factura.estado !== 'EMITIDA') {
      throw new Error('Solo EMITIDA puede pasar a ACEPTADA');
    }
    const updated = this.applyAction(ctx, factura, 'ACEPTADA');
    await this.writeFactura(ctx, updated);
    const lastEntry = updated.historial[updated.historial.length - 1];
    await ctx.stub.setEvent('FacturaAceptada', Buffer.from(JSON.stringify({
      tokenId,
      actor: lastEntry.actor,
      timestamp: lastEntry.timestamp,
      txId: lastEntry.txId,
    })));
  }

  async RechazarFactura(ctx: Context, tokenId: string, motivo?: string): Promise<void> {
    const factura = await this.readFactura(ctx, tokenId);
    this.ensureAccess(ctx, factura, 'RECEPTOR');
    if (factura.estado !== 'EMITIDA') {
      throw new Error('Solo EMITIDA puede pasar a RECHAZADA');
    }
    const updated = this.applyAction(ctx, factura, 'RECHAZADA', motivo ? { motivo } : undefined);
    await this.writeFactura(ctx, updated);
    const lastEntry = updated.historial[updated.historial.length - 1];
    await ctx.stub.setEvent('FacturaRechazada', Buffer.from(JSON.stringify({
      tokenId,
      motivo,
      actor: lastEntry.actor,
      timestamp: lastEntry.timestamp,
      txId: lastEntry.txId,
    })));
  }

  async PagarFactura(ctx: Context, tokenId: string, refPago?: string): Promise<void> {
    const factura = await this.readFactura(ctx, tokenId);
    this.ensureAccess(ctx, factura, 'EMISOR');
    if (factura.estado !== 'ACEPTADA') {
      throw new Error('Solo ACEPTADA puede pasar a PAGADA');
    }
    const updated = this.applyAction(ctx, factura, 'PAGADA', refPago ? { refPago } : undefined);
    await this.writeFactura(ctx, updated);
    const lastEntry = updated.historial[updated.historial.length - 1];
    await ctx.stub.setEvent('FacturaPagada', Buffer.from(JSON.stringify({
      tokenId,
      refPago,
      actor: lastEntry.actor,
      timestamp: lastEntry.timestamp,
      txId: lastEntry.txId,
    })));
  }

  async AnularFactura(ctx: Context, tokenId: string, motivo?: string): Promise<void> {
    const factura = await this.readFactura(ctx, tokenId);
    this.ensureAccess(ctx, factura, 'EMISOR');
    if (factura.estado === 'PAGADA') {
      throw new Error('No se puede anular una factura PAGADA');
    }
    const updated = this.applyAction(ctx, factura, 'ANULADA', motivo ? { motivo } : undefined);
    await this.writeFactura(ctx, updated);
    const lastEntry = updated.historial[updated.historial.length - 1];
    await ctx.stub.setEvent('FacturaAnulada', Buffer.from(JSON.stringify({
      tokenId,
      motivo,
      actor: lastEntry.actor,
      timestamp: lastEntry.timestamp,
      txId: lastEntry.txId,
    })));
  }

  async GetFactura(ctx: Context, tokenId: string): Promise<{ public: FacturaPublic; private?: FacturaPrivada }> {
    const factura = await this.readFactura(ctx, tokenId);
    this.ensureAccess(ctx, factura, 'AMBOS');
    const privateData = await this.readPrivate(ctx, tokenId);
    return { public: factura, private: privateData };
  }

  async GetFacturaPrivada(ctx: Context, tokenId: string): Promise<FacturaPrivada | undefined> {
    const factura = await this.readFactura(ctx, tokenId);
    this.ensureAccess(ctx, factura, 'AMBOS');
    return this.readPrivate(ctx, tokenId);
  }

  async Historial(ctx: Context, tokenId: string): Promise<unknown[]> {
    const factura = await this.readFactura(ctx, tokenId);
    this.ensureAccess(ctx, factura, 'AMBOS');
    return factura.historial || [];
  }

  async RegistrarConsulta(ctx: Context, tokenId: string, hashedId: string): Promise<void> {
    const factura = await this.readFactura(ctx, tokenId);
    this.ensureAccess(ctx, factura, 'AMBOS');
    const value = this.ensureString(hashedId, 'hashedId');
    const entry: ConsultaLog = {
      tokenId,
      hashedId: value,
      actorMspId: this.getMSP(ctx),
      consultedAt: now(),
    };
    await this.appendConsultaLog(ctx, entry);
    await ctx.stub.setEvent('FacturaConsultada', Buffer.from(JSON.stringify(entry)));
  }

  async Consultas(ctx: Context, tokenId: string): Promise<ConsultaLog[]> {
    const factura = await this.readFactura(ctx, tokenId);
    this.ensureAccess(ctx, factura, 'AMBOS');
    return this.getConsultaLogs(ctx, tokenId);
  }

  async Exists(ctx: Context, tokenId: string): Promise<boolean> {
    return this.exists(ctx, this.getInvoiceKey(tokenId));
  }

  async TokenURI(ctx: Context, tokenId: string): Promise<string> {
    const factura = await this.readFactura(ctx, tokenId);
    return JSON.stringify({
      tokenId: factura.tokenId,
      numero: factura.numero,
      estado: factura.estado,
      hashPDF: factura.hashPDF,
      version: factura.version,
    });
  }
}

export const contracts = [NftInvoiceContract];
