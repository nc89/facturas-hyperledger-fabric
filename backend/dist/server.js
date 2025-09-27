"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
require("dotenv/config");
const cors_1 = __importDefault(require("cors"));
const express_1 = __importDefault(require("express"));
const http_errors_1 = __importDefault(require("http-errors"));
const routes_1 = __importDefault(require("./routes"));
const fabric_1 = require("./fabric");
const event_listener_1 = require("./event-listener");
const app = (0, express_1.default)();
app.use((0, cors_1.default)());
app.use(express_1.default.json({ limit: '1mb' }));
app.get('/health', (_req, res) => {
    res.json({ status: 'ok', timestamp: Date.now() });
});
app.use('/api', routes_1.default);
app.use((_req, _res, next) => {
    next((0, http_errors_1.default)(404, 'Recurso no encontrado'));
});
// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err, _req, res, _next) => {
    const status = err.status || 500;
    const payload = {
        message: err.message || 'Error inesperado',
    };
    if (status >= 500) {
        // eslint-disable-next-line no-console
        console.error(err);
    }
    res.status(status).json(payload);
});
const port = Number(process.env.PORT || 3000);
const server = app.listen(port, () => {
    // eslint-disable-next-line no-console
    console.log(`API escuchando en puerto ${port}`);
    (0, event_listener_1.startConsultaListener)().catch((err) => {
        // eslint-disable-next-line no-console
        console.error('No se pudo iniciar el listener de consultas:', err);
    });
});
function shutdown(signal) {
    // eslint-disable-next-line no-console
    console.log(`Recibido ${signal}, cerrando servidor`);
    server.close(async () => {
        await (0, event_listener_1.stopConsultaListener)();
        await fabric_1.fabricService.disconnect();
        process.exit(0);
    });
}
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
