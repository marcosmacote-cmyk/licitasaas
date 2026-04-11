"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.requireSuperAdmin = exports.requireAdmin = exports.authenticateToken = void 0;
const jsonwebtoken_1 = __importDefault(require("jsonwebtoken"));
const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';
// Middleware de Autenticação
const authenticateToken = (req, res, next) => {
    const authHeader = req.headers['authorization'];
    // Support token via query param for SSE (EventSource doesn't support custom headers)
    const token = (authHeader && authHeader.split(' ')[1]) || req.query.token;
    if (!token)
        return res.status(401).json({ error: 'Token não fornecido' });
    jsonwebtoken_1.default.verify(token, JWT_SECRET, (err, decoded) => {
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
