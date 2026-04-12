import React from 'react';

interface SkeletonProps {
    className?: string;
    width?: string | number;
    height?: string | number;
    borderRadius?: string | number;
    style?: React.CSSProperties;
    animated?: boolean;
}

export function Skeleton({ 
    className = '', 
    width, 
    height, 
    borderRadius = 'var(--radius-md)', 
    style,
    animated = true
}: SkeletonProps) {
    const baseStyle: React.CSSProperties = {
        width: width || '100%',
        height: height || '20px',
        borderRadius,
        backgroundColor: 'var(--color-bg-base)',
        border: '1px solid var(--color-border)',
        ...style
    };

    return (
        <div 
            className={`skeleton-loader ${animated ? 'skeleton-animate' : ''} ${className}`}
            style={baseStyle}
        />
    );
}

export function SkeletonAvatar({ size = 40, style }: { size?: number, style?: React.CSSProperties }) {
    return (
        <Skeleton 
            width={size} 
            height={size} 
            borderRadius="50%" 
            style={style}
        />
    );
}

export function SkeletonCard({ style }: { style?: React.CSSProperties }) {
    return (
        <div style={{
            display: 'flex', flexDirection: 'column', gap: '12px',
            padding: '16px', border: '1px solid var(--color-border)',
            borderRadius: 'var(--radius-lg)', background: 'var(--color-bg-surface)',
            ...style
        }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <Skeleton width="40%" height="24px" />
                <Skeleton width="60px" height="24px" borderRadius="12px" />
            </div>
            <Skeleton width="100%" height="60px" />
            <div style={{ display: 'flex', gap: '8px', marginTop: 'auto' }}>
                <Skeleton width="80px" height="20px" borderRadius="10px" />
                <Skeleton width="80px" height="20px" borderRadius="10px" />
            </div>
        </div>
    );
}

export function SkeletonTableRow() {
    return (
        <div style={{
            display: 'flex', gap: '16px', alignItems: 'center',
            padding: '12px 16px', borderBottom: '1px solid var(--color-border)',
            background: 'var(--color-bg-surface)'
        }}>
            <SkeletonAvatar size={32} />
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <Skeleton width="30%" height="16px" />
                <Skeleton width="60%" height="12px" />
            </div>
            <Skeleton width="80px" height="24px" borderRadius="12px" />
            <Skeleton width="32px" height="32px" borderRadius="8px" />
        </div>
    );
}

export function PageSkeleton() {
    return (
        <div className="page-fade-enter" style={{ padding: 'var(--page-padding)', display: 'flex', flexDirection: 'column', gap: '24px', width: '100%', maxWidth: '1400px', margin: '0 auto', height: '100%' }}>
            {/* Header / Title area */}
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    <Skeleton width="200px" height="32px" borderRadius="8px" />
                    <Skeleton width="300px" height="16px" borderRadius="4px" />
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                    <Skeleton width="100px" height="36px" borderRadius="18px" />
                    <Skeleton width="140px" height="36px" borderRadius="10px" />
                </div>
            </div>

            {/* Metrics Row */}
            <div style={{ display: 'flex', gap: '16px', marginTop: '8px' }}>
                {[1, 2, 3, 4].map(i => (
                    <div key={i} style={{ flex: 1 }}>
                        <Skeleton height="100px" borderRadius="var(--radius-xl)" />
                    </div>
                ))}
            </div>

            {/* Content Area */}
            <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <Skeleton width="150px" height="24px" borderRadius="6px" />
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: '16px' }}>
                    {[1, 2, 3, 4, 5, 6].map(i => (
                        <SkeletonCard style={{ width: '100%' }} key={i} />
                    ))}
                </div>
            </div>
        </div>
    );
}
