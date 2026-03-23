#!/usr/bin/env node
/**
 * Gerador de Worker Token — Use localmente para gerar tokens de longa duração.
 * 
 * USO:
 *   node generate-worker-token.js
 * 
 * O script usa o mesmo JWT_SECRET do servidor (env var ou fallback).
 * Se rodar no Railway, usará o JWT_SECRET de produção automaticamente.
 */

const jwt = require('jsonwebtoken');

const JWT_SECRET = process.env.JWT_SECRET || 'fallback-secret';

const TENANT_ID = process.env.TENANT_ID || '9f7a7155-be67-4470-8952-eb947fd97931';
const USER_ID = process.env.USER_ID || '42a629b0-4fd3-48b4-9a16-c585600fe682';
const LABEL = process.env.LABEL || 'bbmnet-watcher';

const token = jwt.sign(
    {
        userId: USER_ID,
        tenantId: TENANT_ID,
        role: 'ADMIN',
        purpose: 'worker',
        label: LABEL,
    },
    JWT_SECRET,
    { expiresIn: '365d' }
);

console.log('');
console.log('═══════════════════════════════════════════════');
console.log('  🔑 Worker Token Generated');
console.log('═══════════════════════════════════════════════');
console.log(`  Label:    ${LABEL}`);
console.log(`  Tenant:   ${TENANT_ID}`);
console.log(`  User:     ${USER_ID}`);
console.log(`  Expires:  365 days`);
console.log(`  Secret:   ${JWT_SECRET === 'fallback-secret' ? '⚠️  USING FALLBACK (dev only)' : '✅ Production secret'}`);
console.log('───────────────────────────────────────────────');
console.log('');
console.log(token);
console.log('');
