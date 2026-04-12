/**
 * ═══════════════════════════════════════════════════════════
 * TESTES — Error Handler (errorHandler.ts)
 * Sprint 1 | Item 1.1.2
 * 
 * Valida: tradução de erros Prisma, IA, Auth, Network
 * para mensagens amigáveis em PT-BR.
 * ═══════════════════════════════════════════════════════════
 */

import { describe, it, expect } from 'vitest';
import { translateError } from '../../../../server/middlewares/errorHandler';

describe('Error Handler — Tradução de Erros', () => {

    // ── Prisma / Database ──
    describe('Erros de Banco de Dados', () => {
        it('Unique constraint → mensagem de duplicidade', () => {
            const result = translateError(new Error('Unique constraint failed on the fields: (`email`)'));
            expect(result.code).toBe('DB_DUPLICATE');
            expect(result.statusCode).toBe(409);
            expect(result.userMessage).toContain('duplicidade');
        });

        it('Record to delete does not exist → não encontrado', () => {
            const result = translateError(new Error('Record to delete does not exist'));
            expect(result.code).toBe('DB_NOT_FOUND');
            expect(result.statusCode).toBe(404);
        });

        it('Foreign key constraint → vinculado a outros dados', () => {
            const result = translateError(new Error('Foreign key constraint failed on the field'));
            expect(result.code).toBe('DB_FK_VIOLATION');
            expect(result.statusCode).toBe(409);
        });

        it("Can't reach database server → serviço indisponível", () => {
            const result = translateError(new Error("Can't reach database server at localhost:5432"));
            expect(result.code).toBe('DB_UNREACHABLE');
            expect(result.statusCode).toBe(503);
        });

        it('Argument missing → campos obrigatórios', () => {
            const result = translateError(new Error("Argument 'userId' is missing"));
            expect(result.code).toBe('VALIDATION_MISSING_FIELD');
            expect(result.statusCode).toBe(400);
        });
    });

    // ── IA / Gemini / OpenAI ──
    describe('Erros de IA', () => {
        it('RESOURCE_EXHAUSTED → cota atingida', () => {
            const result = translateError(new Error('RESOURCE_EXHAUSTED: Quota exceeded'));
            expect(result.code).toBe('AI_QUOTA_EXCEEDED');
            expect(result.statusCode).toBe(429);
        });

        it('429 rate limit → cota atingida', () => {
            const result = translateError(new Error('429 Too Many Requests'));
            expect(result.code).toBe('AI_QUOTA_EXCEEDED');
            expect(result.statusCode).toBe(429);
        });

        it('503 Service Unavailable → IA indisponível', () => {
            const result = translateError(new Error('503 Service Unavailable'));
            expect(result.code).toBe('AI_UNAVAILABLE');
            expect(result.statusCode).toBe(503);
        });

        it('API key not valid → configuração incompleta', () => {
            const result = translateError(new Error('API key not valid'));
            expect(result.code).toBe('AI_CONFIG_ERROR');
            expect(result.statusCode).toBe(500);
        });

        it('Safety block → filtro de segurança', () => {
            const result = translateError(new Error('HARM_CATEGORY_HARASSMENT blocked'));
            expect(result.code).toBe('AI_SAFETY_BLOCK');
            expect(result.statusCode).toBe(422);
        });

        it('Failed to parse → interpretação falhou', () => {
            const result = translateError(new Error('Failed to parse response from AI'));
            expect(result.code).toBe('AI_PARSE_FAILURE');
            expect(result.statusCode).toBe(422);
        });

        it('Token limit → documento extenso', () => {
            const result = translateError(new Error('context length exceeded MAX_TOKENS'));
            expect(result.code).toBe('AI_TOKEN_LIMIT');
            expect(result.statusCode).toBe(413);
        });
    });

    // ── Autenticação ──
    describe('Erros de Autenticação', () => {
        it('Token expirado → sessão expirou', () => {
            const result = translateError(new Error('Token inválido ou expirado'));
            expect(result.code).toBe('AUTH_EXPIRED');
            expect(result.statusCode).toBe(401);
        });

        it('jwt expired → sessão expirou', () => {
            const result = translateError(new Error('jwt expired'));
            expect(result.code).toBe('AUTH_JWT_EXPIRED');
            expect(result.statusCode).toBe(401);
        });

        it('Acesso negado → sem permissão', () => {
            const result = translateError(new Error('Acesso negado. Apenas administradores.'));
            expect(result.code).toBe('AUTH_FORBIDDEN');
            expect(result.statusCode).toBe(403);
        });
    });

    // ── Upload / Arquivos ──
    describe('Erros de Upload', () => {
        it('File too large → tamanho excedido', () => {
            const result = translateError(new Error('File too large'));
            expect(result.code).toBe('FILE_TOO_LARGE');
            expect(result.statusCode).toBe(413);
        });
    });

    // ── Network ──
    describe('Erros de Rede', () => {
        it('ECONNREFUSED → serviço externo', () => {
            const result = translateError(new Error('connect ECONNREFUSED 127.0.0.1:443'));
            expect(result.code).toBe('EXTERNAL_SERVICE_ERROR');
            expect(result.statusCode).toBe(502);
        });

        it('fetch failed → serviço externo', () => {
            const result = translateError(new Error('fetch failed'));
            expect(result.code).toBe('EXTERNAL_SERVICE_ERROR');
            expect(result.statusCode).toBe(502);
        });
    });

    // ── Fallback ──
    describe('Fallback Genérico', () => {
        it('erro desconhecido → mensagem genérica segura', () => {
            const result = translateError(new Error('something totally unexpected xyz123'));
            expect(result.code).toBe('INTERNAL_ERROR');
            expect(result.statusCode).toBe(500);
            expect(result.userMessage).not.toContain('xyz123'); // NUNCA expor detalhe técnico
        });

        it('null error → não crasheia', () => {
            const result = translateError(null);
            expect(result.code).toBe('INTERNAL_ERROR');
            expect(result.statusCode).toBe(500);
        });

        it('undefined error → não crasheia', () => {
            const result = translateError(undefined);
            expect(result.code).toBe('INTERNAL_ERROR');
            expect(result.statusCode).toBe(500);
        });
    });
});
