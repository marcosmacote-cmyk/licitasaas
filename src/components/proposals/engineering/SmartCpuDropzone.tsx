import React, { useState, useRef } from 'react';
import { UploadCloud, Cpu, Loader2, X } from 'lucide-react';

interface Props {
    onExtract: (file: File) => Promise<void>;
    isExtracting: boolean;
}

export function SmartCpuDropzone({ onExtract, isExtracting }: Props) {
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleDragOver = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(true);
    };

    const handleDragLeave = (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
    };

    const handleDrop = async (e: React.DragEvent) => {
        e.preventDefault();
        setIsDragging(false);
        const file = e.dataTransfer.files[0];
        if (file && (file.type.startsWith('image/') || file.type === 'application/pdf')) {
            await onExtract(file);
        } else {
            alert('Por favor, selecione uma imagem (PNG/JPG) ou PDF.');
        }
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            await onExtract(file);
        }
    };

    const handlePaste = async (e: ClipboardEvent) => {
        const items = e.clipboardData?.items;
        if (!items) return;
        for (const item of Array.from(items)) {
            if (item.type.indexOf('image') === 0) {
                const file = item.getAsFile();
                if (file) {
                    await onExtract(file);
                    break;
                }
            }
        }
    };

    React.useEffect(() => {
        window.addEventListener('paste', handlePaste);
        return () => window.removeEventListener('paste', handlePaste);
    }, [handlePaste]);

    return (
        <div 
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
            onClick={() => fileInputRef.current?.click()}
            style={{
                border: `2px dashed ${isDragging ? 'var(--color-primary)' : 'var(--color-border)'}`,
                background: isDragging ? 'rgba(37,99,235,0.05)' : 'var(--color-bg-base)',
                borderRadius: 'var(--radius-lg)',
                padding: '40px 20px',
                textAlign: 'center',
                cursor: 'pointer',
                transition: 'all 0.2s',
                display: 'flex',
                flexDirection: 'column',
                alignItems: 'center',
                justifyContent: 'center',
                gap: 12,
                position: 'relative'
            }}
        >
            <input 
                type="file" 
                ref={fileInputRef} 
                style={{ display: 'none' }} 
                accept="image/*,application/pdf"
                onChange={handleFileChange}
            />

            {isExtracting ? (
                <>
                    <Loader2 size={32} color="var(--color-primary)" className="spin" />
                    <div style={{ fontWeight: 600 }}>IA extraindo composição...</div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>
                        Lendo a imagem, cruzando itens com bancos oficiais e montando a tabela.
                    </div>
                </>
            ) : (
                <>
                    <div style={{ 
                        width: 48, height: 48, borderRadius: '50%', background: 'var(--color-bg-surface)',
                        display: 'flex', alignItems: 'center', justifyContent: 'center',
                        border: '1px solid var(--color-border)'
                    }}>
                        <Cpu size={24} color="var(--color-ai)" />
                    </div>
                    <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>
                        Arraste um Print (ou cole Ctrl+V) da Composição
                    </div>
                    <div style={{ fontSize: '0.8rem', color: 'var(--color-text-secondary)', maxWidth: 300, lineHeight: 1.4 }}>
                        A IA vai ler a imagem, cruzar os insumos com as bases oficiais e montar a composição própria magicamente.
                    </div>
                </>
            )}
        </div>
    );
}
