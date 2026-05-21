/**
 * CronogramaImportModal — Extração de Cronograma via IA (Copiar/Colar)
 * 
 * Modal para colar/arrastar print de cronograma físico-financeiro do edital
 * e extrair etapas com percentuais de distribuição via Gemini Vision.
 */
import React, { useState, useEffect, useRef } from 'react';
import { X, Upload, Loader2, CheckCircle2, AlertTriangle, Calendar, Clipboard, ArrowRight } from 'lucide-react';
import type { CronogramaEtapa } from './cronogramaEngine';

interface CronogramaImportModalProps {
    onClose: () => void;
    onImport: (data: { meses: number; etapas: CronogramaEtapa[] }) => void;
    existingEtapas?: string[];
}

export function CronogramaImportModal({ onClose, onImport, existingEtapas }: CronogramaImportModalProps) {
    const [file, setFile] = useState<File | null>(null);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    const [isLoading, setIsLoading] = useState(false);
    const [extractedData, setExtractedData] = useState<{ meses: number; etapas: any[] } | null>(null);
    const [error, setError] = useState<string | null>(null);
    const [dragOver, setDragOver] = useState(false);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);
    const [progress, setProgress] = useState<number | null>(null);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const startSimulatedProgress = () => {
        setProgress(0);
        let current = 0;
        const interval = setInterval(() => {
            if (current < 90) {
                const increment = current < 50 ? 12 : current < 75 ? 6 : 2;
                current = Math.min(90, current + increment);
                setProgress(current);
            }
        }, 600);
        return () => {
            clearInterval(interval);
            setProgress(100);
            setTimeout(() => setProgress(null), 800);
        };
    };

    // Handle paste event
    useEffect(() => {
        const handlePaste = (e: ClipboardEvent) => {
            const items = e.clipboardData?.items;
            if (!items) return;
            for (let i = 0; i < items.length; i++) {
                const item = items[i];
                if (item.type.indexOf('image') !== -1) {
                    const f = item.getAsFile();
                    if (f) {
                        e.preventDefault();
                        handleSelectFile(f);
                    }
                }
            }
        };
        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, []);

    const handleSelectFile = (selectedFile: File) => {
        if (!selectedFile.type.startsWith('image/')) {
            setError('O arquivo deve ser uma imagem (PNG, JPG, etc.)');
            return;
        }
        setFile(selectedFile);
        setSuccessMessage(null);
        setError(null);
        setExtractedData(null);

        const reader = new FileReader();
        reader.onload = (e) => setPreviewUrl(e.target?.result as string);
        reader.readAsDataURL(selectedFile);

        extractCronograma(selectedFile);
    };

    const extractCronograma = async (fileToExtract: File) => {
        setIsLoading(true);
        setError(null);
        const stopProgress = startSimulatedProgress();
        try {
            // Convert to base64 using chunked approach (avoids stack overflow for large images)
            const arrayBuffer = await fileToExtract.arrayBuffer();
            const bytes = new Uint8Array(arrayBuffer);
            let binary = '';
            const chunkSize = 8192;
            for (let i = 0; i < bytes.length; i += chunkSize) {
                binary += String.fromCharCode(...bytes.slice(i, i + chunkSize));
            }
            const base64 = btoa(binary);

            const token = localStorage.getItem('token');
            const response = await fetch('/api/engineering/ai-extract-cronograma-image', {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    ...(token ? { 'Authorization': `Bearer ${token}` } : {}),
                },
                body: JSON.stringify({
                    imageBase64: base64,
                    mimeType: fileToExtract.type,
                    existingEtapas,
                }),
            });

            if (!response.ok) {
                const errData = await response.json().catch(() => ({}));
                throw new Error(errData.error || 'Falha ao extrair cronograma da imagem');
            }

            const result = await response.json();
            if (!result.found || !result.data?.etapas?.length) {
                throw new Error('Nenhum cronograma foi identificado nesta imagem. Tente um print com mais contraste ou que mostre a tabela completa.');
            }
            setExtractedData(result.data);
        } catch (err: any) {
            setError(err.message || 'Erro ao processar a imagem.');
        } finally {
            stopProgress();
            setIsLoading(false);
        }
    };

    const handleApplyImport = () => {
        if (!extractedData) return;
        const etapas: CronogramaEtapa[] = extractedData.etapas.map((e: any, i: number) => ({
            id: String(i + 1),
            nome: e.nome || `Etapa ${i + 1}`,
            valorTotal: e.valorTotal || 0,
            percentuais: Array.isArray(e.percentuais) ? e.percentuais : Array(12).fill(0),
        }));
        onImport({ meses: extractedData.meses, etapas });
        setSuccessMessage(`Cronograma importado: ${etapas.length} etapas em ${extractedData.meses} meses`);
        setFile(null);
        setPreviewUrl(null);
        setExtractedData(null);
        setTimeout(() => setSuccessMessage(null), 4000);
    };

    const handleClear = () => {
        setFile(null);
        setPreviewUrl(null);
        setExtractedData(null);
        setError(null);
        setSuccessMessage(null);
    };

    const updateEtapa = (index: number, field: string, value: any) => {
        if (!extractedData) return;
        setExtractedData(prev => {
            if (!prev) return prev;
            const etapas = [...prev.etapas];
            etapas[index] = { ...etapas[index], [field]: value };
            return { ...prev, etapas };
        });
    };

    const updatePercentual = (etapaIdx: number, mesIdx: number, value: number) => {
        if (!extractedData) return;
        setExtractedData(prev => {
            if (!prev) return prev;
            const etapas = [...prev.etapas];
            const pcts = [...etapas[etapaIdx].percentuais];
            pcts[mesIdx] = value;
            etapas[etapaIdx] = { ...etapas[etapaIdx], percentuais: pcts };
            return { ...prev, etapas };
        });
    };

    const fmt = (v: number) => v.toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });

    const inputStyle: React.CSSProperties = {
        background: 'transparent', border: '1px solid transparent',
        color: 'inherit', fontSize: 'inherit', fontFamily: 'inherit',
        width: '100%', padding: '3px 5px', borderRadius: 4,
        transition: 'all 0.15s', outline: 'none',
    };

    const handleFocus = (e: React.FocusEvent<HTMLInputElement>) => {
        e.currentTarget.style.borderColor = 'var(--color-primary)';
        e.currentTarget.style.background = 'var(--color-bg-base)';
    };
    const handleBlur = (e: React.FocusEvent<HTMLInputElement>) => {
        e.currentTarget.style.borderColor = 'transparent';
        e.currentTarget.style.background = 'transparent';
    };

    return (
        <div style={{
            position: 'fixed', inset: 0,
            background: 'rgba(15,23,42,0.6)', backdropFilter: 'blur(4px)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 1100, padding: 16
        }}>
            <div style={{
                background: 'var(--color-bg-surface)',
                border: '1px solid var(--color-border)', borderRadius: 16,
                width: 950, maxWidth: '95vw',
                height: 580, maxHeight: '90vh',
                display: 'flex', flexDirection: 'column',
                boxShadow: '0 20px 25px -5px rgba(0,0,0,0.1)',
                overflow: 'hidden',
                animation: 'scaleUp 0.2s cubic-bezier(0.16, 1, 0.3, 1)'
            }}>
                {/* Header */}
                <div style={{
                    padding: '16px 24px', borderBottom: '1px solid var(--color-border)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center',
                    background: 'linear-gradient(135deg, rgba(14,116,144,0.05) 0%, rgba(14,116,144,0) 100%)'
                }}>
                    <div>
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                            <Calendar size={18} color="#0e7490" />
                            <h3 style={{ margin: 0, fontSize: '1.1rem', fontWeight: 700 }}>
                                Extração de Cronograma via IA
                            </h3>
                        </div>
                        <span style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: 2, display: 'block' }}>
                            Cole ou arraste o print do cronograma físico-financeiro do edital.
                        </span>
                    </div>
                    <button onClick={onClose} style={{
                        background: 'none', border: 'none', cursor: 'pointer',
                        padding: 6, borderRadius: '50%', color: 'var(--color-text-tertiary)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center'
                    }}
                    onMouseEnter={e => e.currentTarget.style.background = 'var(--color-bg-base)'}
                    onMouseLeave={e => e.currentTarget.style.background = 'transparent'}
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* Content */}
                <div style={{ flex: 1, display: 'flex', minHeight: 0, position: 'relative' }}>
                    {successMessage && (
                        <div style={{
                            position: 'absolute', top: 12, left: 12, right: 12, zIndex: 10,
                            padding: '12px 16px', background: 'rgba(16,185,129,0.1)',
                            border: '1px solid rgba(16,185,129,0.3)', borderRadius: 8,
                            color: '#059669', fontSize: '0.85rem', fontWeight: 600,
                            display: 'flex', alignItems: 'center', gap: 8,
                            animation: 'slideDown 0.3s ease-out'
                        }}>
                            <CheckCircle2 size={16} />
                            {successMessage}
                        </div>
                    )}

                    {!file ? (
                        <div
                            onDragOver={e => { e.preventDefault(); setDragOver(true); }}
                            onDragLeave={e => { e.preventDefault(); setDragOver(false); }}
                            onDrop={e => { e.preventDefault(); setDragOver(false); const f = e.dataTransfer.files?.[0]; if (f) handleSelectFile(f); }}
                            onClick={() => fileInputRef.current?.click()}
                            style={{
                                flex: 1, display: 'flex', flexDirection: 'column',
                                alignItems: 'center', justifyContent: 'center',
                                margin: 24, borderRadius: 12,
                                border: dragOver ? '2px dashed #0e7490' : '2px dashed var(--color-border)',
                                background: dragOver ? 'rgba(14,116,144,0.02)' : 'var(--color-bg-base)',
                                cursor: 'pointer', transition: 'all 0.2s'
                            }}
                            onMouseEnter={e => { e.currentTarget.style.borderColor = '#0e7490'; }}
                            onMouseLeave={e => { if (!dragOver) e.currentTarget.style.borderColor = 'var(--color-border)'; }}
                        >
                            <input ref={fileInputRef} type="file" accept="image/*" style={{ display: 'none' }}
                                onChange={e => { const f = e.target.files?.[0]; if (f) handleSelectFile(f); }}
                            />
                            <div style={{
                                width: 64, height: 64, borderRadius: '50%',
                                background: 'linear-gradient(135deg, rgba(14,116,144,0.1) 0%, rgba(14,116,144,0.02) 100%)',
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                marginBottom: 16, color: '#0e7490'
                            }}>
                                <Upload size={28} />
                            </div>
                            <h4 style={{ margin: '0 0 8px', fontSize: '1rem', fontWeight: 700 }}>
                                Arraste ou Cole seu Print do Cronograma
                            </h4>
                            <p style={{ margin: '0 0 16px', fontSize: '0.8rem', color: 'var(--color-text-tertiary)', textAlign: 'center', maxWidth: 400, lineHeight: 1.5 }}>
                                Tire um print do cronograma físico-financeiro do edital e use <kbd style={{ padding: '2px 6px', background: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 4, fontSize: '0.75rem', fontWeight: 600 }}>Ctrl + V</kbd> para colar.
                            </p>
                            <button className="btn btn-outline" style={{ fontSize: '0.8rem', padding: '6px 16px' }}>
                                Selecionar Imagem
                            </button>
                            <div style={{ marginTop: 32, display: 'flex', gap: 24, borderTop: '1px solid var(--color-border)', paddingTop: 24, width: '80%', justifyContent: 'space-around' }}>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                                    <Clipboard size={14} color="#0e7490" />
                                    Suporta Ctrl+V do Clipboard
                                </div>
                                <div style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.75rem', color: 'var(--color-text-secondary)' }}>
                                    <CheckCircle2 size={14} color="#10b981" />
                                    Identifica % e valores por mês
                                </div>
                            </div>
                        </div>
                    ) : (
                        <div style={{ flex: 1, display: 'flex', minHeight: 0 }}>
                            {/* Left: Image Preview */}
                            <div style={{ width: '35%', borderRight: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column', background: 'var(--color-bg-base)' }}>
                                <div style={{ flex: 1, padding: 16, display: 'flex', alignItems: 'center', justifyContent: 'center', minHeight: 0 }}>
                                    {previewUrl && (
                                        <img src={previewUrl} alt="Preview" style={{
                                            maxWidth: '100%', maxHeight: '100%', objectFit: 'contain',
                                            borderRadius: 8, boxShadow: '0 4px 12px rgba(0,0,0,0.08)',
                                            border: '1px solid var(--color-border)'
                                        }} />
                                    )}
                                </div>
                                <div style={{ padding: '12px 16px', borderTop: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'var(--color-bg-surface)' }}>
                                    <span style={{ fontSize: '0.72rem', color: 'var(--color-text-secondary)', fontWeight: 600, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 160 }}>
                                        {file.name}
                                    </span>
                                    <button className="btn btn-outline" onClick={handleClear} style={{ padding: '4px 10px', fontSize: '0.72rem' }}>
                                        Trocar Imagem
                                    </button>
                                </div>
                            </div>

                            {/* Right: Result */}
                            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                                {isLoading ? (
                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 16 }}>
                                        <Loader2 size={36} className="spin" color="#0e7490" />
                                        <div style={{ textAlign: 'center', width: '70%' }}>
                                            <h4 style={{ margin: 0, fontWeight: 700 }}>Processando Cronograma</h4>
                                            <p style={{ margin: '4px 0 12px', fontSize: '0.78rem', color: 'var(--color-text-tertiary)' }}>
                                                Identificando etapas, meses e percentuais de distribuição...
                                            </p>
                                            {progress !== null && (
                                                <div style={{ width: '100%', height: 4, background: 'var(--color-bg-base)', borderRadius: 2, overflow: 'hidden', marginTop: 8 }}>
                                                    <div style={{ width: `${progress}%`, height: '100%', background: '#0e7490', transition: 'width 0.3s ease' }} />
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ) : error ? (
                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: 24, textAlign: 'center' }}>
                                        <AlertTriangle size={36} color="var(--color-danger)" style={{ marginBottom: 12 }} />
                                        <h4 style={{ margin: '0 0 8px', fontWeight: 700, color: 'var(--color-danger)' }}>Erro na extração</h4>
                                        <p style={{ margin: '0 0 16px', fontSize: '0.8rem', color: 'var(--color-text-secondary)', maxWidth: 360, lineHeight: 1.5 }}>{error}</p>
                                        <button className="btn btn-primary" onClick={() => file && extractCronograma(file)} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: '0.8rem' }}>
                                            Tentar Novamente
                                        </button>
                                    </div>
                                ) : extractedData ? (
                                    <div style={{ flex: 1, display: 'flex', flexDirection: 'column', minHeight: 0 }}>
                                        <div style={{ padding: '10px 16px', background: 'var(--color-bg-base)', borderBottom: '1px solid var(--color-border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                                            <span style={{ fontSize: '0.78rem', fontWeight: 700, color: 'var(--color-text-secondary)' }}>
                                                {extractedData.etapas.length} etapas × {extractedData.meses} meses
                                            </span>
                                            <span style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
                                                Revise os valores antes de importar
                                            </span>
                                        </div>
                                        <div style={{ flex: 1, overflowY: 'auto', overflowX: 'auto', minHeight: 0 }}>
                                            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: '0.72rem', minWidth: 400 + extractedData.meses * 56 }}>
                                                <thead style={{ position: 'sticky', top: 0, background: 'var(--color-bg-surface)', borderBottom: '2px solid var(--color-border)', zIndex: 1 }}>
                                                    <tr>
                                                        <th style={{ padding: '8px 8px', textAlign: 'left', fontWeight: 700, color: 'var(--color-text-secondary)', minWidth: 160 }}>Etapa</th>
                                                        <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700, color: 'var(--color-text-secondary)', width: 100 }}>Valor (R$)</th>
                                                        {Array.from({ length: extractedData.meses }, (_, i) => (
                                                            <th key={i} style={{ padding: '8px 4px', textAlign: 'center', fontWeight: 700, color: 'var(--color-text-secondary)', minWidth: 52 }}>
                                                                M{i + 1}
                                                            </th>
                                                        ))}
                                                        <th style={{ padding: '8px 6px', textAlign: 'right', fontWeight: 700, color: 'var(--color-text-secondary)', width: 52 }}>Σ%</th>
                                                    </tr>
                                                </thead>
                                                <tbody>
                                                    {extractedData.etapas.map((etapa: any, idx: number) => {
                                                        const pctSum = etapa.percentuais.slice(0, extractedData.meses).reduce((s: number, p: number) => s + (p || 0), 0);
                                                        return (
                                                            <tr key={idx} style={{ borderBottom: '1px solid var(--color-border)' }}>
                                                                <td style={{ padding: '4px 8px' }}>
                                                                    <input
                                                                        value={etapa.nome}
                                                                        onChange={e => updateEtapa(idx, 'nome', e.target.value)}
                                                                        onFocus={handleFocus} onBlur={handleBlur}
                                                                        style={{ ...inputStyle, fontWeight: 600 }}
                                                                    />
                                                                </td>
                                                                <td style={{ padding: '4px 6px' }}>
                                                                    <input
                                                                        type="number"
                                                                        value={etapa.valorTotal || ''}
                                                                        onChange={e => updateEtapa(idx, 'valorTotal', parseFloat(e.target.value) || 0)}
                                                                        onFocus={handleFocus} onBlur={handleBlur}
                                                                        style={{ ...inputStyle, textAlign: 'right' }}
                                                                    />
                                                                </td>
                                                                {Array.from({ length: extractedData.meses }, (_, m) => (
                                                                    <td key={m} style={{ padding: '4px 2px', textAlign: 'center' }}>
                                                                        <input
                                                                            type="number" min={0} max={100} step={5}
                                                                            value={etapa.percentuais[m] || ''}
                                                                            placeholder="0"
                                                                            onChange={e => updatePercentual(idx, m, parseFloat(e.target.value) || 0)}
                                                                            onFocus={handleFocus} onBlur={handleBlur}
                                                                            style={{
                                                                                ...inputStyle, textAlign: 'center',
                                                                                background: (etapa.percentuais[m] || 0) > 0 ? 'rgba(14,116,144,0.06)' : 'transparent'
                                                                            }}
                                                                        />
                                                                    </td>
                                                                ))}
                                                                <td style={{
                                                                    padding: '4px 6px', textAlign: 'right', fontWeight: 700,
                                                                    color: Math.abs(pctSum - 100) < 0.5 ? 'var(--color-success)' : pctSum > 0 ? '#ca8a04' : 'var(--color-text-tertiary)',
                                                                    fontSize: '0.68rem',
                                                                }}>
                                                                    {pctSum.toFixed(1)}%
                                                                </td>
                                                            </tr>
                                                        );
                                                    })}
                                                </tbody>
                                            </table>
                                        </div>
                                    </div>
                                ) : null}
                            </div>
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div style={{
                    padding: '14px 24px', borderTop: '1px solid var(--color-border)',
                    background: 'var(--color-bg-surface)',
                    display: 'flex', justifyContent: 'space-between', alignItems: 'center'
                }}>
                    <div style={{ fontSize: '0.72rem', color: 'var(--color-text-tertiary)' }}>
                        {!file ? 'Tire um print do cronograma do edital e cole com Ctrl+V.' : 'Revise as etapas e percentuais antes de aplicar.'}
                    </div>
                    <div style={{ display: 'flex', gap: 12 }}>
                        <button onClick={onClose} className="btn btn-outline" style={{ padding: '8px 16px', fontSize: '0.82rem' }}>
                            {file ? 'Cancelar' : 'Fechar'}
                        </button>
                        {extractedData && !isLoading && !error && (
                            <button
                                onClick={handleApplyImport}
                                className="btn btn-primary"
                                style={{ padding: '8px 20px', fontSize: '0.82rem', fontWeight: 600, display: 'flex', alignItems: 'center', gap: 6 }}
                            >
                                Aplicar ao Cronograma <ArrowRight size={14} />
                            </button>
                        )}
                    </div>
                </div>
            </div>
        </div>
    );
}
