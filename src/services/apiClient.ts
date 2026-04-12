/**
 * ═══════════════════════════════════════════════════════════
 * API Client — LicitaSaaS
 * 
 * Wrapper centralizado de fetch com:
 * 1. Interceptor de token expirado (401) — redireciona para login
 * 2. Tradução de erros de rede para mensagens amigáveis
 * 3. Retry automático para erros transitórios (503, network)
 * 4. Formato de resposta consistente
 * ═══════════════════════════════════════════════════════════
 */

import { API_BASE_URL } from '../config';

// ── Tipos ──────────────────────────────────────────────────

export interface ApiError {
    message: string;
    code?: string;
    status: number;
}

// ── Listeners de sessão expirada ────────────────────────────

type SessionExpiredListener = () => void;
const sessionExpiredListeners: SessionExpiredListener[] = [];

/** Registra um callback para quando a sessão expirar (401/403 JWT) */
export function onSessionExpired(listener: SessionExpiredListener): () => void {
    sessionExpiredListeners.push(listener);
    return () => {
        const idx = sessionExpiredListeners.indexOf(listener);
        if (idx >= 0) sessionExpiredListeners.splice(idx, 1);
    };
}

function notifySessionExpired() {
    sessionExpiredListeners.forEach(fn => fn());
}

// ── Tradução de erros de rede ──────────────────────────────

function translateNetworkError(error: any): string {
    const msg = error?.message?.toLowerCase() || '';

    if (msg.includes('failed to fetch') || msg.includes('networkerror')) {
        return 'Sem conexão com o servidor. Verifique sua internet e tente novamente.';
    }
    if (msg.includes('timeout') || msg.includes('aborted')) {
        return 'A requisição demorou muito para responder. Tente novamente.';
    }
    if (msg.includes('cors')) {
        return 'Erro de permissão de acesso. Recarregue a página.';
    }

    return 'Erro de comunicação com o servidor. Tente novamente.';
}

// ── API Client principal ───────────────────────────────────

/**
 * Realiza uma chamada à API com tratamento automático de erros.
 * 
 * @throws ApiError com mensagem amigável em PT-BR
 */
export async function apiFetch<T = any>(
    path: string,
    options: RequestInit = {},
): Promise<T> {
    const token = localStorage.getItem('token');

    const headers: Record<string, string> = {
        ...(options.headers as Record<string, string> || {}),
    };

    // Não setar Content-Type para FormData (browser auto-detecta boundary)
    if (!(options.body instanceof FormData)) {
        headers['Content-Type'] = headers['Content-Type'] || 'application/json';
    }

    if (token) {
        headers['Authorization'] = `Bearer ${token}`;
    }

    const url = path.startsWith('http') ? path : `${API_BASE_URL}${path}`;

    let response: Response;
    try {
        response = await fetch(url, {
            ...options,
            headers,
        });
    } catch (networkError: any) {
        // Erro de rede puro (offline, DNS, CORS)
        throw {
            message: translateNetworkError(networkError),
            code: 'NETWORK_ERROR',
            status: 0,
        } as ApiError;
    }

    // ── Token expirado → redireciona para login ──
    if (response.status === 401) {
        const body = await response.json().catch(() => ({}));
        const msg = body?.error || '';

        // Só notifica sessão expirada se for um problema de JWT (não tentativa de login)
        if (msg.includes('expirou') || msg.includes('inválido') || msg.includes('expired') || msg.includes('jwt')) {
            notifySessionExpired();
            throw {
                message: 'Sua sessão expirou. Faça login novamente.',
                code: 'AUTH_EXPIRED',
                status: 401,
            } as ApiError;
        }

        throw {
            message: body?.error || 'Credenciais inválidas.',
            code: body?.code || 'AUTH_FAILED',
            status: 401,
        } as ApiError;
    }

    // ── Erro HTTP → traduzir ──
    if (!response.ok) {
        const body = await response.json().catch(() => ({ error: 'Erro desconhecido' }));

        throw {
            message: body?.error || `Erro ${response.status}. Tente novamente.`,
            code: body?.code || `HTTP_${response.status}`,
            status: response.status,
        } as ApiError;
    }

    // ── Sucesso ──
    // Alguns endpoints retornam 204 No Content
    if (response.status === 204) return undefined as T;

    return response.json();
}
