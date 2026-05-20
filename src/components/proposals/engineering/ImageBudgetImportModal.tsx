import React, { useState, useEffect, useRef } from 'react';
import { X, Upload, Loader2, CheckCircle2, AlertTriangle, Image as ImageIcon, Clipboard, ArrowRight } from 'lucide-react';
import { EngItem, isGrouper } from './types';

interface ImageBudgetImportModalProps {
    onClose: () => void;
    onImport: (items: any[]) => void;
    engineeringConfig: any;
    initialFile?: File | null;
    onClearInitialFile?: () => void;
}

export function ImageBudgetImportModal({ onClose, onImport, engineeringConfig, initialFile, onClearInitialFile }: ImageBudgetImportModalProps) {
    const [file, setFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [extractedItems, setExtractedItems] = useState<any[]>([]);
    const [error, setError] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Auto load initialFile if passed from parent
    useEffect(() => {
        if (initialFile) {
            handleSelectFile(initialFile);
            if (onClearInitialFile) {
                onClearInitialFile();
            }
        }
    }, [initialFile]);
    
    const fileInputRef = useRef<HTMLInputElement>(null);
    const dropzoneRef = useRef<HTMLDivElement>(null);

    // Handle paste event inside the modal
    useEffect(() => {
        const handlePaste = (e: ClipboardEvent) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.type.indexOf('image') !== -1) {
                    const file = item.getAsFile();
                    if (file) {
                        e.preventDefault();
                        handleSelectFile(file);
                    }
                }
            }
        };

        window.addEventListener('paste', handlePaste);
        return () => {
            window.removeEventListener('paste', handlePaste);
        };
    }, []);

    const handleSelectFile = (selectedFile: File) => {
        if (!selectedFile.type.startsWith('image/')) {
            setError('O arquivo selecionado deve ser uma imagem (PNG, JPG, etc.)');
            return;
        }
        
        setFile(selectedFile);
        setSuccessMessage(null);
        setError(null);
        setExtractedItems([]);

        const reader = new FileReader();
        reader.onload = (e) => {
            setPreviewUrl(e.target?.result as string);
        };
        reader.readAsDataURL(selectedFile);

        // Auto trigger extraction
        extractItems(selectedFile);
    };

    const extractItems = async (fileToExtract: File) => {
        setIsLoading(true);
        setError(null);
        try {
            const formData = new FormData();
            formData.append('file', fileToExtract);
            formData.append('engineeringConfig', JSON.stringify(engineeringConfig));

            const response = await fetch('/api/engineering/ai/extract-items-image', {
                method: 'POST',
                body: formData,
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || 'Falha ao extrair itens da imagem');
            }

            const data = await response.json();
            if (!data.items || data.items.length === 0) {
                throw new Error('Nenhum item orçamentário foi identificado nesta imagem. Tente tirar um print com mais contraste ou do cabeçalho da tabela.');
            }
            setExtractedItems(data.items);
        } catch (err: any) {
            console.error(err);
            setError(err.message || 'Erro ao processar a imagem. Verifique o tamanho e contraste do print.');
        } finally {
            setIsLoading(false);
        }
    };

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
    };

    const handleDrop = (e: React.DragEvent) => {
        e.preventDefault();
        setDragOver(false);
        const droppedFile = e.dataTransfer.files?.[0];
        if (droppedFile) {
            handleSelectFile(droppedFile);
        }
    };

    const handleApplyImport = () => {
        if (extractedItems.length === 0) return;
        onImport(extractedItems);
        
        // Show success and reset for continuous workflow
        const count = extractedItems.length;
        setSuccessMessage(`${count} itens inseridos com sucesso no orçamento!`);
        
        // Reset image states
        setFile(null);
        setPreviewUrl(null);
        setExtractedItems([]);
        
        // Clear message after 4s
        setTimeout(() => {
            setSuccessMessage(null);
        }, 5000);
    };

    const handleClear = () => {
        setFile(null);
        setPreviewUrl(null);
        setExtractedItems([]);
        setError(null);
        setSuccessMessage(null);
    };

    const formatCurrency = (val: number) => {
        return val.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
    };

    return (
        <div style={{
            position: 'fixed', inset: 0,
            background: 'rgba(15,23,42,0.6)',
            backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1100,
            padding: 16
        }}>
            <div style={{
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)',
                borderRadius: 16,
                width: 900, maxWidth: '95vw',
                height: 600, maxHeight: '90vh',
                display: 'flex', flexDirection: 'column',
                boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1), 0 10px 10px -5px rgba(0,0,0,0.04)',
                overflow: 'hidden',
                animation: 'scaleUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
            }}>
                {/* Header */}
                <div style={{
                    padding: '16px 24px',
                    borderBottom: '1px solid var(--color-border)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'linear-gradient(135deg, rgba(37,99,235,0.05) 0%, rgba(37,99,235,0) 100%)'
                }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <ImageIcon size={18} color="var(--color-primary)" />
                            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                                Extração Contínua via Print / Imagem (IA)
                            </h3>
                        </div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: 2, display: 'block' }}>
                            Arraste ou cole prints de planilha/orçamentos para montar a planilha continuamente.
                        </span>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        padding: 6, borderRadius: '50%',
                        color: 'var(--color-text-tertiary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        transition: 'background 0.2s'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-base)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Content Container */}
                <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
                    {/* Success Message Banner */}
                    {successMessage && (
                        <div style={{
                            position: 'absolute', top: 12, left: 12, right: 12, zIndex: 10,
                            padding: '12px 16px', background: 'rgba(16,185,129,0.1)',
                            border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8,
                            color: '#059669', fontSize: '0.85rem', fontWeight: 600,
                            display: 'flex', alignItems: 'center', gap: 8,
                            boxShadow: '0 4px 6px -1px rgba(0,0,0,0.05)',
                            animation: 'slideDown 0.3s ease-out'
                        }}>
                            <CheckCircle2 size={16} />
                            {successMessage}
                        </div>
                    )}

                    {!file ? (
                        /* Dropzone / Paste Area */
                        <div 
                            ref={dropzoneRef}
                            onDragOver={handleDragOver}
                            onDragLeave={handleDragLeave}
                            onDrop={handleDrop}
                            onClick={() => fileInputRef.current?.click()}
                            style={{
                                flex: 1, display: 'flex', flexDirection: 'column',
                                alignItems: 'center', justifyContent: 'center',
                                margin: 24, borderRadius: 12,
                                border: dragOver ? '2px dashed var(--color-primary)' : '2px dashed var(--color-border)',
                                background: dragOver ? 'rgba(37,99,235,0.02)' : 'var(--color-bg-base)',
                                cursor: 'pointer', transition: 'all 0.2s ease',
                                outline: 'none'
                            }}
                            onMouseEnter={e => {
                                e.currentTarget.style.borderColor = 'var(--color-primary)';
                                e.currentTarget.style.background = 'rgba(37,99,235,0.01)';
                            }}
                            onMouseLeave={e => {
                                if (!dragOver) {
                                    e.currentTarget.style.borderColor = 'var(--color-border)';
                                    e.currentTarget.style.background = 'var(--color-bg-base)';
                                }
                            }}
                        >
                            <input 
                                ref={fileInputRef}
                                type="file" 
                                accept="image/*" 
                                style={{ display: 'none' }}
                                onChange={e => {
                                    const selected = e.target.files?.[0];
                                    if (selected) handleSelectFile(selected);
                                }}
                            />
                            <div style={{
                                width: 64, height: 64, borderRadius: '50%',
                                background: 'linear-gradient(135deg, rgba(37,99,235,0.1) 0%, rgba(37,99,235,0.02) 100%)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                marginBottom: 16, color: 'var(--color-primary)'
                            }}>
                                <Upload size={28} />
                            </div>
                            <h4 style={{ margin: '0 0 8px', fontSize: '1rem', fontWeight: 700, color: 'var(--color-text-primary)' }}>
                                Arraste ou Cole seu Print
                            </h4>
                            <p style={{ margin: '0 0 16px', fontSize: '0.8rem', color: 'var(--color-text-tertiary)', textAlign: 'center', maxWidth: 400, lineHeight: 1.5 }}>
                                Tire um print da planilha orçamentária e clique aqui para pressionar <kbd style={{ padding: '2px 6px', background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600 }}>Ctrl + V</kbd> ou selecione o arquivo.
                            </p>
                            <button className="btn btn-outline" style={{ fontSize: '0.8rem', padding: '6px 16px' }}>
                                Selecionar Imagem
                            </button>
                            
                            <div style={{
                                marginTop: 32, display: 'flex', gap: 24,
                                borderTop: '1px solid var(--color-border)', paddingTop: 24,
                                width: '80%', justifyContent: 'space-around'
                            }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                                    <Clipboard size={14} color="var(--color-primary)" />
                                    Suporta Ctrl+V do Clipboard
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                                    <CheckCircle2 size={14} color="#10b981" />
                                    Identifica bases SINAPI/SEINFRA
                                </div>
                            </div>
                        </div>
                    ) : (
                        /* Image Selected & Processing Layout */
                        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
                            {/* Left Side: Image Preview */}
                            <div style={{
                                width: '38%', borderRight: '1px solid var(--color-border)',
                                display: 'flex', flexDirection: 'column', background: 'var(--color-bg-base)'
                            }}>
                                <div style={{
                                    flex: 1, padding: 16, display: 'flex',
                                    alignItems: 'center', justifyContent: 'center', minHeight: 0
                                }}>
                                    {previewUrl ? (
                                        <img 
                                            src={previewUrl} 
                                            alt="Preview" 
                                            style={{
                                                maxWidth: '100%', maxHeight: '100%',
                                                objectFit: 'contain', borderRadius: 8,
                                                boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                                                border: '1px solid var(--color-border)'
                                            }}
                                        />
                                    ) : (
                                        <div style={{ color: 'var(--color-text-tertiary)' }}>Carregando imagem...</div>
                                    )}
                                </div>
                                <div style={{
                                    padding: '12px 16px', borderTop: '1px solid var(--color-border)',
                                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                                    background: 'var(--color-bg-surface)'
                                }}>
                                    <span style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 180 }}>
                                        {file.name}
                                    </span>
                                    <button className="btn btn-outline" onClick={handleClear} style={{ padding: '4px 10px', fontSize: '0.72rem' }}>
                                        Trocar Imagem
                                    </button>
                                </div>
                            </div>

                            {/* Right Side: Extraction Result / Loading */}
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                                {isLoading ? (
                                    /* Loading State */
                                    <div style={{
                                        flex: 1, display: 'flex', flexDirection: 'column',
                                        alignItems: 'center', justifyContent: 'center', gap: 16
                                    }}>
                                        <Loader2 size={36} className="spin" color="var(--color-primary)" />
                                        <div style={{ textAlign: 'center' }}>
                                            <h4 style={{ margin: 0, fontWeight: 700 }}>Processando com Gemini Vision</h4>
                                            <p style={{ margin: '4px 0 0', fontSize: '0.78rem', color: 'var(--color-text-tertiary)' }}>
                                                Identificando estrutura da planilha e auditando preços oficiais...
                                            </p>
                                        </div>
                                    </div>
                                ) : error ? (
                                    /* Error State */
                                    <div style={{
                                        flex: 1, display: 'flex', flexDirection: 'column',
                                        alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center'
                                    }}>
                                        <AlertTriangle size={36} color="var(--color-danger)" style={{ marginBottom: 12 }} />
                                        <h4 style={{ margin: '0 0 8px', fontWeight: 700, color: 'var(--color-danger)' }}>Erro na extração</h4>
                                        <p style={{ margin: '0 0 16px', fontSize: '0.8rem', color: 'var(--color-text-secondary)', maxWidth: 360, lineHeight: 1.5 }}>
                                            {error}
                                        </p>
                                        <button className="btn btn-primary" onClick={() => extractItems(file)} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
                                            Tentar Novamente
                                        </button>
                                    </div>
                                ) : (
                                    /* Extracted Items Preview Table */
                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                                        <div style={{
                                            padding: '12px 16px', background: 'var(--color-bg-base)',
                                            borderBottom: '1px solid var(--color-border)',
                                            display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                                        }}>
                                            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-text-secondary)' }}>
                                                Itens Identificados ({extractedItems.length})
                                            </span>
                                            <span style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
                                                Revise os valores antes de importar
                                            </span>
                                        </div>

                                        <div style={{ flex: 1, overflowY: 'auto', minHeight: 0 }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.76rem' }}>
                                                <thead style={{ position: 'sticky', top: 0, background: 'var(--color-bg-surface)', borderBottom: '2px solid var(--color-border)', zIndex: 1 }}>
                                                    <tr>
                                                        <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Item</th>
                                                        <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Código</th>
                                                        <th style={{ padding: '8px 10px', textAlign: 'left', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Descrição</th>
                                                        <th style={{ padding: '8px 10px', textAlign: 'center', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Un</th>
                                                        <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Qtd</th>
                                                        <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Preço BDI</th>
                                                        <th style={{ padding: '8px 10px', textAlign: 'right', fontWeight: 600, color: 'var(--color-text-secondary)' }}>Total</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {extractedItems.map((it, index) => {
                                                        const isGroup = isGrouper(it.type || it.t);
                                                        const matchesBase = it.priceAudit?.matchedUnitCost > 0;
                                                        const baseName = it.sourceName || it.s;

                                                        return (
                                                            <tr key={index} style={{
                                                                borderBottom: '1px solid var(--color-border)',
                                                                background: isGroup ? 'rgba(37,99,235,0.02)' : 'transparent',
                                                                fontWeight: isGroup ? 700 : 400
                                                            }}>
                                                                <td style={{ padding: '8px 10px', color: isGroup ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
                                                                    {it.itemNumber || it.i}
                                                                </td>
                                                                <td style={{ padding: '8px 10px', color: 'var(--color-text-secondary)' }}>
                                                                    {!isGroup && (
                                                                        <div style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                                                                            <span>{it.code || it.c || 'PROPRIA'}</span>
                                                                            {matchesBase && (
                                                                                <span style={{
                                                                                    fontSize: '0.58rem', padding: '1px 4px',
                                                                                    borderRadius: 4, background: '#e0f2fe', color: '#0369a1',
                                                                                    fontWeight: 700
                                                                                }}>
                                                                                    {baseName}
                                                                                </span>
                                                                            )}
                                                                        </div>
                                                                    )}
                                                                </td>
                                                                <td style={{ padding: '8px 10px', color: 'var(--color-text-primary)', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={it.description || it.d}>
                                                                    {it.description || it.d}
                                                                </td>
                                                                <td style={{ padding: '8px 10px', textAlign: 'center', color: 'var(--color-text-secondary)' }}>
                                                                    {isGroup ? '' : (it.unit || it.u || 'UN')}
                                                                </td>
                                                                <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--color-text-primary)' }}>
                                                                    {isGroup ? '' : (Number(it.quantity || it.q) || 0).toLocaleString('pt-BR')}
                                                                </td>
                                                                <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--color-text-primary)' }}>
                                                                    {isGroup ? '' : formatCurrency(Number(it.unitPrice || it.up || it.unitCost || it.uc || 0))}
                                                                </td>
                                                                <td style={{ padding: '8px 10px', textAlign: 'right', color: 'var(--color-text-primary)', fontWeight: 600 }}>
                                                                    {isGroup ? '' : formatCurrency(Number(it.totalPrice || it.tp || 0))}
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                )}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{
                    padding: '16px 24px',
                    borderTop: '1px solid var(--color-border)',
                    background: 'var(--color-bg-surface)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
                        {!file ? 'Tire um print de parte da planilha e cole aqui com Ctrl+V.' : 'Você pode colar outra imagem ou arrastar outro arquivo para reiniciar.'}
                    </div>
                    <div style={{ display: 'flex', gap: 12 }}>
                        <button onClick={onClose} className="btn btn-outline" style={{ padding: '8px 16px', fontSize: '0.82rem' }}>
                            {file ? 'Cancelar' : 'Fechar'}
                        </button>
                        {file && !isLoading && !error && (
                            <button 
                                onClick={handleApplyImport}
                                className="btn btn-primary"
                                style={{
                                    padding: '8px 20px', fontSize: '0.82rem', fontWeight: 600,
                                    display: 'flex', alignItems: 'center', gap: 6
                                }}
                            >
                                Adicionar Itens ao Orçamento <ArrowRight size={14} />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
