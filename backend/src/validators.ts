import { NextFunction, Request, Response } from 'express';
import createError from 'http-errors';
import { z } from 'zod';

const itemSchema = z.object({
  descripcion: z.string().min(1).max(256),
  cantidad: z.number().int().positive(),
  precioUnit: z.number().positive(),
  iva: z.number().nonnegative().optional(),
});

const adjuntoSchema = z.object({
  nombre: z.string().min(1).max(256),
  uri: z.string().min(1),
  hash: z.string().optional(),
});

const privateDataSchema = z
  .object({
    items: z.array(itemSchema).min(1).optional(),
    observaciones: z.string().max(2000).optional(),
    adjuntos: z.array(adjuntoSchema).optional(),
    metadata: z.record(z.any()).optional(),
  })
  .strict();

export const mintFacturaSchema = z
  .object({
    tokenId: z.string().min(1).max(128),
    numero: z.string().min(1).max(128),
    receptorId: z.string().min(1).max(128),
    moneda: z.string().min(1).max(16).default('COP'),
    montoTotal: z.coerce.number().nonnegative().default(0),
    hashPDF: z.string().optional(),
    privateData: privateDataSchema.optional(),
  })
  .strict();

export const motivoSchema = z.object({ motivo: z.string().max(512).optional() }).strict();
export const refPagoSchema = z.object({ refPago: z.string().max(256).optional() }).strict();

export const createUserSchema = z
  .object({
    apiKey: z.string().min(1),
    mspId: z.string().min(1),
    label: z.string().min(1),
    certificate: z.string().min(10),
    privateKey: z.string().min(10),
    connectionProfile: z.string().optional(),
    walletPath: z.string().optional(),
    overwrite: z.boolean().optional(),
  })
  .strict();

export function validateBody(schema: z.ZodSchema<any>) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const result = schema.safeParse(req.body ?? {});
    if (!result.success) {
      next(createError(400, result.error.issues.map((issue) => issue.message).join(', ')));
      return;
    }
    req.body = result.data;
    next();
  };
}
