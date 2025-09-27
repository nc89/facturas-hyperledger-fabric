"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.refPagoSchema = exports.motivoSchema = exports.mintFacturaSchema = void 0;
exports.validateBody = validateBody;
const http_errors_1 = __importDefault(require("http-errors"));
const zod_1 = require("zod");
const itemSchema = zod_1.z.object({
    descripcion: zod_1.z.string().min(1).max(256),
    cantidad: zod_1.z.number().int().positive(),
    precioUnit: zod_1.z.number().positive(),
    iva: zod_1.z.number().nonnegative().optional(),
});
const adjuntoSchema = zod_1.z.object({
    nombre: zod_1.z.string().min(1).max(256),
    uri: zod_1.z.string().min(1),
    hash: zod_1.z.string().optional(),
});
const privateDataSchema = zod_1.z
    .object({
    items: zod_1.z.array(itemSchema).min(1).optional(),
    observaciones: zod_1.z.string().max(2000).optional(),
    adjuntos: zod_1.z.array(adjuntoSchema).optional(),
    metadata: zod_1.z.record(zod_1.z.any()).optional(),
})
    .strict();
exports.mintFacturaSchema = zod_1.z
    .object({
    tokenId: zod_1.z.string().min(1).max(128),
    numero: zod_1.z.string().min(1).max(128),
    receptorId: zod_1.z.string().min(1).max(128),
    moneda: zod_1.z.string().min(1).max(16).default('COP'),
    montoTotal: zod_1.z.coerce.number().nonnegative().default(0),
    hashPDF: zod_1.z.string().optional(),
    privateData: privateDataSchema.optional(),
})
    .strict();
exports.motivoSchema = zod_1.z.object({ motivo: zod_1.z.string().max(512).optional() }).strict();
exports.refPagoSchema = zod_1.z.object({ refPago: zod_1.z.string().max(256).optional() }).strict();
function validateBody(schema) {
    return (req, _res, next) => {
        const result = schema.safeParse(req.body ?? {});
        if (!result.success) {
            next((0, http_errors_1.default)(400, result.error.issues.map((issue) => issue.message).join(', ')));
            return;
        }
        req.body = result.data;
        next();
    };
}
