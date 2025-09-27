import { Router, Request, Response } from 'express';
import { createHash } from 'crypto';
import { authMiddleware, requireMsp } from './auth';
import { bindingsStore } from './bindings-store';
import { fabricService } from './fabric';
import { getConsultaEventRecords, startConsultaListener, stopConsultaListener } from './event-listener';
import { createUserSchema, mintFacturaSchema, motivoSchema, refPagoSchema, validateBody } from './validators';

const CHANNEL_NAME = process.env.CHANNEL_NAME || 'facturas-channel';
const CHAINCODE_NAME = process.env.CC_NAME || 'nftinvoice';
const ADMIN_MSPS = (() => {
  const raw = process.env.ADMIN_MSPS ?? 'Org1MSP';
  const values = raw
    .split(',')
    .map((value) => value.trim())
    .filter((value) => value.length > 0);
  return values.length > 0 ? values : ['Org1MSP'];
})();

function bufferToJson(buffer: Buffer): any {
  if (!buffer || buffer.length === 0) {
    return undefined;
  }
  const text = buffer.toString('utf8');
  if (!text) {
    return undefined;
  }
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

async function registerConsulta(req: Request, tokenId: string) {
  try {
    const identity = req.fabricIdentity!;
    const hashed = createHash('sha256').update(identity.apiKey).digest('hex');
    await fabricService.submit(identity, CHANNEL_NAME, CHAINCODE_NAME, 'RegistrarConsulta', [tokenId, hashed]);
  } catch (err) {
    // registrar consulta es auxiliar; no debe bloquear la respuesta principal
    // eslint-disable-next-line no-console
    console.warn('Registro de consulta falló:', (err as Error).message);
  }
}

export const router = Router();

router.use(authMiddleware);

router.get('/admin/users', requireMsp(...ADMIN_MSPS), (req, res) => {
  const bindings = bindingsStore.getAll().map(({ apiKey, mspId, label, connectionProfile, walletPath }) => ({
    apiKey,
    mspId,
    label,
    connectionProfile,
    walletPath,
  }));
  res.json({ bindings });
});

router.post(
  '/admin/users',
  requireMsp(...ADMIN_MSPS),
  validateBody(createUserSchema),
  async (req, res, next) => {
    try {
      const { apiKey, mspId, label, certificate, privateKey, connectionProfile, walletPath, overwrite } = req.body;
      const normalisedCert = certificate.replace(/\r\n/g, '\n').trim();
      const normalisedKey = privateKey.replace(/\r\n/g, '\n').trim();
      const binding = { apiKey, mspId, label, connectionProfile, walletPath };

      const result = await fabricService.storeIdentity(binding, normalisedCert, normalisedKey, overwrite === true);
      await bindingsStore.upsert(binding);

      if (process.env.FABRIC_EVENT_API_KEY && process.env.FABRIC_EVENT_API_KEY === apiKey) {
        await stopConsultaListener();
        await startConsultaListener();
      } else {
        await startConsultaListener();
      }

      res.status(result === 'created' ? 201 : 200).json({
        apiKey,
        mspId,
        label,
        connectionProfile: binding.connectionProfile,
        walletPath: binding.walletPath,
        status: result,
      });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/facturas',
  requireMsp('Org1MSP'),
  validateBody(mintFacturaSchema),
  async (req, res, next) => {
    try {
      const identity = req.fabricIdentity!;
      const { privateData, ...payload } = req.body;
      const jsonPayload = JSON.stringify(payload);
      const privateJson = privateData ? JSON.stringify(privateData) : '';
      const transient = privateData ? { private: Buffer.from(privateJson) } : undefined;
      const buffer = await fabricService.submit(
        identity,
        CHANNEL_NAME,
        CHAINCODE_NAME,
        'MintFactura',
        [jsonPayload, privateJson],
        { transient }
      );
      res.status(201).json({ tokenId: buffer.toString('utf8') });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/facturas/:id/aceptar',
  requireMsp('Org2MSP'),
  async (req, res, next) => {
    try {
      const identity = req.fabricIdentity!;
      await fabricService.submit(identity, CHANNEL_NAME, CHAINCODE_NAME, 'AceptarFactura', [req.params.id]);
      res.json({ tokenId: req.params.id, estado: 'ACEPTADA' });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/facturas/:id/rechazar',
  requireMsp('Org2MSP'),
  validateBody(motivoSchema),
  async (req, res, next) => {
    try {
      const identity = req.fabricIdentity!;
      const motivo = req.body.motivo || '';
      await fabricService.submit(identity, CHANNEL_NAME, CHAINCODE_NAME, 'RechazarFactura', [req.params.id, motivo]);
      res.json({ tokenId: req.params.id, estado: 'RECHAZADA' });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/facturas/:id/pagar',
  requireMsp('Org1MSP'),
  validateBody(refPagoSchema),
  async (req, res, next) => {
    try {
      const identity = req.fabricIdentity!;
      const refPago = req.body.refPago || '';
      await fabricService.submit(identity, CHANNEL_NAME, CHAINCODE_NAME, 'PagarFactura', [req.params.id, refPago]);
      res.json({ tokenId: req.params.id, estado: 'PAGADA' });
    } catch (err) {
      next(err);
    }
  },
);

router.post(
  '/facturas/:id/anular',
  requireMsp('Org1MSP'),
  validateBody(motivoSchema),
  async (req, res, next) => {
    try {
      const identity = req.fabricIdentity!;
      const motivo = req.body.motivo || '';
      await fabricService.submit(identity, CHANNEL_NAME, CHAINCODE_NAME, 'AnularFactura', [req.params.id, motivo]);
      res.json({ tokenId: req.params.id, estado: 'ANULADA' });
    } catch (err) {
      next(err);
    }
  },
);

router.get('/facturas/:id', requireMsp(), async (req, res, next) => {
  try {
    const identity = req.fabricIdentity!;
    const tokenId = req.params.id;
    const buffer = await fabricService.evaluate(identity, CHANNEL_NAME, CHAINCODE_NAME, 'GetFactura', [tokenId]);
    const payload = bufferToJson(buffer);
    await registerConsulta(req, tokenId);
    res.json(payload);
  } catch (err) {
    next(err);
  }
});

router.get('/facturas/:id/privada', requireMsp(), async (req, res, next) => {
  try {
    const identity = req.fabricIdentity!;
    const buffer = await fabricService.evaluate(identity, CHANNEL_NAME, CHAINCODE_NAME, 'GetFacturaPrivada', [req.params.id]);
    res.json(bufferToJson(buffer));
  } catch (err) {
    next(err);
  }
});

router.get('/facturas/:id/historial', requireMsp(), async (req, res, next) => {
  try {
    const identity = req.fabricIdentity!;
    const buffer = await fabricService.evaluate(identity, CHANNEL_NAME, CHAINCODE_NAME, 'Historial', [req.params.id]);
    res.json(bufferToJson(buffer) || []);
  } catch (err) {
    next(err);
  }
});

router.get('/facturas/:id/consultas', requireMsp(), async (req, res, next) => {
  try {
    const identity = req.fabricIdentity!;
    const buffer = await fabricService.evaluate(identity, CHANNEL_NAME, CHAINCODE_NAME, 'Consultas', [req.params.id]);
    res.json(bufferToJson(buffer) || []);
  } catch (err) {
    next(err);
  }
});

router.get('/auditoria/consultas-offchain', requireMsp(), (req: Request, res: Response) => {
  res.json(getConsultaEventRecords());
});

export default router;
