"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireAnyRole = exports.requireSuperAdmin = exports.requireAdmin = exports.authenticateToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const constants_1 = require("../lib/constants");
// Middleware de Autenticação
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    // Support token via query param for SSE (EventSource doesn't support custom headers)
    const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;
    if (!token)
        return res.status(401).json({ error: 'Token não fornecido' });
    jsonwebtoken_1.default.verify(token, constants_1.JWT_SECRET, (err, decoded) => {
        if (err)
            return res.status(403).json({ error: 'Token inválido ou expirado' });
        req.user = decoded;
        next();
    });
};
exports.authenticateToken = authenticateToken;
// Middleware para restringir rotas a Administradores da Organização (Tenant)
const requireAdmin = (req, res, next) => {
    // SUPER_ADMIN (Master) também tem permissões de ADMIN
    if (req.user?.role !== 'admin' && req.user?.role !== 'ADMIN' && req.user?.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Acesso negado. Apenas administradores podem realizar esta ação.' });
    }
    next();
};
exports.requireAdmin = requireAdmin;
// Middleware para restringir rotas a Super Administradores (Donos do SaaS)
const requireSuperAdmin = (req, res, next) => {
    if (req.user?.role !== 'SUPER_ADMIN') {
        return res.status(403).json({ error: 'Acesso negado. Apenas super administradores podem acessar esta área global.' });
    }
    next();
};
exports.requireSuperAdmin = requireSuperAdmin;
/**
 * Sprint 5.3: RBAC Granular Middleware
 * Permite o acesso se a role do usuário for uma das listadas.
 * 'SUPER_ADMIN' sempre tem permissão suprema de acesso.
 */
const requireAnyRole = (allowedRoles) => {
    return (req, res, next) => {
        const userRole = (req.user?.role || '').toUpperCase();
        if (userRole === 'SUPER_ADMIN')
            return next();
        if (!allowedRoles.includes(userRole)) {
            return res.status(403).json({
                error: `Acesso negado (RBAC). Requer uma das roles: ${allowedRoles.join(', ')}`
            });
        }
        next();
    };
};
exports.requireAnyRole = requireAnyRole;
