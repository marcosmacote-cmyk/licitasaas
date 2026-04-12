import React, { useState, useEffect, useCallback } from 'react';
import { createPortal } from 'react-dom';
import { X, ChevronLeft, ChevronRight, Check } from 'lucide-react';

export interface TourStep {
    target: string; // CSS Selector
    title: string;
    content: React.ReactNode;
    placement?: 'top' | 'bottom' | 'left' | 'right';
}

interface GuidedTourProps {
    id: string; // Unique ID for this tour to track completion in localStorage
    steps: TourStep[];
    isOpen: boolean;
    onComplete: () => void;
    onDismiss: () => void;
}

export function GuidedTour({ id, steps, isOpen, onComplete, onDismiss }: GuidedTourProps) {
    const [currentStep, setCurrentStep] = useState(0);
    const [targetRect, setTargetRect] = useState<DOMRect | null>(null);
    const [windowSize, setWindowSize] = useState({ width: window.innerWidth, height: window.innerHeight });

    // Handle Resize & Scroll calculations
    const updatePosition = useCallback(() => {
        if (!isOpen || !steps[currentStep]) return;
        const el = document.querySelector(steps[currentStep].target);
        if (el) {
            // Smooth scroll to element if not in viewport
            const rect = el.getBoundingClientRect();
            const isInViewport = rect.top >= 0 && rect.left >= 0 && rect.bottom <= window.innerHeight && rect.right <= window.innerWidth;
            if (!isInViewport) {
                el.scrollIntoView({ behavior: 'smooth', block: 'center' });
                // We need to wait for scroll to finish to get the actual rect.
                // A quick timeout approach simulates this.
                setTimeout(() => {
                    const updatedEl = document.querySelector(steps[currentStep].target);
                    if (updatedEl) setTargetRect(updatedEl.getBoundingClientRect());
                }, 350);
            } else {
                setTargetRect(rect);
            }
        } else {
            console.warn(`[GuidedTour] Target not found: ${steps[currentStep].target}`);
            setTargetRect(null); // Fallback to center screen
        }
    }, [isOpen, currentStep, steps, windowSize]);

    useEffect(() => {
        if (!isOpen) return;
        updatePosition();
        
        const handleResizeMap = () => {
            setWindowSize({ width: window.innerWidth, height: window.innerHeight });
        };
        const handleScroll = () => requestAnimationFrame(updatePosition);

        window.addEventListener('resize', handleResizeMap);
        window.addEventListener('scroll', handleScroll, true); // true to catch nested scrolls

        return () => {
            window.removeEventListener('resize', handleResizeMap);
            window.removeEventListener('scroll', handleScroll, true);
        };
    }, [isOpen, updatePosition]);

    // Handle Keyboard Navigation
    useEffect(() => {
        if (!isOpen) return;
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') onDismiss();
            if (e.key === 'ArrowRight') {
                if (currentStep < steps.length - 1) setCurrentStep(v => v + 1);
                else {
                    localStorage.setItem(`tour_${id}_completed`, 'true');
                    onComplete();
                }
            }
            if (e.key === 'ArrowLeft') {
                if (currentStep > 0) setCurrentStep(v => v - 1);
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [isOpen, currentStep, steps.length, id, onComplete, onDismiss]);

    if (!isOpen) return null;

    const step = steps[currentStep];
    const isLast = currentStep === steps.length - 1;

    // Calculate Popover Position
    let popoverStyle: React.CSSProperties = { top: '50%', left: '50%', transform: 'translate(-50%, -50%)', maxWidth: 350 };
    const padding = 8; // padding around target cutout
    
    if (targetRect) {
        const placement = step.placement || 'bottom';
        const gap = 16;
        
        if (placement === 'bottom') {
            popoverStyle = { top: targetRect.bottom + gap, left: Math.max(16, targetRect.left + (targetRect.width / 2) - 175) };
        } else if (placement === 'top') {
            popoverStyle = { bottom: windowSize.height - targetRect.top + gap, left: Math.max(16, targetRect.left + (targetRect.width / 2) - 175) };
        } else if (placement === 'right') {
            popoverStyle = { left: targetRect.right + gap, top: targetRect.top + (targetRect.height / 2) - 75 };
        } else {
            popoverStyle = { right: windowSize.width - targetRect.left + gap, top: targetRect.top + (targetRect.height / 2) - 75 };
        }

        // Keep inside bounds
        popoverStyle.maxWidth = 350;
    }

    return createPortal(
        <div style={{ position: 'fixed', inset: 0, zIndex: 99999, pointerEvents: 'none' }}>
            
            {/* Cutout Highlight using Box Shadow */}
            {targetRect ? (
                <div style={{
                    position: 'absolute',
                    top: targetRect.top - padding,
                    left: targetRect.left - padding,
                    width: targetRect.width + (padding * 2),
                    height: targetRect.height + (padding * 2),
                    borderRadius: 'var(--radius-lg)',
                    boxShadow: '0 0 0 9999px rgba(0, 0, 0, 0.65)',
                    transition: 'all 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                    pointerEvents: 'none',
                    zIndex: 1,
                }} />
            ) : (
                <div style={{
                    position: 'absolute', inset: 0,
                    background: 'rgba(0,0,0,0.65)', transition: 'background 0.3s',
                    zIndex: 1
                }} />
            )}

            {/* Click Catcher to prevent background interaction */}
            <div style={{ position: 'absolute', inset: 0, zIndex: 2, pointerEvents: 'auto' }} />

            {/* Popover */}
            <div style={{
                position: 'absolute',
                ...popoverStyle,
                background: 'var(--color-bg-surface)',
                borderRadius: 'var(--radius-lg)',
                padding: 'var(--space-4)',
                boxShadow: '0 10px 40px rgba(0,0,0,0.3)',
                zIndex: 3,
                pointerEvents: 'auto',
                border: '1px solid var(--color-border)',
                animation: 'peSlideIn 0.3s cubic-bezier(0.16, 1, 0.3, 1)',
                display: 'flex', flexDirection: 'column', gap: 'var(--space-3)'
            }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <h3 style={{ fontSize: '1.05rem', fontWeight: 800, margin: 0, color: 'var(--color-text-primary)' }}>{step.title}</h3>
                    <button onClick={onDismiss} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--color-text-tertiary)', padding: 0 }}>
                        <X size={16} />
                    </button>
                </div>
                
                <div style={{ fontSize: '0.9rem', color: 'var(--color-text-secondary)', lineHeight: 1.6 }}>
                    {step.content}
                </div>

                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 'var(--space-2)' }}>
                    <div style={{ display: 'flex', gap: '4px' }}>
                        {steps.map((_, i) => (
                            <div key={i} style={{
                                width: 8, height: 8, borderRadius: '50%',
                                background: i === currentStep ? 'var(--color-primary)' : 'var(--color-border)',
                                transition: 'background 0.2s'
                            }} />
                        ))}
                    </div>
                    <div style={{ display: 'flex', gap: 'var(--space-2)' }}>
                        <button
                            onClick={() => setCurrentStep(v => Math.max(0, v - 1))}
                            disabled={currentStep === 0}
                            style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'center',
                                width: 32, height: 32, borderRadius: '50%',
                                background: 'transparent', border: '1px solid var(--color-border)',
                                cursor: currentStep === 0 ? 'not-allowed' : 'pointer',
                                opacity: currentStep === 0 ? 0.3 : 1,
                            }}
                        >
                            <ChevronLeft size={16} />
                        </button>
                        <button
                            onClick={() => {
                                if (isLast) {
                                    localStorage.setItem(`tour_${id}_completed`, 'true');
                                    onComplete();
                                } else {
                                    setCurrentStep(v => v + 1);
                                }
                            }}
                            className="btn-primary"
                            style={{ padding: '0 16px', height: 32, fontSize: '0.85rem' }}
                        >
                            {isLast ? <><Check size={14} /> Finalizar</> : <>Próximo <ChevronRight size={14} /></>}
                        </button>
                    </div>
                </div>
            </div>
        </div>,
        document.body
    );
}
