import { Edit3, RefreshCw, Save, ChevronLeft, ChevronRight, ChevronDown, File, Unlock, Lock, Loader2, FileText, Mail, ClipboardList, Building2, FileEdit, Scale, DollarSign, CalendarDays, ListChecks, Wrench, Landmark, MailCheck, PenTool } from 'lucide-react';
import type { ProposalLetterWizardProps } from '../ProposalLetterWizard';
import type { useProposalWizard } from '../useProposalWizard';
import { LetterBlockType } from '../types';

const BLOCK_LABELS: Record<string, { icon: React.ReactNode; color: string }> = {
    [LetterBlockType.TITLE]:                { icon: <FileText size={14} />,     color: '#1E40AF' },
    [LetterBlockType.RECIPIENT]:            { icon: <Mail size={14} />,          color: '#3B82F6' },
    [LetterBlockType.REFERENCE]:            { icon: <ClipboardList size={14} />, color: '#6366F1' },
    [LetterBlockType.QUALIFICATION]:        { icon: <Building2 size={14} />,     color: '#8B5CF6' },
    [LetterBlockType.OBJECT]:               { icon: <FileEdit size={14} />,      color: '#EC4899' },
    [LetterBlockType.COMMERCIAL]:           { icon: <Scale size={14} />,         color: '#F59E0B' },
    [LetterBlockType.PRICING_SUMMARY]:      { icon: <DollarSign size={14} />,    color: '#10B981' },
    [LetterBlockType.VALIDITY]:             { icon: <CalendarDays size={14} />,  color: '#06B6D4' },
    [LetterBlockType.PROPOSAL_CONDITIONS]:  { icon: <ListChecks size={14} />,    color: '#0EA5E9' },
    [LetterBlockType.EXECUTION]:            { icon: <Wrench size={14} />,        color: '#F97316' },
    [LetterBlockType.BANKING]:              { icon: <Landmark size={14} />,      color: '#14B8A6' },
    [LetterBlockType.CLOSING]:              { icon: <MailCheck size={14} />,     color: '#64748B' },
    [LetterBlockType.SIGNATURE]:            { icon: <PenTool size={14} />,       color: '#334155' },
};

const BLOCK_GROUPS = [
    { label: 'Título', ids: [LetterBlockType.TITLE] },
    { label: 'Identificação e Endereçamento', ids: [LetterBlockType.RECIPIENT, LetterBlockType.REFERENCE, LetterBlockType.QUALIFICATION] },
    { label: 'Corpo Principal da Proposta', ids: [LetterBlockType.OBJECT, LetterBlockType.COMMERCIAL, LetterBlockType.PRICING_SUMMARY, LetterBlockType.VALIDITY, LetterBlockType.PROPOSAL_CONDITIONS] },
    { label: 'Informações Complementares', ids: [LetterBlockType.EXECUTION, LetterBlockType.BANKING] },
    { label: 'Fechamento e Assinatura', ids: [LetterBlockType.CLOSING, LetterBlockType.SIGNATURE] },
];

const ATTENTION_BLOCKS = new Set<string>([LetterBlockType.OBJECT, LetterBlockType.PRICING_SUMMARY, LetterBlockType.QUALIFICATION]);

export function WizardStepReview({ p, w }: { p: ProposalLetterWizardProps, w: ReturnType<typeof useProposalWizard> }) {
    if (!w.letterResult) return null;

    return (
        <div>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 'var(--space-4)' }}>
                <h3 style={{ margin: 0, fontSize: 'var(--text-lg)', fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
                    <Edit3 size={18} color="var(--color-primary)" /> Revisão por Blocos
                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 400, color: 'var(--color-text-tertiary)' }}>
                        ({w.letterResult.blocks.filter(b => b.visible).length} blocos)
                    </span>
                </h3>
                <div style={{ display: 'flex', gap: 'var(--space-3)' }}>
                    <button onClick={() => { w.handleGenerate(); }} className="btn btn-outline" style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px' }}>
                        <RefreshCw size={13} /> Regenerar
                    </button>
                    <button onClick={w.handleSave} disabled={p.isSaving} className="btn btn-outline" style={{ fontSize: 'var(--text-sm)', display: 'flex', alignItems: 'center', gap: 4, padding: '4px 12px' }}>
                        {p.isSaving ? <Loader2 size={13} className="spin" /> : <Save size={13} />} Salvar
                    </button>
                </div>
            </div>

            {/* Blocos agrupados por seção */}
            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-5)' }}>
                {BLOCK_GROUPS.map(group => {
                    const groupBlocks = w.letterResult!.blocks.filter(b => b.visible && (group.ids as string[]).includes(b.id));
                    if (groupBlocks.length === 0) return null;

                    return (
                        <div key={group.label}>
                            {/* Group separator */}
                            <div style={{
                                fontSize: '0.7rem', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.06em',
                                color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-2)',
                                paddingBottom: 'var(--space-1)', borderBottom: '1px solid var(--color-border)',
                            }}>{group.label}</div>

                            <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                                {groupBlocks.map(block => {
                                    const meta = BLOCK_LABELS[block.id] || { icon: <File size={14} />, color: '#64748B' };
                                    const isEditing = w.editingBlockId === block.id;
                                    const isCollapsed = w.collapsedBlocks.has(block.id);
                                    const needsAttention = ATTENTION_BLOCKS.has(block.id);
                                    const isLongContent = (block.content || '').length > 300;

                                    return (
                                        <div key={block.id} style={{
                                            borderRadius: 'var(--radius-lg)',
                                            border: 'none',
                                            boxShadow: isEditing ? `0 0 0 2px ${meta.color}, 0 4px 12px rgba(0,0,0,0.05)`
                                                : needsAttention ? `0 0 0 1px ${meta.color}50, 0 2px 8px rgba(0,0,0,0.02)`
                                                : '0 0 0 1px var(--color-border), 0 1px 2px rgba(0,0,0,0.02)',
                                            overflow: 'hidden', transition: 'border-color 0.2s',
                                        }}>
                                            {/* Block header */}
                                            <div style={{
                                                display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                                padding: '6px var(--space-3)',
                                                background: needsAttention ? `${meta.color}06` : 'var(--color-bg-elevated)',
                                                borderBottom: isCollapsed ? 'none' : '1px solid var(--color-border)',
                                                cursor: 'pointer',
                                            }} onClick={() => {
                                                if (!isEditing) {
                                                    w.setCollapsedBlocks(prev => {
                                                        const next = new Set(prev);
                                                        next.has(block.id) ? next.delete(block.id) : next.add(block.id);
                                                        return next;
                                                    });
                                                }
                                            }}>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--text-sm)', fontWeight: 600 }}>
                                                    {isCollapsed ? <ChevronRight size={13} style={{ color: 'var(--color-text-tertiary)' }} /> : <ChevronDown size={13} style={{ color: 'var(--color-text-tertiary)' }} />}
                                                    <span style={{ color: meta.color }}>{meta.icon}</span>
                                                    <span style={{ color: meta.color }}>{block.label}</span>
                                                    {block.aiGenerated && (
                                                        <span style={{
                                                            fontSize: '0.6rem', padding: '1px 5px', borderRadius: '99px',
                                                            background: 'linear-gradient(135deg, rgba(168,85,247,0.12), rgba(59,130,246,0.12))',
                                                            color: 'var(--color-ai)', fontWeight: 700,
                                                        }}>IA</span>
                                                    )}
                                                    {needsAttention && !block.aiGenerated && (
                                                        <span style={{
                                                            fontSize: '0.6rem', padding: '1px 5px', borderRadius: '99px',
                                                            background: 'rgba(245,158,11,0.1)', color: '#D97706', fontWeight: 600,
                                                        }}>Conferir</span>
                                                    )}
                                                </div>
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={e => e.stopPropagation()}>
                                                    {block.editable ? (
                                                        isEditing ? (
                                                            <>
                                                                <button onClick={w.handleSaveEdit} style={{ fontSize: '0.7rem', padding: '2px 8px', background: 'var(--color-success)', color: 'white', border: 'none', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>Salvar</button>
                                                                <button onClick={w.handleCancelEdit} style={{ fontSize: '0.7rem', padding: '2px 8px', background: 'var(--color-bg-elevated)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)', borderRadius: 'var(--radius-md)', cursor: 'pointer' }}>Cancelar</button>
                                                            </>
                                                        ) : (
                                                            <button onClick={() => { w.handleStartEdit(block); w.setCollapsedBlocks(prev => { const n = new Set(prev); n.delete(block.id); return n; }); }} style={{
                                                                fontSize: '0.7rem', padding: '2px 8px', background: 'none',
                                                                border: 'none', boxShadow: '0 0 0 1px var(--color-border)', borderRadius: 'var(--radius-md)',
                                                                cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 4,
                                                                color: 'var(--color-text-secondary)',
                                                            }}>
                                                                <Unlock size={10} /> Editar
                                                            </button>
                                                        )
                                                    ) : (
                                                        <span style={{ fontSize: '0.6rem', color: 'var(--color-text-tertiary)', display: 'flex', alignItems: 'center', gap: 3 }}>
                                                            <Lock size={10} /> Fixo
                                                        </span>
                                                    )}
                                                </div>
                                            </div>

                                            {/* Block content — collapsible */}
                                            {!isCollapsed && (
                                                <div style={{ padding: 'var(--space-3) var(--space-4)' }}>
                                                    {isEditing ? (
                                                        <textarea value={w.editBuffer} onChange={e => w.setEditBuffer(e.target.value)}
                                                            style={{
                                                                width: '100%', minHeight: '120px', padding: 'var(--space-3)',
                                                                borderRadius: 'var(--radius-md)', border: `1px solid ${meta.color}40`,
                                                                fontSize: 'var(--text-sm)', lineHeight: 1.6, resize: 'vertical',
                                                                background: 'var(--color-bg-base)',
                                                            }}
                                                        />
                                                    ) : (
                                                        <div style={{
                                                            fontSize: block.type === LetterBlockType.TITLE ? '1.1rem' : 'var(--text-sm)',
                                                            lineHeight: 1.65,
                                                            color: 'var(--color-text-primary)', whiteSpace: 'pre-wrap',
                                                            maxHeight: isLongContent ? '250px' : 'none',
                                                            overflow: isLongContent ? 'auto' : 'visible',
                                                            fontWeight: block.type === LetterBlockType.TITLE ? 700 : 'normal',
                                                            textAlign: block.type === LetterBlockType.TITLE || block.type === LetterBlockType.SIGNATURE ? 'center' : 'left',
                                                            letterSpacing: block.type === LetterBlockType.TITLE ? '0.5px' : 'normal',
                                                        }}>
                                                            {block.content || <em style={{ color: 'var(--color-text-tertiary)' }}>Bloco vazio</em>}
                                                        </div>
                                                    )}
                                                </div>
                                            )}
                                        </div>
                                    );
                                })}
                            </div>
                        </div>
                    );
                })}
            </div>

            <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 'var(--space-5)' }}>
                <button onClick={() => w.setStep('config')} className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <ChevronLeft size={16} /> Configuração
                </button>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <button onClick={w.handleSave} disabled={p.isSaving} style={{
                        padding: 'var(--space-2) var(--space-5)', borderRadius: 'var(--radius-lg)',
                        background: 'var(--color-success)', color: 'white', border: 'none',
                        fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 6,
                        fontSize: 'var(--text-sm)', opacity: p.isSaving ? 0.6 : 1,
                    }}>
                        {p.isSaving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                        Salvar Carta
                    </button>
                    <button onClick={() => w.setStep('export')} style={{
                        padding: 'var(--space-2) var(--space-6)', borderRadius: 'var(--radius-lg)',
                        background: 'var(--color-primary)', color: 'white', border: 'none',
                        fontWeight: 700, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: 8,
                    }}>
                        Exportar <ChevronRight size={16} />
                    </button>
                </div>
            </div>
        </div>
    );
}
