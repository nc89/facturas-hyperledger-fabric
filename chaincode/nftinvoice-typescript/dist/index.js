"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.contracts = exports.NftInvoiceContract = void 0;
const fabric_contract_api_1 = require("fabric-contract-api");
const COLLECTION = 'FacturaPrivada';
function now() { return Math.floor(Date.now() / 1000); }
function isOrg(mspId, org) { return mspId === org; }
class NftInvoiceContract extends fabric_contract_api_1.Contract {
    getMSP(ctx) { return ctx.clientIdentity.getMSPID(); }
    async exists(ctx, key) {
        const data = await ctx.stub.getState(key);
        return !!(data && data.length > 0);
    }
    async getPublic(ctx, key) {
        const buf = await ctx.stub.getState(key);
        if (!buf || buf.length === 0)
            throw new Error(`Factura ${key} no existe`);
        return JSON.parse(buf.toString());
    }
    async putPublic(ctx, key, value) {
        await ctx.stub.putState(key, Buffer.from(JSON.stringify(value)));
    }
    // Emisor crea factura
    async MintFactura(ctx, dtoJson, privateJson) {
        const msp = this.getMSP(ctx);
        if (!isOrg(msp, 'Org1MSP'))
            throw new Error('Solo Org1MSP (Emisor) puede emitir');
        const dto = JSON.parse(dtoJson);
        const key = `invoice:${dto.tokenId}`;
        if (await this.exists(ctx, key))
            throw new Error('tokenId ya existe');
        const pub = {
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
            const priv = JSON.parse(privateJson);
            await ctx.stub.putPrivateData(COLLECTION, key, Buffer.from(JSON.stringify(priv)));
        }
        await ctx.stub.setEvent('FacturaEmitida', Buffer.from(JSON.stringify({ tokenId: pub.tokenId, numero: pub.numero })));
        return pub.tokenId;
    }
    async AceptarFactura(ctx, tokenId) {
        const msp = this.getMSP(ctx);
        if (!isOrg(msp, 'Org2MSP'))
            throw new Error('Solo Org2MSP (Receptor) puede aceptar');
        const key = `invoice:${tokenId}`;
        const cur = await this.getPublic(ctx, key);
        if (cur.estado !== 'EMITIDA')
            throw new Error('Solo EMITIDA puede pasar a ACEPTADA');
        cur.estado = 'ACEPTADA';
        cur.updatedAt = now();
        await this.putPublic(ctx, key, cur);
        await ctx.stub.setEvent('FacturaAceptada', Buffer.from(JSON.stringify({ tokenId })));
    }
    async RechazarFactura(ctx, tokenId, motivo) {
        const msp = this.getMSP(ctx);
        if (!isOrg(msp, 'Org2MSP'))
            throw new Error('Solo Org2MSP (Receptor) puede rechazar');
        const key = `invoice:${tokenId}`;
        const cur = await this.getPublic(ctx, key);
        if (cur.estado !== 'EMITIDA')
            throw new Error('Solo EMITIDA puede pasar a RECHAZADA');
        cur.estado = 'RECHAZADA';
        cur.updatedAt = now();
        await this.putPublic(ctx, key, cur);
        await ctx.stub.setEvent('FacturaRechazada', Buffer.from(JSON.stringify({ tokenId, motivo })));
    }
    async PagarFactura(ctx, tokenId, refPago) {
        const msp = this.getMSP(ctx);
        if (!isOrg(msp, 'Org1MSP'))
            throw new Error('Solo Org1MSP (Emisor) puede marcar pago');
        const key = `invoice:${tokenId}`;
        const cur = await this.getPublic(ctx, key);
        if (cur.estado !== 'ACEPTADA')
            throw new Error('Solo ACEPTADA puede pasar a PAGADA');
        cur.estado = 'PAGADA';
        cur.updatedAt = now();
        await this.putPublic(ctx, key, cur);
        await ctx.stub.setEvent('FacturaPagada', Buffer.from(JSON.stringify({ tokenId, refPago })));
    }
    async AnularFactura(ctx, tokenId, motivo) {
        const msp = this.getMSP(ctx);
        if (!isOrg(msp, 'Org1MSP'))
            throw new Error('Solo Org1MSP (Emisor) puede anular');
        const key = `invoice:${tokenId}`;
        const cur = await this.getPublic(ctx, key);
        if (cur.estado === 'PAGADA')
            throw new Error('No se puede anular una factura PAGADA');
        cur.estado = 'ANULADA';
        cur.updatedAt = now();
        await this.putPublic(ctx, key, cur);
        await ctx.stub.setEvent('FacturaAnulada', Buffer.from(JSON.stringify({ tokenId, motivo })));
    }
    async GetFactura(ctx, tokenId) {
        const key = `invoice:${tokenId}`;
        const pub = await this.getPublic(ctx, key);
        let priv = undefined;
        try {
            const b = await ctx.stub.getPrivateData(COLLECTION, key);
            if (b && b.length > 0)
                priv = JSON.parse(b.toString());
        }
        catch { }
        return { public: pub, private: priv };
    }
    async Historial(ctx, tokenId) {
        const key = `invoice:${tokenId}`;
        const iterator = await ctx.stub.getHistoryForKey(key);
        const out = [];
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
            if (r.done)
                break;
        }
        await iterator.close();
        return out;
    }
    async Exists(ctx, tokenId) { return this.exists(ctx, `invoice:${tokenId}`); }
    async TokenURI(ctx, tokenId) {
        const pub = await this.getPublic(ctx, `invoice:${tokenId}`);
        return JSON.stringify({ tokenId: pub.tokenId, numero: pub.numero, estado: pub.estado, hashPDF: pub.hashPDF });
    }
}
exports.NftInvoiceContract = NftInvoiceContract;
exports.contracts = [new NftInvoiceContract()];
