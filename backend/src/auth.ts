import { NextFunction, Request, Response } from 'express';
import createError from 'http-errors';
import { bindingsStore } from './bindings-store';

export interface FabricIdentityBinding {
  apiKey: string;
  mspId: string;
  label: string;
  connectionProfile?: string;
  walletPath?: string;
}

declare global {
  namespace Express {
    interface Request {
      fabricIdentity?: FabricIdentityBinding;
    }
  }
}

function extractApiKey(req: Request): string | undefined {
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

export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  const apiKey = extractApiKey(req);
  if (!apiKey) {
    next(createError(401, 'API key requerida'));
    return;
  }

  const binding = bindingsStore.get(apiKey);
  if (!binding) {
    next(createError(403, 'API key inválida'));
    return;
  }

  req.fabricIdentity = binding;
  next();
}

export function requireMsp(...allowed: string[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    const identity = req.fabricIdentity;
    if (!identity) {
      next(createError(500, 'Identidad no disponible en el contexto'));
      return;
    }
    if (allowed.length > 0 && !allowed.includes(identity.mspId)) {
      next(createError(403, `MSP ${identity.mspId} no autorizada`));
      return;
    }
    next();
  };
}

export function getBindings(): FabricIdentityBinding[] {
  return bindingsStore.getAll();
}
