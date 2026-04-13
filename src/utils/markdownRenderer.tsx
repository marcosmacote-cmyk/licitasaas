import React from 'react';

export const renderMarkdown = (text: string) => {
    const lines = text.split('\n');
    const elements: React.ReactNode[] = [];
    let listItems: React.ReactNode[] = [];
    let listType: 'ol' | 'ul' | null = null;
    let key = 0;

    const flushList = () => {
        if (listItems.length > 0 && listType) {
            const ListTag = listType;
            elements.push(<ListTag key={`list-${key++}`} style={{ margin: '8px 0', paddingLeft: '20px', lineHeight: 1.7 }}>{listItems}</ListTag>);
            listItems = []; listType = null;
        }
    };

    const formatInline = (str: string): React.ReactNode[] => {
        const parts: React.ReactNode[] = [];
        const regex = /\*\*(.+?)\*\*/g;
        let lastIndex = 0; let match; let idx = 0;
        while ((match = regex.exec(str)) !== null) {
            if (match.index > lastIndex) parts.push(str.slice(lastIndex, match.index));
            parts.push(<strong key={`b-${idx++}`} style={{ fontWeight: 700 }}>{match[1]}</strong>);
            lastIndex = regex.lastIndex;
        }
        if (lastIndex < str.length) parts.push(str.slice(lastIndex));
        return parts.length > 0 ? parts : [str];
    };

    for (const line of lines) {
        const trimmed = line.trim();
        const orderedMatch = trimmed.match(/^(\d+)\.\s+(.+)$/);
        if (orderedMatch) { if (listType !== 'ol') { flushList(); listType = 'ol'; } listItems.push(<li key={`li-${key++}`}>{formatInline(orderedMatch[2])}</li>); continue; }
        const bulletMatch = trimmed.match(/^[-•*]\s+(.+)$/);
        if (bulletMatch) { if (listType !== 'ul') { flushList(); listType = 'ul'; } listItems.push(<li key={`li-${key++}`}>{formatInline(bulletMatch[1])}</li>); continue; }
        flushList();
        if (trimmed.startsWith('### ')) { elements.push(<h4 key={`h-${key++}`} style={{ fontWeight: 700, fontSize: '0.95rem', marginTop: '16px', marginBottom: '4px', color: 'var(--color-text-primary)' }}>{formatInline(trimmed.slice(4))}</h4>); continue; }
        if (trimmed.startsWith('## ')) { elements.push(<h3 key={`h-${key++}`} style={{ fontWeight: 700, fontSize: '1.05rem', marginTop: '18px', marginBottom: '6px', color: 'var(--color-text-primary)' }}>{formatInline(trimmed.slice(3))}</h3>); continue; }
        if (trimmed.startsWith('# ')) { elements.push(<h2 key={`h-${key++}`} style={{ fontWeight: 800, fontSize: '1.1rem', marginTop: '20px', marginBottom: '8px', color: 'var(--color-text-primary)' }}>{formatInline(trimmed.slice(2))}</h2>); continue; }
        if (trimmed === '---') { elements.push(<hr key={`hr-${key++}`} style={{ border: 'none', borderTop: '1px solid var(--color-border)', margin: '12px 0' }} />); continue; }
        if (!trimmed) { elements.push(<div key={`br-${key++}`} style={{ height: '8px' }} />); continue; }
        elements.push(<p key={`p-${key++}`} style={{ margin: '4px 0', lineHeight: 1.7 }}>{formatInline(trimmed)}</p>);
    }
    flushList();
    return elements;
};
