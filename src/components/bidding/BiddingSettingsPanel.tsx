import { useState } from 'react';
import { Settings, SlidersHorizontal, Download, ChevronDown } from 'lucide-react';
import type { CompanyProfile } from '../../types';
import { COLUMNS } from '../../types';

// ════════════════════════════════════════
//  BiddingSettings — extracted from BiddingPage
//  Manages: column visibility, sort order, compact mode,
//  highlight expiring, default company, AI preferences
// ════════════════════════════════════════

interface CardFieldConfig {
    key: string;
    label: string;
    visible: boolean;
}

interface BiddingSettingsProps {
    companies: CompanyProfile[];
    // Card Config
    cardFields: CardFieldConfig[];
    setCardFields: (fields: CardFieldConfig[]) => void;
    showCardConfig: boolean;
    setShowCardConfig: (v: boolean) => void;
    // Settings Panel
    visibleColumns: string[];
    setVisibleColumns: (cols: string[]) => void;
    sortBy: string;
    setSortBy: (v: any) => void;
    compactMode: boolean;
    setCompactMode: (v: boolean) => void;
    highlightExpiring: boolean;
    setHighlightExpiring: (v: boolean) => void;
    defaultCompanyId: string;
    setDefaultCompanyId: (v: string) => void;
    // AI
    aiLanguage: string;
    setAiLanguage: (v: any) => void;
    aiFocus: string;
    setAiFocus: (v: any) => void;
    aiAutoAnalyze: boolean;
    setAiAutoAnalyze: (v: boolean) => void;
    // Export
    onExportCsv: () => void;
    onExportExcel: () => void;
    onExportPdf: () => void;
    // Coordination to close other panels
    onCloseOtherPanels: () => void;
}

function ToggleSwitch({ checked, onChange, color = 'var(--color-success)' }: { checked: boolean; onChange: () => void; color?: string }) {
    return (
        <div
            onClick={(e) => { e.preventDefault(); onChange(); }}
            style={{
                width: '32px', height: '18px', borderRadius: '999px',
                position: 'relative', cursor: 'pointer', transition: 'background 0.2s',
                background: checked ? color : 'var(--color-border)',
            }}
        >
            <div style={{
                position: 'absolute', top: '2px',
                left: checked ? '16px' : '2px',
                width: '14px', height: '14px', borderRadius: '50%',
                background: 'white', boxShadow: '0 1px 3px rgba(0,0,0,0.2)',
                transition: 'left 0.2s'
            }} />
        </div>
    );
}

function SettingRow({ label, children }: { label: string; children: React.ReactNode }) {
    return (
        <label className="row-hover" style={{
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            padding: '5px 4px', cursor: 'pointer', borderRadius: 'var(--radius-sm)',
            fontSize: 'var(--text-md)',
        }}>
            <span style={{ color: 'var(--color-text-primary)' }}>{label}</span>
            {children}
        </label>
    );
}

function SettingSectionTitle({ children }: { children: React.ReactNode }) {
    return <h4 className="section-label">{children}</h4>;
}

export function BiddingSettingsPanel(props: BiddingSettingsProps) {
    const [showSettingsPanel, setShowSettingsPanel] = useState(false);
    const [showExportMenu, setShowExportMenu] = useState(false);

    return (
        <>
            {/* Campos Button */}
            <div className="pos-relative">
                <button
                    className={`btn ${props.showCardConfig ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => { props.setShowCardConfig(!props.showCardConfig); props.onCloseOtherPanels(); }}
                >
                    <SlidersHorizontal size={14} /> Campos
                </button>
            </div>

            {/* Export Button */}
            <div className="pos-relative">
                <button
                    className={`btn ${showExportMenu ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => setShowExportMenu(!showExportMenu)}
                >
                    <Download size={14} /> Exportar
                    <ChevronDown size={12} style={{ marginLeft: 2, transform: showExportMenu ? 'rotate(180deg)' : 'none', transition: '0.2s' }} />
                </button>
                {showExportMenu && (
                    <div className="dropdown-menu" style={{
                        position: 'absolute', top: '40px', right: 0, width: '180px',
                        background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-xl)', zIndex: 100,
                        overflow: 'hidden'
                    }}>
                        <div style={{ padding: 'var(--space-1)' }}>
                            {[
                                { label: 'Arquivo CSV', onClick: () => { props.onExportCsv(); setShowExportMenu(false); } },
                                { label: 'Planilha Excel', onClick: () => { props.onExportExcel(); setShowExportMenu(false); } },
                                { label: 'Documento PDF', onClick: () => { props.onExportPdf(); setShowExportMenu(false); } },
                            ].map((item, i) => (
                                <button key={i} onClick={item.onClick} className="row-hover"
                                    style={{
                                        display: 'block', width: '100%', textAlign: 'left',
                                        padding: 'var(--space-2) var(--space-3)', background: 'transparent',
                                        color: 'var(--color-text-primary)', border: 'none',
                                        borderRadius: 'var(--radius-sm)', cursor: 'pointer',
                                        fontSize: 'var(--text-md)', fontWeight: 'var(--font-medium)',
                                    }}
                                >{item.label}</button>
                            ))}
                        </div>
                    </div>
                )}
            </div>

            {/* Settings Button */}
            <div className="pos-relative">
                <button
                    className={`btn ${showSettingsPanel ? 'btn-primary' : 'btn-outline'}`}
                    onClick={() => setShowSettingsPanel(!showSettingsPanel)}
                >
                    <Settings size={14} /> Configurar
                </button>
                {showSettingsPanel && (
                    <div style={{
                        position: 'absolute', top: '40px', right: 0, width: '340px',
                        background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)',
                        borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-xl)', zIndex: 100,
                        overflow: 'hidden',
                    }}>
                        <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                            <div style={{ fontWeight: 'var(--font-bold)', fontSize: 'var(--text-md)' }}>Configurações</div>
                            <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-secondary)', marginTop: '2px' }}>Personalize o painel de licitações</div>
                        </div>
                        <div style={{ maxHeight: '450px', overflowY: 'auto' }}>
                            {/* Colunas do Kanban */}
                            <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                                <SettingSectionTitle>Colunas do Kanban</SettingSectionTitle>
                                {(COLUMNS as string[]).map(col => (
                                    <SettingRow key={col} label={col}>
                                        <ToggleSwitch
                                            checked={props.visibleColumns.includes(col)}
                                            onChange={() => {
                                                if (props.visibleColumns.includes(col)) {
                                                    if (props.visibleColumns.length > 1) props.setVisibleColumns(props.visibleColumns.filter(c => c !== col));
                                                } else {
                                                    props.setVisibleColumns([...props.visibleColumns, col]);
                                                }
                                            }}
                                        />
                                    </SettingRow>
                                ))}
                                <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginTop: '6px', textAlign: 'center' }}>
                                    {props.visibleColumns.length} de {COLUMNS.length} visíveis
                                </div>
                            </div>

                            {/* Ordenação */}
                            <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                                <SettingSectionTitle>Ordenação dos Cards</SettingSectionTitle>
                                {[
                                    { value: 'default', label: 'Ordem manual (padrão)' },
                                    { value: 'date-asc', label: 'Sessão mais próxima primeiro' },
                                    { value: 'date-desc', label: 'Sessão mais distante primeiro' },
                                    { value: 'value-desc', label: 'Maior valor primeiro' },
                                    { value: 'value-asc', label: 'Menor valor primeiro' },
                                    { value: 'risk', label: 'Maior risco primeiro' },
                                ].map(opt => (
                                    <label key={opt.value} className="row-hover" style={{
                                        display: 'flex', alignItems: 'center', gap: '8px', padding: '6px 4px', cursor: 'pointer',
                                        borderRadius: 'var(--radius-sm)', fontSize: 'var(--text-md)',
                                        background: props.sortBy === opt.value ? 'var(--color-success-bg)' : 'transparent',
                                        color: props.sortBy === opt.value ? 'var(--color-success)' : 'var(--color-text-primary)',
                                        fontWeight: props.sortBy === opt.value ? 'var(--font-semibold)' : 'var(--font-normal)',
                                    }} onClick={() => props.setSortBy(opt.value)}>
                                        <div style={{
                                            width: '16px', height: '16px', borderRadius: '50%',
                                            border: `2px solid ${props.sortBy === opt.value ? 'var(--color-success)' : 'var(--color-border)'}`,
                                            display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0
                                        }}>
                                            {props.sortBy === opt.value && <div style={{ width: '8px', height: '8px', borderRadius: '50%', background: 'var(--color-success)' }} />}
                                        </div>
                                        {opt.label}
                                    </label>
                                ))}
                            </div>

                            {/* Aparência */}
                            <div className="settings-row" style={{ flexDirection: 'column', alignItems: 'stretch' }}>
                                <SettingSectionTitle>Aparência dos Cards</SettingSectionTitle>
                                <SettingRow label="Cards Compactos">
                                    <ToggleSwitch checked={props.compactMode} onChange={() => props.setCompactMode(!props.compactMode)} />
                                </SettingRow>
                                <SettingRow label="Destaque em Vencimentos Próximos">
                                    <ToggleSwitch checked={props.highlightExpiring} onChange={() => props.setHighlightExpiring(!props.highlightExpiring)} />
                                </SettingRow>
                            </div>

                            {/* Empresa Padrão */}
                            <div style={{ padding: '14px 16px' }}>
                                <SettingSectionTitle>Empresa Padrão</SettingSectionTitle>
                                <select className="config-input cursor-pointer" value={props.defaultCompanyId} onChange={(e) => props.setDefaultCompanyId(e.target.value)}>
                                    <option value="">Nenhuma (selecionar manualmente)</option>
                                    {props.companies.map(c => (<option key={c.id} value={c.id}>{c.razaoSocial}</option>))}
                                </select>
                            </div>

                            {/* Preferências IA */}
                            <div style={{ padding: '14px 16px', borderTop: '1px solid var(--color-border)' }}>
                                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '10px' }}>
                                    <SettingSectionTitle>Preferências da IA</SettingSectionTitle>
                                    <span className="badge badge-ai" style={{ fontSize: 'var(--text-xs)' }}>PREMIUM</span>
                                </div>
                                <div style={{ marginBottom: '12px' }}>
                                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: '4px' }}>Idioma do Relatório</div>
                                    <select className="config-input cursor-pointer" value={props.aiLanguage} onChange={(e: any) => props.setAiLanguage(e.target.value)}>
                                        <option value="pt-br">Português (BR)</option>
                                        <option value="en">Inglês</option>
                                        <option value="es">Espanhol</option>
                                    </select>
                                </div>
                                <div style={{ marginBottom: '12px' }}>
                                    <div style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)', marginBottom: '4px' }}>Foco de Análise</div>
                                    <select className="config-input cursor-pointer" value={props.aiFocus} onChange={(e: any) => props.setAiFocus(e.target.value)}>
                                        <option value="general">Geral (Padrão)</option>
                                        <option value="it">T.I e Software</option>
                                        <option value="engineering">Engenharia e Obras</option>
                                        <option value="services">Serviços Terceirizados</option>
                                        <option value="vehicles">Locação de Veículos e Máquinas Pesadas</option>
                                        <option value="transportation">Transporte Escolar</option>
                                        <option value="lighting">Iluminação Pública</option>
                                        <option value="food">Gêneros Alimentícios</option>
                                        <option value="events">Eventos e Estruturas</option>
                                        <option value="accounting">Serviços Contábeis e Auditoria</option>
                                        <option value="clothing">Fardamento e Confecção</option>
                                        <option value="consulting">Assessoria e Consultoria</option>
                                    </select>
                                </div>
                                <SettingRow label="">
                                    <div style={{ flex: 1 }}>
                                        <span style={{ color: 'var(--color-text-primary)', display: 'block' }}>Auto-Análise de PDF</span>
                                        <span style={{ fontSize: 'var(--text-xs)', color: 'var(--color-text-tertiary)' }}>Extrair dados ao fazer upload</span>
                                    </div>
                                    <ToggleSwitch checked={props.aiAutoAnalyze} onChange={() => props.setAiAutoAnalyze(!props.aiAutoAnalyze)} />
                                </SettingRow>
                            </div>
                        </div>
                    </div>
                )}
            </div>
        </>
    );
}
