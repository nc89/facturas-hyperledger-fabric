import 'dotenv/config';
import cors from 'cors';
import express, { NextFunction, Request, Response } from 'express';
import createError from 'http-errors';
import router from './routes';
import { fabricService } from './fabric';
import { startConsultaListener, stopConsultaListener } from './event-listener';

const app = express();

app.use(cors());
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() });
});

app.use('/api', router);

app.use((_req, _res, next) => {
  next(createError(404, 'Recurso no encontrado'));
});

// eslint-disable-next-line @typescript-eslint/no-unused-vars
app.use((err: any, _req: Request, res: Response, _next: NextFunction) => {
  const status = err.status || 500;
  const payload: Record<string, unknown> = {
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
  startConsultaListener().catch((err) => {
    // eslint-disable-next-line no-console
    console.error('No se pudo iniciar el listener de consultas:', err);
  });
});

function shutdown(signal: NodeJS.Signals) {
  // eslint-disable-next-line no-console
  console.log(`Recibido ${signal}, cerrando servidor`);
  server.close(async () => {
    await stopConsultaListener();
    await fabricService.disconnect();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
