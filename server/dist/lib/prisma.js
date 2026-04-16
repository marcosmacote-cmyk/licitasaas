"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.prisma = void 0;
const client_1 = require("@prisma/client");
const prisma = global.prisma || new client_1.PrismaClient({
    // Optimize connection pool for production
    // Default is 5 connections with no timeout — causes pool exhaustion under load
    datasources: process.env.NODE_ENV === 'production' ? {
        db: {
            url: (process.env.DATABASE_URL || '') +
                (process.env.DATABASE_URL?.includes('?') ? '&' : '?') +
                'connection_limit=15&pool_timeout=10'
        }
    } : undefined,
    log: process.env.NODE_ENV === 'production' ? ['error'] : ['error', 'warn'],
});
exports.prisma = prisma;
if (process.env.NODE_ENV !== 'production')
    global.prisma = prisma;
exports.default = prisma;
