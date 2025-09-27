"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.router = void 0;
const express_1 = require("express");
const crypto_1 = require("crypto");
const auth_1 = require("./auth");
const fabric_1 = require("./fabric");
const event_listener_1 = require("./event-listener");
const validators_1 = require("./validators");
const CHANNEL_NAME = process.env.CHANNEL_NAME || 'facturas-channel';
const CHAINCODE_NAME = process.env.CC_NAME || 'nftinvoice';
function bufferToJson(buffer) {
    if (!buffer || buffer.length === 0) {
        return undefined;
    }
    const text = buffer.toString('utf8');
    if (!text) {
        return undefined;
    }
    try {
        return JSON.parse(text);
    }
    catch {
        return text;
    }
}
async function registerConsulta(req, tokenId) {
    try {
        const identity = req.fabricIdentity;
        const hashed = (0, crypto_1.createHash)('sha256').update(identity.apiKey).digest('hex');
        await fabric_1.fabricService.submit(identity, CHANNEL_NAME, CHAINCODE_NAME, 'RegistrarConsulta', [tokenId, hashed]);
    }
    catch (err) {
        // registrar consulta es auxiliar; no debe bloquear la respuesta principal
        // eslint-disable-next-line no-console
        console.warn('Registro de consulta falló:', err.message);
    }
}
exports.router = (0, express_1.Router)();
exports.router.use(auth_1.authMiddleware);
exports.router.post('/facturas', (0, auth_1.requireMsp)('Org1MSP'), (0, validators_1.validateBody)(validators_1.mintFacturaSchema), async (req, res, next) => {
    try {
        const identity = req.fabricIdentity;
        const { privateData, ...payload } = req.body;
        const args = [JSON.stringify(payload)];
        const transient = privateData ? { private: Buffer.from(JSON.stringify(privateData)) } : undefined;
        const buffer = await fabric_1.fabricService.submit(identity, CHANNEL_NAME, CHAINCODE_NAME, 'MintFactura', args, {
            transient,
        });
        res.status(201).json({ tokenId: buffer.toString('utf8') });
    }
    catch (err) {
        next(err);
    }
});
exports.router.post('/facturas/:id/aceptar', (0, auth_1.requireMsp)('Org2MSP'), async (req, res, next) => {
    try {
        const identity = req.fabricIdentity;
        await fabric_1.fabricService.submit(identity, CHANNEL_NAME, CHAINCODE_NAME, 'AceptarFactura', [req.params.id]);
        res.json({ tokenId: req.params.id, estado: 'ACEPTADA' });
    }
    catch (err) {
        next(err);
    }
});
exports.router.post('/facturas/:id/rechazar', (0, auth_1.requireMsp)('Org2MSP'), (0, validators_1.validateBody)(validators_1.motivoSchema), async (req, res, next) => {
    try {
        const identity = req.fabricIdentity;
        const motivo = req.body.motivo || '';
        await fabric_1.fabricService.submit(identity, CHANNEL_NAME, CHAINCODE_NAME, 'RechazarFactura', [req.params.id, motivo]);
        res.json({ tokenId: req.params.id, estado: 'RECHAZADA' });
    }
    catch (err) {
        next(err);
    }
});
exports.router.post('/facturas/:id/pagar', (0, auth_1.requireMsp)('Org1MSP'), (0, validators_1.validateBody)(validators_1.refPagoSchema), async (req, res, next) => {
    try {
        const identity = req.fabricIdentity;
        const refPago = req.body.refPago || '';
        await fabric_1.fabricService.submit(identity, CHANNEL_NAME, CHAINCODE_NAME, 'PagarFactura', [req.params.id, refPago]);
        res.json({ tokenId: req.params.id, estado: 'PAGADA' });
    }
    catch (err) {
        next(err);
    }
});
exports.router.post('/facturas/:id/anular', (0, auth_1.requireMsp)('Org1MSP'), (0, validators_1.validateBody)(validators_1.motivoSchema), async (req, res, next) => {
    try {
        const identity = req.fabricIdentity;
        const motivo = req.body.motivo || '';
        await fabric_1.fabricService.submit(identity, CHANNEL_NAME, CHAINCODE_NAME, 'AnularFactura', [req.params.id, motivo]);
        res.json({ tokenId: req.params.id, estado: 'ANULADA' });
    }
    catch (err) {
        next(err);
    }
});
exports.router.get('/facturas/:id', (0, auth_1.requireMsp)(), async (req, res, next) => {
    try {
        const identity = req.fabricIdentity;
        const tokenId = req.params.id;
        const buffer = await fabric_1.fabricService.evaluate(identity, CHANNEL_NAME, CHAINCODE_NAME, 'GetFactura', [tokenId]);
        const payload = bufferToJson(buffer);
        await registerConsulta(req, tokenId);
        res.json(payload);
    }
    catch (err) {
        next(err);
    }
});
exports.router.get('/facturas/:id/privada', (0, auth_1.requireMsp)(), async (req, res, next) => {
    try {
        const identity = req.fabricIdentity;
        const buffer = await fabric_1.fabricService.evaluate(identity, CHANNEL_NAME, CHAINCODE_NAME, 'GetFacturaPrivada', [req.params.id]);
        res.json(bufferToJson(buffer));
    }
    catch (err) {
        next(err);
    }
});
exports.router.get('/facturas/:id/historial', (0, auth_1.requireMsp)(), async (req, res, next) => {
    try {
        const identity = req.fabricIdentity;
        const buffer = await fabric_1.fabricService.evaluate(identity, CHANNEL_NAME, CHAINCODE_NAME, 'Historial', [req.params.id]);
        res.json(bufferToJson(buffer) || []);
    }
    catch (err) {
        next(err);
    }
});
exports.router.get('/facturas/:id/consultas', (0, auth_1.requireMsp)(), async (req, res, next) => {
    try {
        const identity = req.fabricIdentity;
        const buffer = await fabric_1.fabricService.evaluate(identity, CHANNEL_NAME, CHAINCODE_NAME, 'Consultas', [req.params.id]);
        res.json(bufferToJson(buffer) || []);
    }
    catch (err) {
        next(err);
    }
});
exports.router.get('/auditoria/consultas-offchain', (0, auth_1.requireMsp)(), (req, res) => {
    res.json((0, event_listener_1.getConsultaEventRecords)());
});
exports.default = exports.router;
