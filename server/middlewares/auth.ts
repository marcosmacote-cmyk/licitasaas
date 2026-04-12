import jwt from 'jsonwebtoken';
import { Request, Response, NextFunction } from 'express';

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';

// Extend Express Request type to include user
export interface AuthenticatedRequest extends Request {
    user?: any;
}

// Middleware de Autenticação
export const authenticateToken = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    const authHeader = req.headers['authorization'];
    // Support token via query param for SSE (EventSource doesn't support custom headers)
    const token = (authHeader && authHeader.split(' ')[1]) || (req.query.token as string);

    if (!token) return res.status(401).json({ error: 'Token não fornecido' });

    jwt.verify(token, JWT_SECRET, (err: any, decoded: any) => {
        if (err) return res.status(403).json({ error: 'Token inválido ou expirado' });
        req.user = decoded;
        next();
    });
};

// Middleware para restringir rotas a Administradores da Organização (Tenant)
export const requireAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    // SUPER_ADMIN (Master) também tem permissões de ADMIN
    if (req.user?.role !== 'admin' && req.user?.role !== 'ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem realizar esta ação.' });
    }
    next();
};

// Middleware para restringir rotas a Super Administradores (Donos do SaaS)
export const requireSuperAdmin = (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
    if (req.user?.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Acesso negado. Apenas super administradores podem acessar esta área global.' });
    }
    next();
};

/**
 * Sprint 5.3: RBAC Granular Middleware
 * Permite o acesso se a role do usuário for uma das listadas.
 * 'SUPER_ADMIN' sempre tem permissão suprema de acesso.
 */
export const requireAnyRole = (allowedRoles: string[]) => {
    return (req: AuthenticatedRequest, res: Response, next: NextFunction) => {
        const userRole = (req.user?.role || '').toUpperCase();
        if (userRole === 'SUPER_ADMIN') return next();

        if (!allowedRoles.includes(userRole)) {
            return res.status(403).json({ 
                error: `Acesso negado (RBAC). Requer uma das roles: ${allowedRoles.join(', ')}` 
            });
        }
        next();
    };
};
