import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { Calculator, Plus, Save, Trash2, Cpu, TableProperties, Download, Upload, Search, X, Loader2, Layers, BarChart3, Calendar, Package, FolderOpen, GitBranch, Wrench, ChevronDown, ChevronRight, Database, CheckCircle2, XCircle, AlertTriangle, AlertCircle, Split, GripVertical } from 'lucide-react';
import { DndContext, closestCenter, PointerSensor, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core';
import { SortableContext, verticalListSortingStrategy, useSortable, arrayMove } from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';
import { calculateBdiTCU, applyBdi, DEFAULT_BDI_CONFIG, TCU_REFERENCE_RANGES, type BdiConfig, type BdiTcuParams } from './bdiEngine';
import { CompositionDrawer } from './CompositionDrawer';
import { CompositionEditor } from './CompositionEditor';
import { CurvaAbcPanel } from './CurvaAbcPanel';
import { CronogramaPanel } from './CronogramaPanel';
import { InsumoHub } from './InsumoHub';
import { BudgetDocsPanel } from './BudgetDocsPanel';
import { applyPrecision } from './precisionEngine';
import type { EngItem, EngItemType, EngineeringConfig, BdiCategoria } from './types';
import { isGrouper, getDepth, DEFAULT_ENGINEERING_CONFIG } from './types';
import * as XLSX from 'xlsx';

// ── Renumeração hierárquica automática ──
function renumberItems(items: EngItem[]): EngItem[] {
    let etapaIdx = 0;
    let subetapaIdx = 0;
    let itemIdx = 0;
    let currentEtapa = 0;
    let currentSubetapa = 0;

    return items.map(it => {
        if (it.type === 'ETAPA') {
            etapaIdx++;
            subetapaIdx = 0;
            itemIdx = 0;
            currentEtapa = etapaIdx;
            currentSubetapa = 0;
            return { ...it, itemNumber: `${etapaIdx}.0` };
        }
        if (it.type === 'SUBETAPA') {
            subetapaIdx++;
            itemIdx = 0;
            currentSubetapa = subetapaIdx;
            return { ...it, itemNumber: `${currentEtapa || 1}.${subetapaIdx}` };
        }
        // COMPOSICAO / INSUMO
        itemIdx++;
        if (currentSubetapa > 0) {
            return { ...it, itemNumber: `${currentEtapa || 1}.${currentSubetapa}.${itemIdx}` };
        }
        if (currentEtapa > 0) {
            return { ...it, itemNumber: `${currentEtapa}.${itemIdx}` };
        }
        return { ...it, itemNumber: String(itemIdx) };
    });
}

const TYPE_META: Record<EngItemType, { label: string; color: string; bg: string; icon: typeof FolderOpen }> = {
    ETAPA:      { label: 'Etapa',       color: '#1e40af', bg: 'rgba(30,64,175,0.08)',  icon: FolderOpen },
    SUBETAPA:   { label: 'Subetapa',    color: '#6d28d9', bg: 'rgba(109,40,217,0.06)', icon: GitBranch },
    COMPOSICAO: { label: 'Composição',  color: '#0e7490', bg: 'rgba(14,116,144,0.06)', icon: Layers },
    INSUMO:     { label: 'Insumo',      color: '#b45309', bg: 'rgba(180,83,9,0.06)',   icon: Package },
};

interface Props { proposalId: string; biddingId: string; }

const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
const token = () => localStorage.getItem('token') || '';
const hdrs = () => ({ 'Authorization': `Bearer ${token()}`, 'Content-Type': 'application/json' });

export function EngineeringProposalEditor({ proposalId, biddingId }: Props) {
    const [items, setItems] = useState<EngItem[]>([]);
    const [bdiConfig, setBdiConfig] = useState<BdiConfig>({ ...DEFAULT_BDI_CONFIG });
    const [engineeringConfig, setEngineeringConfig] = useState<EngineeringConfig>({ ...DEFAULT_ENGINEERING_CONFIG });
    const [isSaving, setIsSaving] = useState(false);
    const [isExtracting, setIsExtracting] = useState(false);
    const [saveMsg, setSaveMsg] = useState<React.ReactNode | null>(null);

    // Search modal
    const [showSearch, setShowSearch] = useState(false);
    const [bases, setBases] = useState<any[]>([]);
    const [selectedBaseId, setSelectedBaseId] = useState('');
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<any[]>([]);
    const [isSearching, setIsSearching] = useState(false);

    // Composition drawer
    const [compositionItem, setCompositionItem] = useState<EngItem | null>(null);
    const [compositionEditorIndex, setCompositionEditorIndex] = useState<number | null>(null);

    const [expandedItems, setExpandedItems] = useState<Set<string>>(new Set());

    const toggleExpand = (id: string) => {
        setExpandedItems(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    // Active tab
    const [activeTab, setActiveTab] = useState<'planilha' | 'balizamento' | 'hub_insumos' | 'curva_abc' | 'cronograma' | 'caderno'>('planilha');

    // FIX ARQ-04: Cronograma data persisted in parent state to survive tab switches
    const [cronogramaData, setCronogramaData] = useState<{ meses: number; etapas: any[] } | null>(null);
    const [hasUnsavedChanges, setHasUnsavedChanges] = useState(false);

    const effectiveBdi = bdiConfig.mode === 'TCU' ? calculateBdiTCU(bdiConfig.tcu) : bdiConfig.bdiGlobal;
    
    /** Resolve o BDI efetivo para um item (suporte a BDI diferenciado OBRA vs FORNECIMENTO) */
    const resolveItemBdi = useCallback((it: EngItem) => {
        if (!engineeringConfig.bdiDiferenciado) return effectiveBdi;
        if (it.bdiCategoria === 'FORNECIMENTO') return engineeringConfig.bdiFornecimento || 14.02;
        return effectiveBdi; // Default = OBRA
    }, [effectiveBdi, engineeringConfig.bdiDiferenciado, engineeringConfig.bdiFornecimento]);

    // FIX BUG-01: Filtra agrupadores (ETAPA/SUBETAPA) do cálculo de totais
    const billableItems = items.filter(it => !isGrouper(it.type));
    const subtotal = billableItems.reduce((s, it) => s + it.quantity * it.unitCost, 0);
    const total = billableItems.reduce((s, it) => s + it.totalPrice, 0);

    const recalcAll = useCallback((its: EngItem[], _bdi: number, config: EngineeringConfig) => {
        return its.map(it => {
            if (isGrouper(it.type)) return it;
            // BDI diferenciado: FORNECIMENTO usa bdiFornecimento, OBRA usa BDI global
            const itemBdi = config.bdiDiferenciado && it.bdiCategoria === 'FORNECIMENTO'
                ? (config.bdiFornecimento || 14.02)
                : _bdi;
            const up = applyBdi(it.unitCost, itemBdi, config.precision);
            return { ...it, unitPrice: up, totalPrice: applyPrecision(it.quantity * up, config) };
        });
    }, []);

    useEffect(() => { setItems(prev => recalcAll(prev, effectiveBdi, engineeringConfig)); }, [effectiveBdi, engineeringConfig, recalcAll]);

    // Ref para input de importação Excel oculto
    const fileInputRef = useRef<HTMLInputElement>(null);

    // Load items on mount
    useEffect(() => {
        fetch(`/api/engineering/proposals/${proposalId}/items`, { headers: hdrs() })
            .then(r => r.json()).then(data => {
                if (Array.isArray(data)) {
                    // Fallback for old data structure
                    if (data.length > 0) setItems(data);
                } else if (data && data.items) {
                    setItems(data.items);
                    if (data.bdiConfig) setBdiConfig(data.bdiConfig);
                    if (data.engineeringConfig) {
                        // FIX ARQ-04: Restore cronograma data from saved config
                        const { cronogramaData: savedCronograma, ...engConfig } = data.engineeringConfig;
                        setEngineeringConfig(engConfig);
                        if (savedCronograma) setCronogramaData(savedCronograma);
                    }
                }
            }).catch(console.error);

        fetch('/api/engineering/bases', { headers: hdrs() })
            .then(r => r.json()).then(data => {
                if (Array.isArray(data)) { setBases(data); if (data.length > 0) setSelectedBaseId(data[0].id); }
            }).catch(console.error);
    }, [proposalId]);

    // Save all items
    const handleSave = async () => {
        setIsSaving(true); setSaveMsg(null);
        try {
            const res = await fetch(`/api/engineering/proposals/${proposalId}/items`, {
                method: 'POST', headers: hdrs(),
                body: JSON.stringify({ items, bdiConfig, engineeringConfig, cronogramaData })
            });
            if (res.ok) {
                const d = await res.json();
                setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)' }}><CheckCircle2 size={14} /> {d.message}</span>);
                setHasUnsavedChanges(false);
            }
            else { setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}><XCircle size={14} /> Erro ao salvar</span>); }
        } catch { setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}><XCircle size={14} /> Erro de rede</span>); }
        finally { setIsSaving(false); setTimeout(() => setSaveMsg(null), 4000); }
    };

    // Warn on page leave with unsaved changes
    useEffect(() => {
        const handler = (e: BeforeUnloadEvent) => { if (hasUnsavedChanges) { e.preventDefault(); } };
        window.addEventListener('beforeunload', handler);
        return () => window.removeEventListener('beforeunload', handler);
    }, [hasUnsavedChanges]);

    // AI extraction
    const handleExtractAI = async () => {
        setIsExtracting(true);
        try {
            const res = await fetch('/api/engineering/ai-populate', {
                method: 'POST', headers: hdrs(), body: JSON.stringify({ biddingId, engineeringConfig })
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Erro');
            const data = await res.json();
            if (data.items?.length > 0) {
                const mapped = data.items.map((ai: any, i: number) => {
                    const aiType: EngItemType = (['ETAPA','SUBETAPA','COMPOSICAO','INSUMO'].includes(ai.type)) ? ai.type : 'COMPOSICAO';
                    const isGroup = isGrouper(aiType);
                    const cost = isGroup ? 0 : (Number(ai.unitCost) || 0);
                    const qty = isGroup ? 0 : (Number(ai.quantity) || 1);
                    
                    const extractedSource = ai.sourceName || '';
                    const isKnownSource = bases.some(b => b.name.toUpperCase() === extractedSource.toUpperCase());
                    const finalSource = isGroup ? '' : (isKnownSource ? extractedSource : 'PROPRIA');

                    return {
                        id: `ai-${Date.now()}-${i}`, itemNumber: ai.item || String(items.length + i + 1),
                        code: ai.code || (isGroup ? '' : 'N/A'), sourceName: finalSource,
                        description: ai.description || '', unit: isGroup ? '' : (ai.unit || 'UN'),
                        quantity: qty, unitCost: cost, type: aiType,
                        unitPrice: isGroup ? 0 : applyBdi(cost, effectiveBdi, engineeringConfig.precision),
                        totalPrice: isGroup ? 0 : applyPrecision(qty * applyBdi(cost, effectiveBdi, engineeringConfig.precision), { precision: engineeringConfig.precision }),
                        insumos: Array.isArray(ai.insumos) ? ai.insumos : undefined,
                    };
                });
                setItems(prev => [...prev, ...mapped]);
                setHasUnsavedChanges(true);
                const etapas = mapped.filter((m: EngItem) => m.type === 'ETAPA').length;
                const subs = mapped.filter((m: EngItem) => m.type === 'SUBETAPA').length;
                const comps = mapped.filter((m: EngItem) => m.type === 'COMPOSICAO').length;
                const insumos = mapped.filter((m: EngItem) => m.type === 'INSUMO').length;
                const ownWithInsumos = mapped.filter((m: EngItem) => m.insumos && m.insumos.length > 0).length;
                setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)' }}><CheckCircle2 size={14} /> {mapped.length} itens: {etapas} etapas, {subs} subetapas, {comps} composições, {insumos} insumos{ownWithInsumos > 0 ? ` (${ownWithInsumos} com detalhamento)` : ''}</span>);
            } else { setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#d97706' }}><AlertTriangle size={14} /> IA não encontrou itens orçamentários</span>); }
        } catch (e: any) { setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}><XCircle size={14} /> {e.message}</span>); }
        finally { setIsExtracting(false); setTimeout(() => setSaveMsg(null), 8000); }
    };

    // AI composition extraction
    const [isExtractingComps, setIsExtractingComps] = useState(false);
    const handleExtractCompositions = async () => {
        setIsExtractingComps(true);
        setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-primary)' }}><Loader2 size={14} className="spin" /> Extraindo composições do projeto básico via IA...</span>);
        try {
            const res = await fetch('/api/engineering/ai-extract-compositions', {
                method: 'POST', headers: hdrs(), body: JSON.stringify({ biddingId, engineeringConfig })
            });
            if (!res.ok) throw new Error((await res.json().catch(() => ({}))).error || 'Erro');
            const data = await res.json();
            setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)' }}><CheckCircle2 size={14} /> {data.saved || 0} composições extraídas e salvas na base PRÓPRIA</span>);
        } catch (e: any) { setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}><XCircle size={14} /> {e.message}</span>); }
        finally { setIsExtractingComps(false); setTimeout(() => setSaveMsg(null), 8000); }
    };

    // Inline edit
    const updateItem = (id: string, field: keyof EngItem, value: any) => {
        setHasUnsavedChanges(true);
        setItems(prev => prev.map(it => {
            if (it.id !== id) return it;
            const updated = { ...it, [field]: value };
            if (field === 'unitCost' || field === 'quantity' || field === 'bdiCategoria') {
                const itemBdi = resolveItemBdi(updated);
                updated.unitPrice = applyBdi(updated.unitCost, itemBdi, engineeringConfig.precision);
                updated.totalPrice = applyPrecision(updated.quantity * updated.unitPrice, { precision: engineeringConfig?.precision });
            }
            return updated;
        }));
    };

    const removeItem = (id: string) => { setHasUnsavedChanges(true); setItems(prev => renumberItems(prev.filter(it => it.id !== id))); };

    const addTypedItem = (type: EngItemType) => {
        const isGroup = isGrouper(type);
        setHasUnsavedChanges(true);
        setItems(prev => renumberItems([...prev, {
            id: `new-${Date.now()}`, itemNumber: '', code: isGroup ? '' : '', sourceName: isGroup ? '' : 'PROPRIA',
            description: '', unit: isGroup ? '' : 'UN', quantity: isGroup ? 0 : 1,
            unitCost: 0, unitPrice: 0, totalPrice: 0, type,
        }]));
    };

    const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 5 } }));
    const handleDragEnd = (event: DragEndEvent) => {
        const { active, over } = event;
        if (over && active.id !== over.id) {
            setItems(prev => {
                const oldIndex = prev.findIndex(item => item.id === active.id);
                const newIndex = prev.findIndex(item => item.id === over.id);
                setHasUnsavedChanges(true);
                return renumberItems(arrayMove(prev, oldIndex, newIndex));
            });
        }
    };

    // Search
    const handleSearch = async () => {
        if (!selectedBaseId || !searchQuery) return;
        setIsSearching(true);
        try {
            const params = new URLSearchParams({ q: searchQuery });
            if (engineeringConfig?.regimeOneracao) params.append('regime', engineeringConfig.regimeOneracao);
            if (engineeringConfig?.dataBase) params.append('dataBase', engineeringConfig.dataBase);
            const res = await fetch(`/api/engineering/bases/${selectedBaseId}/items?${params.toString()}`, { headers: hdrs() });
            const data = await res.json();
            setSearchResults(data.items || []);
        } catch { } finally { setIsSearching(false); }
    };

    const [insertType, setInsertType] = useState<'COMPOSICAO' | 'INSUMO'>('COMPOSICAO');

    const addFromSearch = (dbItem: any) => {
        const base = bases.find(b => b.id === selectedBaseId);
        const cost = Number(dbItem.price) || 0;
        const unitPrice = applyBdi(cost, effectiveBdi, engineeringConfig.precision);
        setItems(prev => [...prev, {
            id: `db-${Date.now()}`, itemNumber: String(prev.length + 1),
            code: dbItem.code, sourceName: base?.name || 'OFICIAL',
            description: dbItem.description, unit: dbItem.unit, quantity: 1,
            unitCost: cost, unitPrice,
            // FIX BUG-02: totalPrice = qty × unitPrice (was missing qty multiplication)
            totalPrice: applyPrecision(1 * unitPrice, { precision: engineeringConfig.precision }), type: insertType,
        }]);
        setShowSearch(false); setSearchQuery(''); setSearchResults([]);
    };

    // BDI helpers
    const updateTcu = (field: keyof BdiTcuParams, val: number) => {
        setBdiConfig(prev => ({ ...prev, tcu: { ...prev.tcu, [field]: val } }));
    };

    // ═══════════════════════════════════════════════════════
    // IMPORTAÇÃO EXCEL (.xlsx)
    // ═══════════════════════════════════════════════════════
    const handleImportExcel = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file) return;

        const reader = new FileReader();
        reader.onload = (evt) => {
            try {
                const data = new Uint8Array(evt.target?.result as ArrayBuffer);
                const workbook = XLSX.read(data, { type: 'array' });
                const sheetName = workbook.SheetNames[0];
                const sheet = workbook.Sheets[sheetName];
                const rows: any[][] = XLSX.utils.sheet_to_json(sheet, { header: 1, defval: '' });

                if (rows.length < 2) {
                    setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}><XCircle size={14} /> Planilha vazia ou sem dados</span>);
                    return;
                }

                // Auto-detectar colunas pelo header
                const header = rows[0].map((h: any) => String(h).toUpperCase().trim());
                const findCol = (...aliases: string[]) => header.findIndex(h => aliases.some(a => h.includes(a)));

                const colItem = findCol('ITEM', 'N°', 'NUM', 'NÚMERO');
                const colDesc = findCol('DESCRI', 'SERVIÇO', 'SERVICO', 'ESPECIFICA');
                const colUn = findCol('UNID', 'UN.');
                const colQtd = findCol('QUANT', 'QTD');
                const colCusto = findCol('CUSTO', 'PREÇO UNIT', 'PRECO UNIT', 'VL UNIT', 'P.U.', 'VALOR UNIT');
                const colTotal = findCol('TOTAL', 'VALOR TOTAL', 'PREÇO TOTAL', 'PRECO TOTAL');
                const colCodigo = findCol('CÓDIGO', 'CODIGO', 'CÓD', 'REF');
                const colBase = findCol('BASE', 'FONTE', 'REFER');

                if (colDesc < 0) {
                    setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}><XCircle size={14} /> Coluna "Descrição" não encontrada no header</span>);
                    return;
                }

                const imported: EngItem[] = [];
                for (let r = 1; r < rows.length; r++) {
                    const row = rows[r];
                    if (!row || row.every((c: any) => !c && c !== 0)) continue; // skip empty rows

                    const desc = String(row[colDesc] ?? '').trim();
                    if (!desc) continue;

                    const itemNum = colItem >= 0 ? String(row[colItem] ?? '').trim() : String(imported.length + 1);
                    const unit = colUn >= 0 ? String(row[colUn] ?? '').trim() : '';
                    const qty = colQtd >= 0 ? Number(row[colQtd]) || 0 : 0;
                    const cost = colCusto >= 0 ? Number(row[colCusto]) || 0 : 0;
                    const code = colCodigo >= 0 ? String(row[colCodigo] ?? '').trim() : '';
                    const base = colBase >= 0 ? String(row[colBase] ?? '').trim() : '';

                    // Detecção de tipo: item sem preço e sem unidade = agrupador
                    let type: EngItemType = 'COMPOSICAO';
                    const depth = (itemNum.match(/\./g) || []).length;
                    if (cost === 0 && qty === 0 && !unit) {
                        type = depth === 0 ? 'ETAPA' : 'SUBETAPA';
                    } else if (code && code.length < 6 && !base) {
                        type = 'INSUMO';
                    }

                    const isGroup = isGrouper(type);
                    const up = isGroup ? 0 : applyBdi(cost, effectiveBdi, engineeringConfig.precision);

                    imported.push({
                        id: `xls-${Date.now()}-${r}`,
                        itemNumber: itemNum || String(imported.length + 1),
                        code: isGroup ? '' : (code || 'N/A'),
                        sourceName: isGroup ? '' : (base || 'PROPRIA'),
                        description: desc,
                        unit: isGroup ? '' : (unit || 'UN'),
                        quantity: isGroup ? 0 : qty,
                        unitCost: isGroup ? 0 : cost,
                        unitPrice: up,
                        totalPrice: isGroup ? 0 : applyPrecision(qty * up, engineeringConfig),
                        type,
                    });
                }

                if (imported.length === 0) {
                    setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: '#d97706' }}><AlertTriangle size={14} /> Nenhum item válido encontrado na planilha</span>);
                    return;
                }

                setItems(prev => [...prev, ...imported]);
                const etapas = imported.filter(i => i.type === 'ETAPA').length;
                const comps = imported.filter(i => i.type === 'COMPOSICAO').length;
                setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-success)' }}><CheckCircle2 size={14} /> {imported.length} itens importados do Excel ({etapas} etapas, {comps} composições)</span>);
            } catch (err: any) {
                console.error('Erro ao importar Excel:', err);
                setSaveMsg(<span style={{ display: 'flex', alignItems: 'center', gap: 6, color: 'var(--color-danger)' }}><XCircle size={14} /> Erro ao ler arquivo: {err.message}</span>);
            }
            // Reset input
            if (fileInputRef.current) fileInputRef.current.value = '';
        };
        reader.readAsArrayBuffer(file);
    };

    // Excel Export — native .xlsx via SheetJS
    const handleExportExcel = () => {
        const wb = XLSX.utils.book_new();

        // 1. Cabeçalho com configurações mestre
        const configRows = [
            ['PLANILHA ORÇAMENTÁRIA DE OBRAS E SERVIÇOS DE ENGENHARIA'],
            [''],
            ['Obra/Objeto', engineeringConfig?.objeto || 'Não informado'],
            ['Bancos Considerados', (engineeringConfig?.basesConsideradas || []).join(', ') || 'Não informado'],
            ['Data Base', engineeringConfig?.dataBase || 'Não informado'],
            ['Regime', engineeringConfig?.regimeOneracao || 'DESONERADO'],
            ['BDI (' + bdiConfig.mode + ')', effectiveBdi.toFixed(2) + '%'],
            ['Encargos Sociais Horista', (engineeringConfig?.encargosSociais?.horista || 0) + '%'],
            ['Encargos Sociais Mensalista', (engineeringConfig?.encargosSociais?.mensalista || 0) + '%'],
            ...(engineeringConfig.bdiDiferenciado ? [['BDI Fornecimento', (engineeringConfig.bdiFornecimento || 14.02).toFixed(2) + '%']] : []),
            [''],
        ];

        // 2. Header da tabela
        const tableHeader = engineeringConfig.bdiDiferenciado
            ? ['Item', 'Tipo', 'BDI Cat.', 'Base', 'Código', 'Descrição', 'Unidade', 'Quantidade', 'Custo Unit. (S/ BDI)', 'Preço Unit. (C/ BDI)', 'Total (C/ BDI)']
            : ['Item', 'Tipo', 'Base', 'Código', 'Descrição', 'Unidade', 'Quantidade', 'Custo Unit. (S/ BDI)', 'Preço Unit. (C/ BDI)', 'Total (C/ BDI)'];

        // 3. Dados dos itens
        const dataRows = items.map(it => {
            const base = engineeringConfig.bdiDiferenciado
                ? [it.itemNumber, it.type, it.bdiCategoria || 'OBRA', it.sourceName, it.code, it.description, it.unit]
                : [it.itemNumber, it.type, it.sourceName, it.code, it.description, it.unit];
            return [...base, it.quantity, it.unitCost, it.unitPrice, it.totalPrice];
        });

        // 4. Totais
        const emptyCol = engineeringConfig.bdiDiferenciado ? 9 : 8;
        const footerRows = [
            [],
            [...Array(emptyCol - 1).fill(''), 'Subtotal (S/ BDI)', '', billableItems.reduce((s, i) => s + i.quantity * i.unitCost, 0)],
            [...Array(emptyCol - 1).fill(''), `BDI (${bdiConfig.mode})`, effectiveBdi.toFixed(2) + '%', ''],
            [...Array(emptyCol - 1).fill(''), 'TOTAL GLOBAL', '', billableItems.reduce((s, i) => s + i.totalPrice, 0)],
        ];

        const allRows = [...configRows, tableHeader, ...dataRows, ...footerRows];
        const ws = XLSX.utils.aoa_to_sheet(allRows);

        // Auto-width
        const colWidths = tableHeader.map((h, i) => {
            let max = String(h).length;
            for (const row of dataRows) {
                const v = String(row[i] ?? '');
                if (v.length > max) max = v.length;
            }
            return { wch: Math.min(max + 2, 60) };
        });
        ws['!cols'] = colWidths;

        XLSX.utils.book_append_sheet(wb, ws, 'Orçamento');
        XLSX.writeFile(wb, `planilha_orcamentaria_${new Date().toISOString().slice(0, 10)}.xlsx`);
    };

    const inputStyle = (w: string = '100%'): React.CSSProperties => ({
        width: w, padding: '4px 8px', fontSize: '0.8rem', border: '1px solid var(--color-border)',
        borderRadius: 'var(--radius-sm)', background: 'var(--color-bg-base)', height: 30,
    });

    return (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)', marginTop: 'var(--space-2)' }}>

            {/* Action Bar */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: 'var(--space-4)', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-3)' }}>
                    <div style={{ background: 'var(--color-primary-light)', padding: 8, borderRadius: 'var(--radius-md)' }}>
                        <TableProperties size={18} color="var(--color-primary)" />
                    </div>
                    <div>
                        <h3 style={{ margin: 0, fontSize: 'var(--text-md)', fontWeight: 700 }}>Planilha Orçamentária de Engenharia</h3>
                        <span style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)' }}>
                            {items.length} itens · BDI {effectiveBdi.toFixed(2)}% ({bdiConfig.mode})
                        </span>
                    </div>
                </div>
                <div style={{ display: 'flex', gap: 'var(--space-2)', alignItems: 'center' }}>
                    {saveMsg && <span style={{ fontSize: '0.8rem', fontWeight: 600 }}>{saveMsg}</span>}
                    <button className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 6 }}
                        onClick={() => items.length > 0 && setCompositionEditorIndex(0)}
                        disabled={items.length === 0}>
                        <Layers size={14} color="var(--color-primary)" /> Editar Composições
                    </button>
                    <button className={`btn ${activeTab === 'planilha' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab('planilha')}>
                        <TableProperties size={15} /> Planilha Orçamentária
                    </button>
                    <button className={`btn ${activeTab === 'balizamento' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab('balizamento')}>
                        <Wrench size={15} /> Balizamento Mestre
                    </button>
                    <button className={`btn ${activeTab === 'hub_insumos' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setActiveTab('hub_insumos')}>
                        <Package size={15} /> Insumos & CPU
                    </button>
                    <button className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={handleExtractAI} disabled={isExtracting}>
                        {isExtracting ? <Loader2 size={14} className="spin" /> : <Cpu size={14} color="var(--color-ai)" />}
                        {isExtracting ? 'Extraindo...' : 'Extrair Itens IA'}
                    </button>
                    <button className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={handleExtractCompositions} disabled={isExtractingComps}>
                        {isExtractingComps ? <Loader2 size={14} className="spin" /> : <Layers size={14} color="var(--color-ai)" />}
                        {isExtractingComps ? 'Extraindo CPUs...' : 'Extrair Composições IA'}
                    </button>
                    {/* Importar Excel */}
                    <input ref={fileInputRef} type="file" accept=".xlsx,.xls,.ods,.csv" style={{ display: 'none' }} onChange={handleImportExcel} />
                    <button className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={() => fileInputRef.current?.click()}>
                        <Upload size={14} color="#059669" /> Importar Excel
                    </button>
                    <button className="btn btn-outline" style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={handleExportExcel}>
                        <Download size={14} /> Exportar Excel
                    </button>
                    <button className="btn btn-primary" style={{ display: 'flex', alignItems: 'center', gap: 6, position: 'relative' }} onClick={handleSave} disabled={isSaving}>
                        {isSaving ? <Loader2 size={14} className="spin" /> : <Save size={14} />}
                        {isSaving ? 'Salvando...' : 'Salvar Planilha'}
                        {hasUnsavedChanges && !isSaving && (
                            <span style={{ position: 'absolute', top: -3, right: -3, width: 8, height: 8, borderRadius: '50%', background: '#f59e0b', border: '2px solid var(--color-bg-surface)', animation: 'pulse 2s infinite' }} title="Alterações não salvas" />
                        )}
                    </button>
                </div>
            </div>

            {/* Tab Bar */}
            <div style={{ display: 'flex', gap: 4, background: 'var(--color-bg-base)', padding: 4, borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)' }}>
                {[
                    { key: 'planilha' as const, label: 'Planilha Orçamentária', icon: TableProperties },
                    { key: 'hub_insumos' as const, label: 'Hub de Insumos', icon: Package },
                    { key: 'curva_abc' as const, label: 'Curva ABC', icon: BarChart3 },
                    { key: 'cronograma' as const, label: 'Cronograma', icon: Calendar },
                    { key: 'caderno' as const, label: 'Caderno de Orçamento', icon: Download },
                ].map(tab => (
                    <button key={tab.key} onClick={() => setActiveTab(tab.key)} style={{
                        flex: 1, padding: '8px 16px', borderRadius: 'var(--radius-sm)', border: 'none', cursor: 'pointer',
                        background: activeTab === tab.key ? 'var(--color-bg-surface)' : 'transparent',
                        boxShadow: activeTab === tab.key ? '0 1px 3px rgba(0,0,0,0.08)' : 'none',
                        color: activeTab === tab.key ? 'var(--color-primary)' : 'var(--color-text-tertiary)',
                        fontWeight: activeTab === tab.key ? 700 : 500, fontSize: '0.85rem',
                        display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 6,
                    }}>
                        <tab.icon size={15} /> {tab.label}
                    </button>
                ))}
            </div>

            {/* Tab Content: Hub de Insumos */}
            {activeTab === 'hub_insumos' && (
                <InsumoHub proposalId={proposalId} clientItems={items} engineeringConfig={engineeringConfig} />
            )}

            {/* Tab Content: Curva ABC */}
            {activeTab === 'curva_abc' && (
                <CurvaAbcPanel items={items} />
            )}

            {/* Tab Content: Cronograma */}
            {activeTab === 'cronograma' && (
                <CronogramaPanel
                    items={items}
                    savedData={cronogramaData}
                    onDataChange={setCronogramaData}
                />
            )}

            {/* Tab Content: Caderno de Orçamento */}
            {activeTab === 'balizamento' && (
                <div style={{ padding: 24 }}>
                    <div style={{ background: 'var(--color-bg-surface)', padding: 24, borderRadius: 12, border: '1px solid var(--color-border)', maxWidth: 800 }}>
                        <h2 style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '1.2rem', marginBottom: 24, color: 'var(--color-primary)' }}>
                            <Wrench size={24} /> Configuração Mestre de Orçamento
                        </h2>
                        
                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', fontWeight: 600 }}>Objeto / Descrição</label>
                                <textarea className="form-input" rows={3} value={engineeringConfig.objeto} onChange={e => setEngineeringConfig({...engineeringConfig, objeto: e.target.value})} placeholder="Descrição do orçamento..." style={{ width: '100%', resize: 'none' }} />
                            </div>
                            
                            <div>
                                <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', fontWeight: 600 }}>Bases Consideradas</label>
                                <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                                    {['SINAPI', 'SEINFRA', 'ORSE', 'SICRO', 'SBC', 'PROPRIA'].map(base => (
                                        <label key={base} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.8rem', background: 'var(--color-bg-base)', padding: '4px 8px', borderRadius: 4, border: '1px solid var(--color-border)' }}>
                                            <input type="checkbox" checked={engineeringConfig.basesConsideradas.includes(base)} onChange={e => {
                                                const b = engineeringConfig.basesConsideradas;
                                                setEngineeringConfig({ ...engineeringConfig, basesConsideradas: e.target.checked ? [...b, base] : b.filter((x: string) => x !== base) })
                                            }} />
                                            {base}
                                        </label>
                                    ))}
                                </div>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
                            <div>
                                <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', fontWeight: 600 }}>Data Base Principal</label>
                                <input type="month" className="form-input" value={engineeringConfig.dataBase} onChange={e => setEngineeringConfig({...engineeringConfig, dataBase: e.target.value})} style={{ width: '100%' }} />
                            </div>
                            
                            <div>
                                <label style={{ display: 'block', marginBottom: 8, fontSize: '0.85rem', fontWeight: 600 }}>Regime de Oneração</label>
                                <select className="form-select" value={engineeringConfig.regimeOneracao} onChange={e => setEngineeringConfig({...engineeringConfig, regimeOneracao: e.target.value as 'DESONERADO' | 'ONERADO'})} style={{ width: '100%' }}>
                                    <option value="DESONERADO">Desonerado (Padrão)</option>
                                    <option value="ONERADO">Onerado</option>
                                </select>
                            </div>
                        </div>

                        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 24, marginBottom: 24 }}>
                            <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 16 }}>
                                <h4 style={{ margin: '0 0 16px 0', fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>Encargos Sociais</h4>
                                <div style={{ display: 'flex', gap: 16 }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: 'block', marginBottom: 4, fontSize: '0.8rem' }}>Horista (%)</label>
                                        <input type="number" step="0.1" className="form-input" value={engineeringConfig.encargosSociais.horista} onChange={e => setEngineeringConfig({...engineeringConfig, encargosSociais: {...engineeringConfig.encargosSociais, horista: Number(e.target.value)}})} style={{ width: '100%' }} />
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: 'block', marginBottom: 4, fontSize: '0.8rem' }}>Mensalista (%)</label>
                                        <input type="number" step="0.1" className="form-input" value={engineeringConfig.encargosSociais.mensalista} onChange={e => setEngineeringConfig({...engineeringConfig, encargosSociais: {...engineeringConfig.encargosSociais, mensalista: Number(e.target.value)}})} style={{ width: '100%' }} />
                                    </div>
                                </div>
                            </div>
                            
                            <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 16 }}>
                                <h4 style={{ margin: '0 0 16px 0', fontSize: '0.9rem', color: 'var(--color-text-secondary)' }}>Política de Arredondamento</h4>
                                <div style={{ display: 'flex', gap: 16 }}>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: 'block', marginBottom: 4, fontSize: '0.8rem' }}>Cálculo Multiplicação</label>
                                        <select className="form-select" value={engineeringConfig.precision.tipo} onChange={e => setEngineeringConfig({...engineeringConfig, precision: {...engineeringConfig.precision, tipo: e.target.value as 'ROUND' | 'TRUNCATE'}})} style={{ width: '100%' }}>
                                            <option value="ROUND">Arredondar</option>
                                            <option value="TRUNCATE">Truncar</option>
                                        </select>
                                    </div>
                                    <div style={{ flex: 1 }}>
                                        <label style={{ display: 'block', marginBottom: 4, fontSize: '0.8rem' }}>Casas Decimais</label>
                                        <input type="number" min="2" max="4" className="form-input" value={engineeringConfig.precision.casasDecimais} onChange={e => setEngineeringConfig({...engineeringConfig, precision: {...engineeringConfig.precision, casasDecimais: Number(e.target.value)}})} style={{ width: '100%' }} />
                                    </div>
                                </div>
                            </div>
                        </div>

                        {/* BDI Diferenciado — Acórdão TCU 2622/2013 */}
                        <div style={{ border: '1px solid var(--color-border)', borderRadius: 8, padding: 16, marginBottom: 24, background: engineeringConfig.bdiDiferenciado ? 'rgba(37,99,235,0.02)' : 'transparent' }}>
                            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                                    <Split size={18} color="var(--color-primary)" />
                                    <h4 style={{ margin: 0, fontSize: '0.9rem', color: 'var(--color-primary)' }}>BDI Diferenciado</h4>
                                </div>
                                <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem', cursor: 'pointer' }}>
                                    <input type="checkbox" checked={!!engineeringConfig.bdiDiferenciado}
                                        onChange={e => setEngineeringConfig({ ...engineeringConfig, bdiDiferenciado: e.target.checked })} />
                                    Ativar BDI por categoria
                                </label>
                            </div>

                            {engineeringConfig.bdiDiferenciado && (
                                <>
                                    <p style={{ fontSize: '0.78rem', color: 'var(--color-text-tertiary)', marginBottom: 12 }}>
                                        Conforme Acórdão TCU 2622/2013, itens de <strong>Fornecimento de Materiais/Equipamentos</strong> devem ter BDI inferior ao de serviços de obra.
                                    </p>
                                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 12 }}>
                                        <div style={{ padding: 12, borderRadius: 6, border: '1px solid rgba(37,99,235,0.15)', background: 'rgba(37,99,235,0.03)' }}>
                                            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--color-primary)', marginBottom: 4 }}>BDI OBRA (serviços)</div>
                                            <div style={{ fontSize: '1.1rem', fontWeight: 800, color: 'var(--color-primary)' }}>{effectiveBdi.toFixed(2)}%</div>
                                            <div style={{ fontSize: '0.68rem', color: 'var(--color-text-tertiary)' }}>Calculado no modo {bdiConfig.mode}</div>
                                        </div>
                                        <div style={{ padding: 12, borderRadius: 6, border: '1px solid rgba(180,83,9,0.15)', background: 'rgba(180,83,9,0.03)' }}>
                                            <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#b45309', marginBottom: 4 }}>BDI FORNECIMENTO</div>
                                            <input type="number" step="0.01" className="form-input" style={{ width: '100%', fontSize: '1rem', fontWeight: 700 }}
                                                value={engineeringConfig.bdiFornecimento || 14.02}
                                                onChange={e => setEngineeringConfig({ ...engineeringConfig, bdiFornecimento: Number(e.target.value) })} />
                                            <div style={{ fontSize: '0.68rem', color: 'var(--color-text-tertiary)', marginTop: 4 }}>
                                                TCU ref: {TCU_REFERENCE_RANGES['Fornecimento de Materiais/Equipamentos'].min}% – {TCU_REFERENCE_RANGES['Fornecimento de Materiais/Equipamentos'].max}% (mediana {TCU_REFERENCE_RANGES['Fornecimento de Materiais/Equipamentos'].median}%)
                                            </div>
                                        </div>
                                    </div>
                                    <div style={{ fontSize: '0.75rem', color: 'var(--color-text-secondary)', padding: '8px 12px', background: 'var(--color-bg-base)', borderRadius: 6 }}>
                                        💡 Na planilha, cada item agora tem um seletor de categoria BDI na coluna "Tipo". Itens marcados como <strong style={{ color: '#b45309' }}>FORNECIMENTO</strong> usarão o BDI de {(engineeringConfig.bdiFornecimento || 14.02).toFixed(2)}%.
                                    </div>
                                </>
                            )}
                        </div>

                        <div style={{ display: 'flex', justifyContent: 'flex-end', paddingTop: 16, borderTop: '1px solid var(--color-border)' }}>
                            <button className="btn btn-primary" onClick={handleSave} disabled={isSaving}>
                                {isSaving ? <Loader2 size={16} className="spin" /> : <Save size={16} />}
                                Salvar Configurações
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {activeTab === 'caderno' && (
                <BudgetDocsPanel items={items} bdiConfig={bdiConfig} effectiveBdi={effectiveBdi} insumos={[]} cronogramaResult={null} proposalId={proposalId} engineeringConfig={engineeringConfig} />
            )}

            {/* Tab Content: Planilha */}
            {activeTab === 'planilha' && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 300px', gap: 'var(--space-4)' }}>

                {/* Table */}
                <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                        <thead>
                            <tr style={{ background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)' }}>
                                {['Item','Tipo','Base','Código','Descrição do Serviço','Unid.','Qtd.','Custo (S/ BDI)','Preço (C/ BDI)','Total',''].map((h,i) => (
                                    <th key={i} style={{ padding: '10px 12px', textAlign: i >= 6 ? 'right' : 'left', color: i === 8 || i === 9 ? 'var(--color-primary)' : 'var(--color-text-secondary)', fontWeight: i === 9 ? 800 : i === 8 ? 700 : 600, width: i === 4 ? '24%' : i === 1 ? 80 : undefined, fontSize: '0.72rem' }}>{h}</th>
                                ))}
                            </tr>
                        </thead>
                        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={handleDragEnd}>
                            <SortableContext items={items.map(it => it.id)} strategy={verticalListSortingStrategy}>
                            <tbody>
                            {items.map(it => {
                                const meta = TYPE_META[it.type || 'COMPOSICAO'];
                                const isGroup = isGrouper(it.type);
                                const depth = getDepth(it.itemNumber);
                                const IconComp = meta.icon;

                                // ── ETAPA / SUBETAPA ROW (header style) ──
                                const SortableRow = ({ id, isGroup, meta, hasInsumos, isExpanded, children }: any) => {
                                    const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id });
                                    const style = { transform: CSS.Transform.toString(transform), transition, opacity: isDragging ? 0.5 : 1, background: isDragging ? 'rgba(0,0,0,0.05)' : undefined };
                                    return (
                                        <tr ref={setNodeRef} style={{ ...style, borderBottom: '1px solid var(--color-border)' }}>
                                            {children(listeners)}
                                        </tr>
                                    );
                                };

                                if (isGroup) {
                                    return (
                                        <SortableRow key={it.id} id={it.id} isGroup={true} meta={meta} hasInsumos={false} isExpanded={false}>
                                            {(listeners: any) => (
                                                <>
                                                    <td style={{ padding: '8px 12px', fontWeight: 800, color: meta.color, fontSize: '0.85rem' }}>
                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                                                            <button {...listeners} style={{ cursor: 'grab', background: 'none', border: 'none', padding: 0, color: meta.color, opacity: 0.5, display: 'flex' }}><GripVertical size={14} /></button>
                                                            {it.itemNumber}
                                                        </div>
                                                    </td>
                                            <td style={{ padding: '6px 8px' }}>
                                                <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 8px', borderRadius: 4, background: meta.bg, color: meta.color, fontSize: '0.68rem', fontWeight: 700 }}>
                                                    <IconComp size={11} /> {meta.label}
                                                </span>
                                            </td>
                                            <td colSpan={7} style={{ padding: '8px 12px' }}>
                                                <input value={it.description} onChange={e => updateItem(it.id, 'description', e.target.value)} 
                                                    style={{ ...inputStyle(), fontWeight: 700, fontSize: '0.85rem', color: meta.color, background: 'transparent', border: '1px solid transparent', paddingLeft: depth > 0 ? 16 : 0 }}
                                                    onFocus={e => { e.currentTarget.style.border = `1px solid ${meta.color}30`; }}
                                                    onBlur={e => { e.currentTarget.style.border = '1px solid transparent'; }}
                                                />
                                            </td>
                                                    <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                                                        <button className="prop-icon-btn" onClick={() => removeItem(it.id)}><Trash2 size={14} color="var(--color-danger)" /></button>
                                                    </td>
                                                </>
                                            )}
                                        </SortableRow>
                                    );
                                }

                                // ── COMPOSICAO / INSUMO ROW (data row) ──
                                const hasInsumos = it.type === 'COMPOSICAO' && it.insumos && it.insumos.length > 0;
                                const isExpanded = expandedItems.has(it.id);
                                const rows = [];

                                rows.push(
                                    <SortableRow key={it.id} id={it.id} isGroup={false} meta={meta} hasInsumos={hasInsumos} isExpanded={isExpanded}>
                                        {(listeners: any) => (
                                            <>
                                                <td style={{ padding: '6px 12px' }}>
                                                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                                                        <button {...listeners} style={{ cursor: 'grab', background: 'none', border: 'none', padding: 0, color: 'var(--color-text-tertiary)', display: 'flex', marginRight: 4 }}><GripVertical size={14} /></button>
                                                        {hasInsumos && (
                                                            <button onClick={() => toggleExpand(it.id)} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 0, color: meta.color, display: 'flex' }}>
                                                                {isExpanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
                                                            </button>
                                                        )}
                                                        <input value={it.itemNumber} onChange={e => updateItem(it.id, 'itemNumber', e.target.value)} style={{ ...inputStyle(hasInsumos ? '48px' : '60px'), fontWeight: 700, paddingLeft: Math.min(depth, 3) * 8 + 4 }} />
                                                    </div>
                                                </td>
                                        <td style={{ padding: '6px 8px' }}>
                                            <span style={{ display: 'inline-flex', alignItems: 'center', gap: 3, padding: '2px 6px', borderRadius: 4, background: meta.bg, color: meta.color, fontSize: '0.65rem', fontWeight: 700, whiteSpace: 'nowrap' }}>
                                                <IconComp size={10} /> {meta.label}
                                            </span>
                                            {engineeringConfig.bdiDiferenciado && !isGrouper(it.type) && (
                                                <select
                                                    value={it.bdiCategoria || 'OBRA'}
                                                    onChange={e => updateItem(it.id, 'bdiCategoria', e.target.value as BdiCategoria)}
                                                    style={{
                                                        display: 'block', marginTop: 2, fontSize: '0.6rem', fontWeight: 700,
                                                        padding: '1px 4px', border: '1px solid transparent', borderRadius: 3,
                                                        background: (it.bdiCategoria || 'OBRA') === 'FORNECIMENTO' ? 'rgba(180,83,9,0.08)' : 'rgba(37,99,235,0.05)',
                                                        color: (it.bdiCategoria || 'OBRA') === 'FORNECIMENTO' ? '#b45309' : 'var(--color-primary)',
                                                        cursor: 'pointer', width: '100%',
                                                    }}
                                                >
                                                    <option value="OBRA">Obra</option>
                                                    <option value="FORNECIMENTO">Fornec.</option>
                                                </select>
                                            )}
                                        </td>
                                        <td style={{ padding: '6px 8px' }}>
                                            {it.sourceName && <span style={{ background: it.sourceName === 'PROPRIA' ? 'var(--color-success-light)' : 'rgba(37,99,235,0.08)', color: it.sourceName === 'PROPRIA' ? 'var(--color-success)' : 'var(--color-primary)', padding: '2px 6px', borderRadius: 4, fontSize: '0.68rem', fontWeight: 700 }}>{it.sourceName}</span>}
                                        </td>
                                        <td style={{ padding: '6px 8px' }}>
                                            <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                <input value={it.code} onChange={e => updateItem(it.id, 'code', e.target.value)} style={{ ...inputStyle('65px'), color: 'var(--color-text-secondary)' }} />
                                                {it.type === 'COMPOSICAO' && it.code && it.code !== 'N/A' && (
                                                    <button title="Editar composição" onClick={() => setCompositionEditorIndex(items.indexOf(it))} style={{ background: 'none', border: 'none', cursor: 'pointer', padding: 2, opacity: 0.5 }}
                                                        onMouseEnter={e => { (e.currentTarget as HTMLElement).style.opacity = '1'; }}
                                                        onMouseLeave={e => { (e.currentTarget as HTMLElement).style.opacity = '0.5'; }}
                                                    >
                                                        <Layers size={13} color="var(--color-primary)" />
                                                    </button>
                                                )}
                                            </div>
                                        </td>
                                        <td style={{ padding: '6px 8px' }}>
                                            <input value={it.description} onChange={e => updateItem(it.id, 'description', e.target.value)} style={{ ...inputStyle(), fontWeight: 500 }} />
                                        </td>
                                        <td style={{ padding: '6px 8px' }}>
                                            <input value={it.unit} onChange={e => updateItem(it.id, 'unit', e.target.value)} style={{ ...inputStyle('55px'), textAlign: 'center' }} />
                                        </td>
                                        <td style={{ padding: '6px 8px' }}>
                                            <input type="number" value={it.quantity} onChange={e => updateItem(it.id, 'quantity', parseFloat(e.target.value) || 0)} style={{ ...inputStyle('70px'), textAlign: 'right' }} step="0.01" />
                                        </td>
                                        <td style={{ padding: '6px 8px' }}>
                                            {it.unitCost === 0 ? (
                                                <div style={{ display: 'flex', alignItems: 'center', gap: 6, justifyContent: 'flex-end', color: 'var(--color-danger)' }}>
                                                    <span title={it.sourceName === 'PROPRIA' && it.type === 'COMPOSICAO' ? "Composição vazia. Preencha no Módulo Livre." : "Item sem preço unitário."} style={{ display: 'flex' }}>
                                                        <AlertCircle size={14} />
                                                    </span>
                                                    <input type="number" value={it.unitCost} onChange={e => updateItem(it.id, 'unitCost', parseFloat(e.target.value) || 0)} style={{ ...inputStyle('70px'), textAlign: 'right', color: 'var(--color-danger)', fontWeight: 700, border: '1px solid var(--color-danger)' }} step="0.01" />
                                                </div>
                                            ) : (
                                                <input type="number" value={it.unitCost} onChange={e => updateItem(it.id, 'unitCost', parseFloat(e.target.value) || 0)} style={{ ...inputStyle('90px'), textAlign: 'right' }} step="0.01" />
                                            )}
                                        </td>
                                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 700, color: it.unitCost === 0 ? 'var(--color-danger)' : 'var(--color-primary)' }}>{fmt(it.unitPrice)}</td>
                                        <td style={{ padding: '6px 8px', textAlign: 'right', fontWeight: 800, color: 'var(--color-primary)', fontSize: '0.82rem' }}>{fmt(it.totalPrice)}</td>
                                                <td style={{ padding: '6px 8px', textAlign: 'center' }}>
                                                    <button className="prop-icon-btn" onClick={() => removeItem(it.id)}><Trash2 size={14} color="var(--color-danger)" /></button>
                                                </td>
                                            </>
                                        )}
                                    </SortableRow>
                                );

                                // ── EXPANDED INSUMO DETAIL ROWS ──
                                if (hasInsumos && isExpanded) {
                                    const TYPE_LABELS: Record<string, { label: string; color: string }> = {
                                        'MATERIAL': { label: 'Material', color: '#b45309' },
                                        'MAO_DE_OBRA': { label: 'Mão de Obra', color: '#0369a1' },
                                        'EQUIPAMENTO': { label: 'Equipamento', color: '#7c3aed' },
                                    };
                                    rows.push(
                                        <tr key={`${it.id}-insumos`} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <td colSpan={11} style={{ padding: 0 }}>
                                                <div style={{ margin: '0 16px 8px 40px', borderRadius: 'var(--radius-md)', border: '1px solid rgba(14,116,144,0.12)', overflow: 'hidden', background: 'rgba(14,116,144,0.02)' }}>
                                                    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem' }}>
                                                        <thead>
                                                            <tr style={{ background: 'rgba(14,116,144,0.06)' }}>
                                                                <th style={{ padding: '5px 10px', textAlign: 'left', color: '#0e7490', fontWeight: 700, fontSize: '0.65rem' }}>Tipo</th>
                                                                <th style={{ padding: '5px 10px', textAlign: 'left', color: '#0e7490', fontWeight: 700, fontSize: '0.65rem' }}>Descrição do Insumo</th>
                                                                <th style={{ padding: '5px 10px', textAlign: 'center', color: '#0e7490', fontWeight: 700, fontSize: '0.65rem' }}>Unid.</th>
                                                                <th style={{ padding: '5px 10px', textAlign: 'right', color: '#0e7490', fontWeight: 700, fontSize: '0.65rem' }}>Coef.</th>
                                                                <th style={{ padding: '5px 10px', textAlign: 'right', color: '#0e7490', fontWeight: 700, fontSize: '0.65rem' }}>Preço Unit.</th>
                                                                <th style={{ padding: '5px 10px', textAlign: 'right', color: '#0e7490', fontWeight: 700, fontSize: '0.65rem' }}>Subtotal</th>
                                                            </tr>
                                                        </thead>
                                                        <tbody>
                                                            {it.insumos!.map((ins, idx) => {
                                                                const tl = TYPE_LABELS[ins.type] || { label: ins.type, color: '#666' };
                                                                return (
                                                                    <tr key={idx} style={{ borderTop: '1px solid rgba(14,116,144,0.08)' }}>
                                                                        <td style={{ padding: '4px 10px' }}>
                                                                            <span style={{ fontSize: '0.62rem', padding: '1px 5px', borderRadius: 3, background: `${tl.color}10`, color: tl.color, fontWeight: 600 }}>{tl.label}</span>
                                                                        </td>
                                                                        <td style={{ padding: '4px 10px', color: 'var(--color-text-primary)', fontWeight: 500 }}>{ins.description}</td>
                                                                        <td style={{ padding: '4px 10px', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>{ins.unit}</td>
                                                                        <td style={{ padding: '4px 10px', textAlign: 'right', fontWeight: 500 }}>{ins.coefficient.toFixed(4)}</td>
                                                                        <td style={{ padding: '4px 10px', textAlign: 'right', fontWeight: 500 }}>{fmt(ins.unitPrice)}</td>
                                                                        <td style={{ padding: '4px 10px', textAlign: 'right', fontWeight: 700, color: '#0e7490' }}>{fmt(ins.coefficient * ins.unitPrice)}</td>
                                                                    </tr>
                                                                );
                                                            })}
                                                            <tr style={{ borderTop: '1px solid rgba(14,116,144,0.15)', background: 'rgba(14,116,144,0.04)' }}>
                                                                <td colSpan={5} style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 700, color: '#0e7490', fontSize: '0.7rem' }}>Total da Composição:</td>
                                                                <td style={{ padding: '5px 10px', textAlign: 'right', fontWeight: 800, color: '#0e7490', fontSize: '0.75rem' }}>
                                                                    {fmt(it.insumos!.reduce((s, ins) => s + ins.coefficient * ins.unitPrice, 0))}
                                                                </td>
                                                            </tr>
                                                        </tbody>
                                                    </table>
                                                </div>
                                            </td>
                                        </tr>
                                    );
                                }

                                return rows;
                            })}
                            {items.length === 0 && (
                                <tr><td colSpan={10} style={{ padding: 40, textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                                    Planilha vazia — Use "Extrair via IA" ou adicione itens manualmente
                                </td></tr>
                            )}
                            </tbody>
                            </SortableContext>
                        </DndContext>
                    </table>

                    {/* ── INSERTION TOOLBAR (OrcaFascio style) ── */}
                    <div style={{ padding: 'var(--space-3)', background: 'var(--color-bg-base)', borderTop: '1px solid var(--color-border)', display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <span style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)', fontWeight: 600, marginRight: 4 }}>Inserir:</span>
                        {([['ETAPA', FolderOpen], ['SUBETAPA', GitBranch], ['COMPOSICAO', Layers], ['INSUMO', Package]] as [EngItemType, typeof FolderOpen][]).map(([type, Icon]) => {
                            const m = TYPE_META[type];
                            return (
                                <button key={type} onClick={() => addTypedItem(type)}
                                    style={{ display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px', borderRadius: 'var(--radius-md)', border: `1px solid ${m.color}20`, background: m.bg, cursor: 'pointer', fontSize: '0.75rem', fontWeight: 600, color: m.color, transition: 'all 0.15s' }}
                                    onMouseEnter={e => { (e.currentTarget as HTMLElement).style.background = `${m.color}18`; }}
                                    onMouseLeave={e => { (e.currentTarget as HTMLElement).style.background = m.bg; }}
                                >
                                    <Icon size={13} /> {m.label}
                                </button>
                            );
                        })}
                        <div style={{ width: 1, height: 20, background: 'var(--color-border)', margin: '0 4px' }} />
                        <button className="btn btn-outline" style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px' }}
                            onClick={() => { setInsertType('COMPOSICAO'); setShowSearch(true); }}>
                            <Database size={13} /> Buscar Composição
                        </button>
                        <button className="btn btn-outline" style={{ fontSize: '0.75rem', display: 'flex', alignItems: 'center', gap: 5, padding: '5px 12px' }}
                            onClick={() => { setInsertType('INSUMO'); setShowSearch(true); }}>
                            <Search size={13} /> Buscar Insumo
                        </button>
                    </div>
                </div>

                {/* BDI Panel + Totals */}
                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>

                    {/* BDI Calculator */}
                    <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', padding: 'var(--space-4)' }}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', marginBottom: 'var(--space-4)' }}>
                            <Calculator size={16} color="var(--color-primary)" />
                            <h4 style={{ margin: 0, fontSize: 'var(--text-md)', fontWeight: 600 }}>Cálculo de BDI</h4>
                        </div>

                        <div style={{ display: 'flex', gap: 8, marginBottom: 'var(--space-4)' }}>
                            {(['SIMPLIFICADO', 'TCU'] as const).map(mode => (
                                <button key={mode} onClick={() => setBdiConfig(prev => ({ ...prev, mode }))} style={{
                                    flex: 1, padding: 6, fontSize: '0.75rem', fontWeight: 600, borderRadius: 'var(--radius-sm)',
                                    border: '1px solid', cursor: 'pointer',
                                    borderColor: bdiConfig.mode === mode ? (mode === 'TCU' ? '#B45309' : 'var(--color-primary)') : 'var(--color-border)',
                                    background: bdiConfig.mode === mode ? (mode === 'TCU' ? 'rgba(180,83,9,0.08)' : 'var(--color-primary-light)') : 'transparent',
                                    color: bdiConfig.mode === mode ? (mode === 'TCU' ? '#B45309' : 'var(--color-primary)') : 'var(--color-text-secondary)',
                                }}>{mode === 'TCU' ? 'Fórmula TCU' : 'Simplificado'}</button>
                            ))}
                        </div>

                        {bdiConfig.mode === 'SIMPLIFICADO' ? (
                            <div>
                                <label style={{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: 'var(--color-text-secondary)', marginBottom: 4 }}>BDI Global (%)</label>
                                <input type="number" className="form-input" value={bdiConfig.bdiGlobal}
                                    onChange={e => setBdiConfig(prev => ({ ...prev, bdiGlobal: parseFloat(e.target.value) || 0 }))}
                                    style={{ fontSize: '1.2rem', fontWeight: 700, color: 'var(--color-primary)' }} step="0.01" />
                            </div>
                        ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                                    {([
                                        ['adminCentral', 'Adm. Central (%)'],
                                        ['seguros', 'Seguros (%)'],
                                        ['garantias', 'Garantias (%)'],
                                        ['riscos', 'Riscos (%)'],
                                    ] as const).map(([key, label]) => (
                                        <div key={key}>
                                            <label style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)' }}>{label}</label>
                                            <input type="number" className="form-input" value={bdiConfig.tcu[key]}
                                                onChange={e => updateTcu(key, parseFloat(e.target.value) || 0)}
                                                style={{ padding: '4px 8px', fontSize: '0.8rem' }} step="0.01" />
                                        </div>
                                    ))}
                                </div>
                                <div style={{ borderTop: '1px dashed var(--color-border)', margin: '4px 0' }} />
                                <div>
                                    <label style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)' }}>Desp. Financeiras (%)</label>
                                    <input type="number" className="form-input" value={bdiConfig.tcu.despFinanceiras}
                                        onChange={e => updateTcu('despFinanceiras', parseFloat(e.target.value) || 0)}
                                        style={{ padding: '4px 8px', fontSize: '0.8rem' }} step="0.01" />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)' }}>Lucro (%)</label>
                                    <input type="number" className="form-input" value={bdiConfig.tcu.lucro}
                                        onChange={e => updateTcu('lucro', parseFloat(e.target.value) || 0)}
                                        style={{ padding: '4px 8px', fontSize: '0.8rem' }} step="0.01" />
                                </div>
                                <div>
                                    <label style={{ fontSize: '0.65rem', color: 'var(--color-text-tertiary)' }}>Tributos — PIS+COFINS+ISS (%)</label>
                                    <input type="number" className="form-input" value={bdiConfig.tcu.tributos}
                                        onChange={e => updateTcu('tributos', parseFloat(e.target.value) || 0)}
                                        style={{ padding: '4px 8px', fontSize: '0.8rem' }} step="0.01" />
                                </div>
                                <div style={{ marginTop: 4, background: 'rgba(180,83,9,0.08)', padding: 10, borderRadius: 'var(--radius-md)', textAlign: 'center' }}>
                                    <span style={{ fontSize: '0.7rem', color: '#92400E', fontWeight: 600, display: 'block' }}>BDI CALCULADO (Acórdão TCU 2622)</span>
                                    <span style={{ fontSize: '1.4rem', color: '#B45309', fontWeight: 800 }}>{effectiveBdi.toFixed(2)}%</span>
                                </div>
                            </div>
                        )}
                    </div>

                    {/* Totals */}
                    <div style={{ background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', overflow: 'hidden' }}>
                        <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                            <span style={{ color: 'var(--color-text-secondary)' }}>Subtotal (S/ BDI)</span>
                            <span style={{ fontWeight: 600 }}>{fmt(subtotal)}</span>
                        </div>
                        <div style={{ padding: 'var(--space-3) var(--space-4)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', fontSize: '0.85rem' }}>
                            <span style={{ color: 'var(--color-text-secondary)' }}>BDI ({effectiveBdi.toFixed(2)}%)</span>
                            <span style={{ fontWeight: 600, color: 'var(--color-success)' }}>+ {fmt(total - subtotal)}</span>
                        </div>
                        <div style={{ padding: 'var(--space-4)', background: 'linear-gradient(135deg, rgba(37,99,235,0.05), rgba(139,92,246,0.05))', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <span style={{ fontSize: '0.9rem', fontWeight: 700, color: 'var(--color-text-secondary)', textTransform: 'uppercase' }}>Total Global</span>
                            <span style={{ fontSize: '1.4rem', fontWeight: 800, color: 'var(--color-primary)' }}>{fmt(total)}</span>
                        </div>
                    </div>
                </div>
            </div>
            )}

            {/* Search Modal */}
            {showSearch && (
                <div style={{ position: 'fixed', inset: 0, zIndex: 1000, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                    <div style={{ background: 'var(--color-bg-surface)', padding: 24, borderRadius: 12, width: 800, maxWidth: '90vw', maxHeight: '80vh', display: 'flex', flexDirection: 'column', gap: 16, boxShadow: '0 10px 25px rgba(0,0,0,0.2)' }}>
                        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                            <h3 style={{ margin: 0 }}>Buscar Insumo/Serviço na Base Oficial</h3>
                            <button onClick={() => setShowSearch(false)} style={{ background: 'transparent', border: 'none', cursor: 'pointer' }}><X size={20} /></button>
                        </div>
                        <div style={{ display: 'flex', gap: 8 }}>
                            <select className="form-select" value={selectedBaseId} onChange={e => setSelectedBaseId(e.target.value)} style={{ width: 200 }}>
                                {(() => {
                                    const allowed = engineeringConfig?.basesConsideradas || [];
                                    const filtered = allowed.length > 0 
                                        ? bases.filter(b => allowed.some((ab: string) => b.name.toUpperCase().includes(ab.toUpperCase())))
                                        : bases;
                                    
                                    if (filtered.length === 0) return <option value="">Nenhuma base permitida</option>;
                                    return filtered.map(b => <option key={b.id} value={b.id}>{b.name} {b.uf || ''}</option>);
                                })()}
                            </select>
                            <input type="text" className="form-input" placeholder="Buscar por código ou descrição..." value={searchQuery} onChange={e => setSearchQuery(e.target.value)} onKeyDown={e => e.key === 'Enter' && handleSearch()} style={{ flex: 1 }} />
                            <button className="btn btn-primary" onClick={handleSearch} disabled={isSearching}>{isSearching ? 'Buscando...' : 'Buscar'}</button>
                        </div>
                        <div style={{ flex: 1, overflowY: 'auto', border: '1px solid var(--color-border)', borderRadius: 8 }}>
                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.8rem' }}>
                                <thead><tr style={{ background: 'var(--color-bg-base)' }}>
                                    {['Código','Descrição','Unid.','Preço',''].map((h,i) => <th key={i} style={{ padding: 8, textAlign: i >= 3 ? 'right' : 'left' }}>{h}</th>)}
                                </tr></thead>
                                <tbody>
                                    {searchResults.map(r => (
                                        <tr key={r.id} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                            <td style={{ padding: 8 }}><strong>{r.code}</strong></td>
                                            <td style={{ padding: 8 }}>{r.description}</td>
                                            <td style={{ padding: 8, textAlign: 'center' }}>{r.unit}</td>
                                            <td style={{ padding: 8, textAlign: 'right', fontWeight: 600 }}>{fmt(Number(r.price) || 0)}</td>
                                            <td style={{ padding: 8, textAlign: 'center' }}>
                                                <button className="btn btn-primary" style={{ padding: '4px 8px', fontSize: '0.7rem' }} onClick={() => addFromSearch(r)}>Adicionar</button>
                                            </td>
                                        </tr>
                                    ))}
                                    {searchResults.length === 0 && <tr><td colSpan={5} style={{ padding: 16, textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                                        {searchQuery ? 'Nenhum resultado encontrado.' : 'Digite uma busca para começar.'}
                                    </td></tr>}
                                </tbody>
                            </table>
                        </div>
                    </div>
                </div>
            )}

            {/* Composition Drawer (single item) */}
            {compositionItem && compositionEditorIndex === null && (
                <CompositionDrawer
                    code={compositionItem.code}
                    description={compositionItem.description}
                    onClose={() => setCompositionItem(null)}
                />
            )}

            {/* Full-Page Composition Editor (with navigation) */}
            {compositionEditorIndex !== null && (
                <CompositionEditor
                    items={items}
                    initialIndex={compositionEditorIndex}
                    onClose={() => setCompositionEditorIndex(null)}
                    onUpdateItem={(itemId, updates) => {
                        if (updates.unitCost !== undefined) {
                            updateItem(itemId, 'unitCost', updates.unitCost);
                        }
                    }}
                    engineeringConfig={engineeringConfig}
                />
            )}
        </div>
    );
}
