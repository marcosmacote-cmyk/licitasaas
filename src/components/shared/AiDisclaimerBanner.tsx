/**
 * AiDisclaimerBanner.tsx — Aviso padrão para funcionalidades que utilizam IA
 * 
 * Componente reutilizável que exibe um banner informativo alertando o usuário
 * que os dados foram gerados por Inteligência Artificial e devem ser conferidos
 * junto ao edital/documento original.
 * 
 * Variantes:
 *   - 'extraction': Para extração de planilha orçamentária
 *   - 'analysis':   Para análise de edital
 *   - 'declaration': Para geração de declarações
 *   - 'petition':   Para geração de petições
 *   - 'proposal':   Para carta proposta
 *   - 'generic':    Aviso genérico de IA
 */

import { AlertTriangle, Info, Sparkles } from 'lucide-react';

type DisclaimerVariant = 'extraction' | 'extraction_limited' | 'analysis' | 'declaration' | 'petition' | 'proposal' | 'generic';

interface Props {
    variant?: DisclaimerVariant;
    /** Override the default message */
    message?: string;
    /** Whether to show a compact (inline) or full banner */
    compact?: boolean;
    /** Additional CSS styles */
    style?: React.CSSProperties;
}

const VARIANT_MESSAGES: Record<DisclaimerVariant, { icon: 'warning' | 'info'; title: string; message: string }> = {
    extraction: {
        icon: 'warning',
        title: 'Extração gerada por IA',
        message: 'Os itens da planilha orçamentária foram extraídos automaticamente por Inteligência Artificial. ' +
            'Confira todos os valores, quantitativos, códigos e descrições junto ao edital e seus anexos antes de submeter a proposta.',
    },
    extraction_limited: {
        icon: 'warning',
        title: '⚠️ Planilha orçamentária não encontrada nos documentos do PNCP',
        message: 'A IA não localizou uma planilha orçamentária detalhada nos arquivos disponíveis no PNCP. ' +
            'O resultado abaixo contém apenas itens genéricos extraídos do Termo de Referência. ' +
            'Verifique se o órgão licitante disponibilizou os anexos orçamentários (planilha sintética, BDI, composições) ' +
            'em outro portal ou plataforma. Use a função "Importar" na barra de ferramentas para carregar uma planilha .xlsx ou .pdf obtida externamente.',
    },
    analysis: {
        icon: 'info',
        title: 'Análise gerada por IA',
        message: 'Esta análise foi gerada automaticamente por Inteligência Artificial. ' +
            'As informações podem conter imprecisões. Confira os dados junto ao edital original.',
    },
    declaration: {
        icon: 'warning',
        title: 'Declaração gerada por IA',
        message: 'Esta declaração foi redigida automaticamente por Inteligência Artificial. ' +
            'Revise atentamente o conteúdo, termos legais e dados da empresa antes de assinar e protocolar.',
    },
    petition: {
        icon: 'warning',
        title: 'Petição gerada por IA',
        message: 'Esta petição (impugnação, recurso ou contrarrazões) foi elaborada por Inteligência Artificial. ' +
            'Revise os argumentos jurídicos, referências legais e prazos junto ao edital antes de protocolar.',
    },
    proposal: {
        icon: 'warning',
        title: 'Proposta assistida por IA',
        message: 'Os dados desta carta proposta foram processados com auxílio de Inteligência Artificial. ' +
            'Verifique todos os valores, cálculos de BDI e dados da empresa antes da assinatura.',
    },
    generic: {
        icon: 'info',
        title: 'Conteúdo gerado por IA',
        message: 'Este conteúdo foi gerado por Inteligência Artificial e pode conter erros. ' +
            'Confira todas as informações junto aos documentos oficiais.',
    },
};

export function AiDisclaimerBanner({ variant = 'generic', message, compact = false, style }: Props) {
    const config = VARIANT_MESSAGES[variant];
    const displayMessage = message || config.message;

    if (compact) {
        return (
            <div style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                padding: '8px 12px',
                borderRadius: 8,
                background: 'var(--color-warning-bg, #fef3cd)',
                border: '1px solid var(--color-warning-border, #ffc107)',
                fontSize: '0.78rem',
                color: 'var(--color-warning-text, #856404)',
                lineHeight: 1.4,
                ...style,
            }}>
                <Sparkles size={14} style={{ flexShrink: 0, opacity: 0.7 }} />
                <span>{displayMessage}</span>
            </div>
        );
    }

    return (
        <div style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 12,
            padding: '14px 18px',
            borderRadius: 10,
            background: config.icon === 'warning'
                ? 'linear-gradient(135deg, rgba(255, 193, 7, 0.08), rgba(255, 152, 0, 0.05))'
                : 'linear-gradient(135deg, rgba(59, 130, 246, 0.08), rgba(99, 102, 241, 0.05))',
            border: config.icon === 'warning'
                ? '1px solid rgba(255, 193, 7, 0.25)'
                : '1px solid rgba(59, 130, 246, 0.2)',
            ...style,
        }}>
            <div style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 32,
                height: 32,
                borderRadius: 8,
                flexShrink: 0,
                background: config.icon === 'warning'
                    ? 'rgba(255, 193, 7, 0.15)'
                    : 'rgba(59, 130, 246, 0.12)',
            }}>
                {config.icon === 'warning'
                    ? <AlertTriangle size={16} color="#d97706" />
                    : <Info size={16} color="#3b82f6" />
                }
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
                <span style={{
                    fontWeight: 700,
                    fontSize: '0.82rem',
                    color: config.icon === 'warning'
                        ? 'var(--color-warning-title, #92400e)'
                        : 'var(--color-info-title, #1e40af)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: 6,
                }}>
                    <Sparkles size={13} style={{ opacity: 0.6 }} />
                    {config.title}
                </span>
                <span style={{
                    fontSize: '0.78rem',
                    color: 'var(--color-text-secondary, #6b7280)',
                    lineHeight: 1.5,
                }}>
                    {displayMessage}
                </span>
            </div>
        </div>
    );
}
