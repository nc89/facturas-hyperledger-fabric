"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.contracts = exports.NftInvoiceContract = void 0;
const fabric_contract_api_1 = require("fabric-contract-api");
const crypto = __importStar(require("crypto"));
const PRIVATE_COLLECTION = 'FacturaPrivada';
const LOG_OBJECT_TYPE = 'factura-log';
function now() {
    return Math.floor(Date.now() / 1000);
}
function hashBuffer(buf) {
    return crypto.createHash('sha256').update(buf).digest('hex');
}
function hashString(value) {
    return hashBuffer(Buffer.from(value, 'utf8'));
}
function parseJson(raw, label) {
    try {
        return JSON.parse(raw);
    }
    catch (err) {
        throw new Error(`${label}: JSON inválido`);
    }
}
class NftInvoiceContract extends fabric_contract_api_1.Contract {
    getInvoiceKey(tokenId) {
        return `invoice:${tokenId}`;
    }
    getMSP(ctx) {
        return ctx.clientIdentity.getMSPID();
    }
    getActorInfo(ctx) {
        const mspId = this.getMSP(ctx);
        let enrollmentId;
        try {
            enrollmentId = ctx.clientIdentity.getAttributeValue('hf.EnrollmentID') || undefined;
        }
        catch {
            enrollmentId = undefined;
        }
        const identity = ctx.clientIdentity.getID();
        let subject;
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
    async exists(ctx, key) {
        const data = await ctx.stub.getState(key);
        return !!(data && data.length > 0);
    }
    async readFactura(ctx, tokenId) {
        const key = this.getInvoiceKey(tokenId);
        const buf = await ctx.stub.getState(key);
        if (!buf || buf.length === 0) {
            throw new Error(`Factura ${tokenId} no existe`);
        }
        return this.normalizeFactura(JSON.parse(buf.toString()));
    }
    async writeFactura(ctx, factura) {
        const key = this.getInvoiceKey(factura.tokenId);
        await ctx.stub.putState(key, Buffer.from(JSON.stringify(factura)));
    }
    normalizeFactura(raw) {
        const factura = raw;
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
        return factura;
    }
    ensureString(value, field) {
        if (typeof value !== 'string' || value.trim().length === 0) {
            throw new Error(`${field} es requerido`);
        }
        return value.trim();
    }
    sanitizeMintPayload(raw) {
        const dto = parseJson(raw, 'MintFactura');
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
    ensureAccess(ctx, factura, role) {
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
    async readPrivate(ctx, tokenId) {
        try {
            const buf = await ctx.stub.getPrivateData(PRIVATE_COLLECTION, this.getInvoiceKey(tokenId));
            if (buf && buf.length > 0) {
                return JSON.parse(buf.toString());
            }
            return undefined;
        }
        catch {
            return undefined;
        }
    }
    getTransientBuffer(ctx, key) {
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
    async storePrivate(ctx, tokenId, payload) {
        if (!payload) {
            return undefined;
        }
        await ctx.stub.putPrivateData(PRIVATE_COLLECTION, this.getInvoiceKey(tokenId), payload);
        return hashBuffer(payload);
    }
    async appendConsultaLog(ctx, log) {
        const compositeKey = ctx.stub.createCompositeKey(LOG_OBJECT_TYPE, [log.tokenId, log.consultedAt.toString(), log.hashedId]);
        await ctx.stub.putPrivateData(PRIVATE_COLLECTION, compositeKey, Buffer.from(JSON.stringify(log)));
    }
    createAuditEntry(ctx, accion, metadata) {
        const actor = this.getActorInfo(ctx);
        const entry = {
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
    applyAction(ctx, factura, estado, metadata) {
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
    async getConsultaLogs(ctx, tokenId) {
        const iterator = ctx.stub.getPrivateDataByPartialCompositeKey(PRIVATE_COLLECTION, LOG_OBJECT_TYPE, [tokenId]);
        const logs = [];
        for await (const item of iterator) {
            if (item.value) {
                const buffer = item.value.value || item.value;
                logs.push(JSON.parse(buffer.toString()));
            }
        }
        logs.sort((a, b) => a.consultedAt - b.consultedAt);
        return logs;
    }
    async MintFactura(ctx, dtoJson, privateJson) {
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
        let privateDataHash;
        if (transientPayload) {
            // Validate private payload is valid JSON before storing
            parseJson(transientPayload.toString(), 'private');
            privateDataHash = await this.storePrivate(ctx, dto.tokenId, transientPayload);
        }
        const entry = this.createAuditEntry(ctx, 'EMITIDA', { numero: dto.numero });
        const factura = {
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
    async AceptarFactura(ctx, tokenId) {
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
    async RechazarFactura(ctx, tokenId, motivo) {
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
    async PagarFactura(ctx, tokenId, refPago) {
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
    async AnularFactura(ctx, tokenId, motivo) {
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
    async GetFactura(ctx, tokenId) {
        const factura = await this.readFactura(ctx, tokenId);
        this.ensureAccess(ctx, factura, 'AMBOS');
        const privateData = await this.readPrivate(ctx, tokenId);
        return { public: factura, private: privateData };
    }
    async GetFacturaPrivada(ctx, tokenId) {
        const factura = await this.readFactura(ctx, tokenId);
        this.ensureAccess(ctx, factura, 'AMBOS');
        return this.readPrivate(ctx, tokenId);
    }
    async Historial(ctx, tokenId) {
        const factura = await this.readFactura(ctx, tokenId);
        this.ensureAccess(ctx, factura, 'AMBOS');
        return factura.historial || [];
    }
    async RegistrarConsulta(ctx, tokenId, hashedId) {
        const factura = await this.readFactura(ctx, tokenId);
        this.ensureAccess(ctx, factura, 'AMBOS');
        const value = this.ensureString(hashedId, 'hashedId');
        const entry = {
            tokenId,
            hashedId: value,
            actorMspId: this.getMSP(ctx),
            consultedAt: now(),
        };
        await this.appendConsultaLog(ctx, entry);
        await ctx.stub.setEvent('FacturaConsultada', Buffer.from(JSON.stringify(entry)));
    }
    async Consultas(ctx, tokenId) {
        const factura = await this.readFactura(ctx, tokenId);
        this.ensureAccess(ctx, factura, 'AMBOS');
        return this.getConsultaLogs(ctx, tokenId);
    }
    async Exists(ctx, tokenId) {
        return this.exists(ctx, this.getInvoiceKey(tokenId));
    }
    async TokenURI(ctx, tokenId) {
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
exports.NftInvoiceContract = NftInvoiceContract;
exports.contracts = [NftInvoiceContract];
