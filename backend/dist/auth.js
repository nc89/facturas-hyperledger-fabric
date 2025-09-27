"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.authMiddleware = authMiddleware;
exports.requireMsp = requireMsp;
exports.getBindings = getBindings;
const http_errors_1 = __importDefault(require("http-errors"));
const bindings = new Map();
function parseBindingTuple(raw) {
    const pieces = raw.split('|').map((value) => value.trim());
    if (pieces.length < 3) {
        throw new Error(`Formato inválido en FABRIC_API_KEYS: ${raw}`);
    }
    return [pieces[0], pieces[1], pieces[2], pieces[3], pieces[4]];
}
(function bootstrapBindings() {
    const raw = process.env.FABRIC_API_KEYS || '';
    raw
        .split(',')
        .map((entry) => entry.trim())
        .filter((entry) => entry.length > 0)
        .forEach((entry) => {
        const [token, mspId, label, profile, walletPath] = parseBindingTuple(entry);
        bindings.set(token, {
            apiKey: token,
            mspId,
            label,
            connectionProfile: profile || undefined,
            walletPath: walletPath || undefined,
        });
    });
})();
function extractApiKey(req) {
    const headerKey = req.header('x-api-key');
    if (headerKey) {
        return headerKey.trim();
    }
    const authHeader = req.header('authorization');
    if (authHeader && authHeader.toLowerCase().startsWith('bearer ')) {
        return authHeader.slice(7).trim();
    }
    return undefined;
}
function authMiddleware(req, _res, next) {
    const apiKey = extractApiKey(req);
    if (!apiKey) {
        next((0, http_errors_1.default)(401, 'API key requerida'));
        return;
    }
    const binding = bindings.get(apiKey);
    if (!binding) {
        next((0, http_errors_1.default)(403, 'API key inválida'));
        return;
    }
    req.fabricIdentity = binding;
    next();
}
function requireMsp(...allowed) {
    return (req, _res, next) => {
        const identity = req.fabricIdentity;
        if (!identity) {
            next((0, http_errors_1.default)(500, 'Identidad no disponible en el contexto'));
            return;
        }
        if (allowed.length > 0 && !allowed.includes(identity.mspId)) {
            next((0, http_errors_1.default)(403, `MSP ${identity.mspId} no autorizada`));
            return;
        }
        next();
    };
}
function getBindings() {
    return bindings;
}
