import { Context, Contract } from 'fabric-contract-api';
import { FacturaPrivada, FacturaPublic } from './types';

const COLLECTION = 'FacturaPrivada';

function now(): number { return Math.floor(Date.now() / 1000); }
function isOrg(mspId: string, org: 'Org1MSP' | 'Org2MSP') { return mspId === org; }

export class NftInvoiceContract extends Contract {
  private getMSP(ctx: Context): string { return ctx.clientIdentity.getMSPID(); }

  private async exists(ctx: Context, key: string): Promise<boolean> {
    const data = await ctx.stub.getState(key);
    return !!(data && data.length > 0);
  }
  private async getPublic(ctx: Context, key: string): Promise<FacturaPublic> {
    const buf = await ctx.stub.getState(key);
    if (!buf || buf.length === 0) throw new Error(`Factura ${key} no existe`);
    return JSON.parse(buf.toString());
  }
  private async putPublic(ctx: Context, key: string, value: FacturaPublic) {
    await ctx.stub.putState(key, Buffer.from(JSON.stringify(value)));
  }

  // Emisor crea factura
  async MintFactura(ctx: Context, dtoJson: string, privateJson?: string) {
    const msp = this.getMSP(ctx);
    if (!isOrg(msp, 'Org1MSP')) throw new Error('Solo Org1MSP (Emisor) puede emitir');

    const dto = JSON.parse(dtoJson) as {
      tokenId: string; numero: string; receptorId?: string; moneda?: string; montoTotal?: number; hashPDF?: string;
    };

    const key = `invoice:${dto.tokenId}`;
    if (await this.exists(ctx, key)) throw new Error('tokenId ya existe');

    const pub: FacturaPublic = {
      tokenId: dto.tokenId,
      numero: dto.numero,
      emisorId: 'Org1MSP',
      receptorId: dto.receptorId || 'Org2MSP',
      moneda: dto.moneda || 'COP',
      montoTotal: Number(dto.montoTotal || 0),
      estado: 'EMITIDA',
      hashPDF: dto.hashPDF,
      createdAt: now(),
      updatedAt: now(),
    };

    await this.putPublic(ctx, key, pub);

    if (privateJson) {
      const priv = JSON.parse(privateJson) as FacturaPrivada;
      await ctx.stub.putPrivateData(COLLECTION, key, Buffer.from(JSON.stringify(priv)));
    }
    await ctx.stub.setEvent('FacturaEmitida', Buffer.from(JSON.stringify({ tokenId: pub.tokenId, numero: pub.numero })));
    return pub.tokenId;
  }

  async AceptarFactura(ctx: Context, tokenId: string) {
    const msp = this.getMSP(ctx);
    if (!isOrg(msp, 'Org2MSP')) throw new Error('Solo Org2MSP (Receptor) puede aceptar');
    const key = `invoice:${tokenId}`;
    const cur = await this.getPublic(ctx, key);
    if (cur.estado !== 'EMITIDA') throw new Error('Solo EMITIDA puede pasar a ACEPTADA');
    cur.estado = 'ACEPTADA';
    cur.updatedAt = now();
    await this.putPublic(ctx, key, cur);
    await ctx.stub.setEvent('FacturaAceptada', Buffer.from(JSON.stringify({ tokenId })));
  }

  async RechazarFactura(ctx: Context, tokenId: string, motivo?: string) {
    const msp = this.getMSP(ctx);
    if (!isOrg(msp, 'Org2MSP')) throw new Error('Solo Org2MSP (Receptor) puede rechazar');
    const key = `invoice:${tokenId}`;
    const cur = await this.getPublic(ctx, key);
    if (cur.estado !== 'EMITIDA') throw new Error('Solo EMITIDA puede pasar a RECHAZADA');
    cur.estado = 'RECHAZADA';
    cur.updatedAt = now();
    await this.putPublic(ctx, key, cur);
    await ctx.stub.setEvent('FacturaRechazada', Buffer.from(JSON.stringify({ tokenId, motivo })));
  }

  async PagarFactura(ctx: Context, tokenId: string, refPago?: string) {
    const msp = this.getMSP(ctx);
    if (!isOrg(msp, 'Org1MSP')) throw new Error('Solo Org1MSP (Emisor) puede marcar pago');
    const key = `invoice:${tokenId}`;
    const cur = await this.getPublic(ctx, key);
    if (cur.estado !== 'ACEPTADA') throw new Error('Solo ACEPTADA puede pasar a PAGADA');
    cur.estado = 'PAGADA';
    cur.updatedAt = now();
    await this.putPublic(ctx, key, cur);
    await ctx.stub.setEvent('FacturaPagada', Buffer.from(JSON.stringify({ tokenId, refPago })));
  }

  async AnularFactura(ctx: Context, tokenId: string, motivo?: string) {
    const msp = this.getMSP(ctx);
    if (!isOrg(msp, 'Org1MSP')) throw new Error('Solo Org1MSP (Emisor) puede anular');
    const key = `invoice:${tokenId}`;
    const cur = await this.getPublic(ctx, key);
    if (cur.estado === 'PAGADA') throw new Error('No se puede anular una factura PAGADA');
    cur.estado = 'ANULADA';
    cur.updatedAt = now();
    await this.putPublic(ctx, key, cur);
    await ctx.stub.setEvent('FacturaAnulada', Buffer.from(JSON.stringify({ tokenId, motivo })));
  }

  async GetFactura(ctx: Context, tokenId: string) {
    const key = `invoice:${tokenId}`;
    const pub = await this.getPublic(ctx, key);
    let priv: FacturaPrivada | undefined = undefined;
    try {
      const b = await ctx.stub.getPrivateData(COLLECTION, key);
      if (b && b.length > 0) priv = JSON.parse(b.toString());
    } catch {}
    return { public: pub, private: priv };
  }

  async Historial(ctx: Context, tokenId: string) {
    const key = `invoice:${tokenId}`;
    const iterator = await ctx.stub.getHistoryForKey(key);
    const out: any[] = [];
    while (true) {
      const r = await iterator.next();
      if (r.value) {
        out.push({
          txId: r.value.txId,
          timestamp: r.value.timestamp && (r.value.timestamp.seconds?.toString() || ''),
          isDelete: r.value.isDelete,
          value: r.value.value && r.value.value.toString(),
        });
      }
      if (r.done) break;
    }
    await iterator.close();
    return out;
  }

  async Exists(ctx: Context, tokenId: string) { return this.exists(ctx, `invoice:${tokenId}`); }
  async TokenURI(ctx: Context, tokenId: string) {
    const pub = await this.getPublic(ctx, `invoice:${tokenId}`);
    return JSON.stringify({ tokenId: pub.tokenId, numero: pub.numero, estado: pub.estado, hashPDF: pub.hashPDF });
  }
}

export const contracts: any[] = [ new NftInvoiceContract() ];
