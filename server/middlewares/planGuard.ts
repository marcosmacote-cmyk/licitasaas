import { Response, NextFunction } from 'express';
import { AuthenticatedRequest } from './auth';
import { isTenantSuspended } from '../lib/planLimits';

export async function planGuard(req: AuthenticatedRequest, res: Response, next: NextFunction) {
  try {
    // Permit read operations (GET) for suspended tenants
    if (req.method === 'GET') {
      return next();
    }

    const tenantId = req.user?.tenantId;
    if (!tenantId) {
      return res.status(401).json({ error: 'Organização não identificada.' });
    }

    // Skip check for SUPER_ADMIN role (global admin can act)
    if (req.user?.role === 'SUPER_ADMIN') {
      return next();
    }

    const suspended = await isTenantSuspended(tenantId);
    if (suspended) {
      return res.status(403).json({
        error: 'SUBSCRIBE_SUSPENDED',
        message: 'Sua assinatura está suspensa ou expirada. Por favor, regularize seus pagamentos para retomar as operações.'
      });
    }

    next();
  } catch (error: any) {
    console.error('[PlanGuard] Erro ao verificar status da assinatura:', error);
    next(); // Fallback to let request continue in case of DB failure to prevent blocking the app
  }
}
