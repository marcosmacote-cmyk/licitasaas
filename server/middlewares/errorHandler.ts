/**
 * ═══════════════════════════════════════════════════════════
 * Global Error Handler — LicitaSaaS
 * 
 * Middleware central que:
 * 1. Intercepta TODOS os erros não tratados
 * 2. Traduz erros técnicos (Prisma, IA, etc.) para mensagens amigáveis em PT-BR
 * 3. Loga detalhes técnicos no servidor (não expõe ao cliente)
 * 4. Garante formato de resposta consistente: { error: string, code?: string }
 * ═══════════════════════════════════════════════════════════
 */

import { Request, Response, NextFunction } from 'express';

// ── Classificação de erros ──────────────────────────────────

interface ErrorMapping {
    /** Padrão (regex ou string) para detectar no error.message */
    pattern: RegExp;
    /** Mensagem amigável em PT-BR para o usuário */
    userMessage: string;
    /** HTTP status code */
    statusCode: number;
    /** Código interno para rastreamento */
    code: string;
}

const ERROR_MAPPINGS: ErrorMapping[] = [
    // ── Prisma / Database ──
    {
        pattern: /Unique constraint failed/i,
        userMessage: 'Este registro já existe no sistema. Verifique se não há duplicidade.',
        statusCode: 409,
        code: 'DB_DUPLICATE',
    },
    {
        pattern: /Record to (update|delete) does not exist/i,
        userMessage: 'O registro que você tentou alterar não foi encontrado. Ele pode ter sido removido.',
        statusCode: 404,
        code: 'DB_NOT_FOUND',
    },
    {
        pattern: /Foreign key constraint failed/i,
        userMessage: 'Não é possível realizar esta operação pois o registro está vinculado a outros dados.',
        statusCode: 409,
        code: 'DB_FK_VIOLATION',
    },
    {
        pattern: /Can't reach database server/i,
        userMessage: 'O servidor de dados está temporariamente indisponível. Tente novamente em alguns instantes.',
        statusCode: 503,
        code: 'DB_UNREACHABLE',
    },
    {
        pattern: /Connection (timed out|refused|reset)/i,
        userMessage: 'Falha de conexão com o servidor de dados. Tente novamente em alguns instantes.',
        statusCode: 503,
        code: 'DB_TIMEOUT',
    },
    {
        pattern: /prepared statement .* already exists/i,
        userMessage: 'Erro temporário de conexão com o banco de dados. Tente novamente.',
        statusCode: 503,
        code: 'DB_PREPARED_STMT',
    },
    {
        pattern: /Argument .* is missing/i,
        userMessage: 'Dados obrigatórios não foram preenchidos. Verifique os campos e tente novamente.',
        statusCode: 400,
        code: 'VALIDATION_MISSING_FIELD',
    },

    // ── IA / Gemini / OpenAI ──
    {
        pattern: /RESOURCE_EXHAUSTED|429|quota/i,
        userMessage: 'A cota de processamento de IA foi atingida. Aguarde alguns minutos e tente novamente.',
        statusCode: 429,
        code: 'AI_QUOTA_EXCEEDED',
    },
    {
        pattern: /503|UNAVAILABLE|Service Unavailable/i,
        userMessage: 'O serviço de IA está temporariamente indisponível. Tente novamente em alguns instantes.',
        statusCode: 503,
        code: 'AI_UNAVAILABLE',
    },
    {
        pattern: /GEMINI_API_KEY|API key not valid/i,
        userMessage: 'Configuração de IA incompleta. Entre em contato com o suporte técnico.',
        statusCode: 500,
        code: 'AI_CONFIG_ERROR',
    },
    {
        pattern: /safety|HARM_CATEGORY|blocked/i,
        userMessage: 'O conteúdo do documento acionou um filtro de segurança da IA. Tente novamente ou envie o documento para análise manual.',
        statusCode: 422,
        code: 'AI_SAFETY_BLOCK',
    },
    {
        pattern: /Failed to (parse|interpret|extract)/i,
        userMessage: 'A IA não conseguiu interpretar o documento. O PDF pode estar escaneado, protegido ou em formato não-textual.',
        statusCode: 422,
        code: 'AI_PARSE_FAILURE',
    },
    {
        pattern: /insuficiente|insufficient/i,
        userMessage: 'A IA não conseguiu extrair dados suficientes deste edital. Verifique se o documento está completo e legível.',
        statusCode: 422,
        code: 'AI_INSUFFICIENT_DATA',
    },
    {
        pattern: /token.*limit|MAX_TOKENS|context.*length/i,
        userMessage: 'O documento é muito extenso para processamento. Tente dividir o edital ou enviar apenas as seções principais.',
        statusCode: 413,
        code: 'AI_TOKEN_LIMIT',
    },

    // ── Autenticação / Autorização ──
    {
        pattern: /Token (inválido|expirado|não fornecido)/i,
        userMessage: 'Sua sessão expirou. Faça login novamente.',
        statusCode: 401,
        code: 'AUTH_EXPIRED',
    },
    {
        pattern: /jwt (expired|malformed)/i,
        userMessage: 'Sua sessão expirou. Faça login novamente.',
        statusCode: 401,
        code: 'AUTH_JWT_EXPIRED',
    },
    {
        pattern: /Acesso (negado|bloqueado)/i,
        userMessage: 'Você não tem permissão para realizar esta ação.',
        statusCode: 403,
        code: 'AUTH_FORBIDDEN',
    },

    // ── Upload / Arquivos ──
    {
        pattern: /File too large|LIMIT_FILE_SIZE/i,
        userMessage: 'O arquivo enviado excede o tamanho máximo permitido.',
        statusCode: 413,
        code: 'FILE_TOO_LARGE',
    },
    {
        pattern: /Unexpected field|LIMIT_UNEXPECTED_FILE/i,
        userMessage: 'Formato de arquivo não suportado. Envie um PDF ou documento válido.',
        statusCode: 400,
        code: 'FILE_INVALID_FORMAT',
    },

    // ── Network ──
    {
        pattern: /ECONNREFUSED|ENOTFOUND|ETIMEDOUT|ECONNRESET|fetch failed/i,
        userMessage: 'Falha de comunicação com um serviço externo. Tente novamente em alguns instantes.',
        statusCode: 502,
        code: 'EXTERNAL_SERVICE_ERROR',
    },
];

// ── Função utilitária para traduzir erros ──────────────────

/**
 * Traduz um erro técnico para uma mensagem amigável.
 * Pode ser usado diretamente nos catch blocks existentes.
 */
export function translateError(error: any): { userMessage: string; statusCode: number; code: string } {
    const message = error?.message || error?.toString() || 'Erro desconhecido';

    for (const mapping of ERROR_MAPPINGS) {
        if (mapping.pattern.test(message)) {
            return {
                userMessage: mapping.userMessage,
                statusCode: mapping.statusCode,
                code: mapping.code,
            };
        }
    }

    // Fallback genérico — nunca expor detalhes técnicos
    return {
        userMessage: 'Ocorreu um erro inesperado. Tente novamente ou entre em contato com o suporte.',
        statusCode: 500,
        code: 'INTERNAL_ERROR',
    };
}

/**
 * Helper para usar em catch blocks existentes.
 * Substitui: res.status(500).json({ error: err.message })
 * Por:       handleApiError(res, err, 'contexto')
 */
export function handleApiError(res: Response, error: any, context?: string): void {
    const translated = translateError(error);

    // Log técnico completo (fica apenas no servidor)
    console.error(`[ERROR] ${context || 'API'}:`, {
        code: translated.code,
        originalMessage: error?.message || error,
        stack: error?.stack?.split('\n').slice(0, 3).join('\n'),
        timestamp: new Date().toISOString(),
    });

    // Resposta limpa para o frontend
    if (!res.headersSent) {
        res.status(translated.statusCode).json({
            error: translated.userMessage,
            code: translated.code,
        });
    }
}

// ── Middleware global de erros (catch-all) ────────────────────

/**
 * Express error-handling middleware.
 * Deve ser registrado APÓS todas as rotas:
 *   app.use(globalErrorHandler);
 */
export function globalErrorHandler(err: any, _req: Request, res: Response, _next: NextFunction): void {
    handleApiError(res, err, 'GlobalHandler');
}
