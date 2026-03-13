import { Bell, Calendar, RefreshCw } from 'lucide-react';
import type { BiddingProcess } from '../../types';

interface ReminderConfigProps {
    formData: Partial<BiddingProcess>;
    setFormData: React.Dispatch<React.SetStateAction<Partial<BiddingProcess>>>;
    handleChange: (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement>) => void;
    inputContainerStyle: React.CSSProperties;
    inputInnerStyle: React.CSSProperties;
}

export function ReminderConfig({ formData, setFormData, handleChange, inputContainerStyle, inputInnerStyle }: ReminderConfigProps) {
    return (
        <div style={{
            padding: 'var(--space-6)',
            background: formData.reminderType === 'weekdays'
                ? 'var(--color-urgency-bg)'
                : 'var(--color-warning-bg)',
            borderRadius: 'var(--radius-xl)',
            border: `1px solid ${formData.reminderType === 'weekdays' ? 'var(--color-urgency-border)' : 'var(--color-warning-border)'}`,
            transition: 'var(--transition-normal)'
        }}>
            {/* Header */}
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 'var(--space-4)' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--space-2)', color: 'var(--color-warning-hover)' }}>
                    <Bell size={18} />
                    <span style={{ fontWeight: 'var(--font-semibold)' }}>Lembrete Inteligente</span>
                </div>
                {/* Tipo toggle */}
                <div style={{ display: 'flex', gap: '4px', padding: '3px', background: 'var(--color-bg-secondary)', borderRadius: 'var(--radius-lg)' }}>
                    <button
                        type="button"
                        onClick={() => setFormData(p => ({ ...p, reminderType: 'once' }))}
                        style={{
                            padding: '5px 14px',
                            borderRadius: 'var(--radius-md)',
                            border: 'none',
                            background: formData.reminderType === 'once' ? 'var(--color-bg-surface)' : 'transparent',
                            boxShadow: formData.reminderType === 'once' ? 'var(--shadow-sm)' : 'none',
                            color: formData.reminderType === 'once' ? 'var(--color-text-primary)' : 'var(--color-text-tertiary)',
                            fontSize: 'var(--text-sm)',
                            fontWeight: 'var(--font-semibold)',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                        }}
                    >
                        Único
                    </button>
                    <button
                        type="button"
                        onClick={() => setFormData(p => ({ ...p, reminderType: 'weekdays' }))}
                        style={{
                            padding: '5px 14px',
                            borderRadius: 'var(--radius-md)',
                            border: 'none',
                            background: formData.reminderType === 'weekdays' ? 'var(--color-bg-surface)' : 'transparent',
                            boxShadow: formData.reminderType === 'weekdays' ? 'var(--shadow-sm)' : 'none',
                            color: formData.reminderType === 'weekdays' ? 'var(--color-urgency)' : 'var(--color-text-tertiary)',
                            fontSize: 'var(--text-sm)',
                            fontWeight: 'var(--font-semibold)',
                            cursor: 'pointer',
                            transition: 'all 0.2s'
                        }}
                    >
                        <span style={{ display: 'flex', alignItems: 'center', gap: '4px' }}>
                            <RefreshCw size={11} /> Recorrente
                        </span>
                    </button>
                </div>
            </div>

            {/* Date/Time row */}
            <div style={{ display: 'flex', gap: '16px', alignItems: 'center', marginBottom: formData.reminderType === 'weekdays' ? '16px' : '0' }}>
                <div style={{ ...inputContainerStyle, flex: 1, backgroundColor: 'var(--color-bg-surface)' }}>
                    <Calendar size={16} color="var(--color-warning-hover)" />
                    <input
                        type={formData.reminderType === 'weekdays' ? 'time' : 'datetime-local'}
                        name="reminderDate"
                        style={inputInnerStyle}
                        value={formData.reminderType === 'weekdays'
                            ? (formData.reminderDate ? formData.reminderDate.slice(11, 16) : '')
                            : (formData.reminderDate || '')
                        }
                        onChange={(e) => {
                            if (formData.reminderType === 'weekdays') {
                                const today = new Date();
                                const [h, m] = e.target.value.split(':');
                                today.setHours(parseInt(h), parseInt(m), 0, 0);
                                today.setMinutes(today.getMinutes() - today.getTimezoneOffset());
                                setFormData(prev => ({ ...prev, reminderDate: today.toISOString().slice(0, 16) }));
                            } else {
                                handleChange(e);
                            }
                        }}
                    />
                </div>
                <p style={{ margin: 0, fontSize: 'var(--text-base)', color: 'var(--color-warning-hover)', maxWidth: '260px', lineHeight: 1.4 }}>
                    {formData.reminderType === 'weekdays'
                        ? 'Horário do alarme nos dias selecionados abaixo.'
                        : 'Um aviso será disparado para toda a equipe no horário configurado.'
                    }
                </p>
            </div>

            {/* Weekday selector (shown only in recurring mode) */}
            {formData.reminderType === 'weekdays' && <WeekdaySelector formData={formData} setFormData={setFormData} />}
        </div>
    );
}

// ── Weekday Selector ──

function WeekdaySelector({ formData, setFormData }: { formData: Partial<BiddingProcess>; setFormData: React.Dispatch<React.SetStateAction<Partial<BiddingProcess>>> }) {
    const selectedDays: number[] = (() => {
        try { return JSON.parse(formData.reminderDays || '[]'); } catch { return []; }
    })();
    const dayLabels = [
        { num: 1, short: 'Seg', long: 'Segunda' },
        { num: 2, short: 'Ter', long: 'Terça' },
        { num: 3, short: 'Qua', long: 'Quarta' },
        { num: 4, short: 'Qui', long: 'Quinta' },
        { num: 5, short: 'Sex', long: 'Sexta' },
        { num: 6, short: 'Sáb', long: 'Sábado' },
        { num: 0, short: 'Dom', long: 'Domingo' },
    ];
    const toggleDay = (day: number) => {
        const newDays = selectedDays.includes(day)
            ? selectedDays.filter(d => d !== day)
            : [...selectedDays, day];
        setFormData(prev => ({ ...prev, reminderDays: JSON.stringify(newDays) }));
    };
    const weekdaysOnly = [1, 2, 3, 4, 5];
    const allDays = [0, 1, 2, 3, 4, 5, 6];
    const isWeekdaysSelected = weekdaysOnly.every(d => selectedDays.includes(d)) && selectedDays.length === 5;
    const isAllSelected = allDays.every(d => selectedDays.includes(d));

    return (
        <div>
            <div style={{ display: 'flex', gap: '6px', marginBottom: '10px' }}>
                {dayLabels.map(day => (
                    <button
                        key={day.num}
                        type="button"
                        onClick={() => toggleDay(day.num)}
                        title={day.long}
                        style={{
                            flex: 1,
                            padding: '8px 0',
                            borderRadius: 'var(--radius-lg)',
                            border: `2px solid ${selectedDays.includes(day.num) ? 'var(--color-warning)' : 'var(--color-border)'}`,
                            background: selectedDays.includes(day.num)
                                ? 'linear-gradient(135deg, var(--color-warning), var(--color-warning-hover))'
                                : 'var(--color-bg-surface)',
                            color: selectedDays.includes(day.num) ? 'white' : 'var(--color-text-tertiary)',
                            fontSize: '0.75rem',
                            fontWeight: 700,
                            cursor: 'pointer',
                            transition: 'var(--transition-fast)',
                            boxShadow: selectedDays.includes(day.num) ? '0 2px 8px rgba(245, 158, 11, 0.3)' : 'none'
                        }}
                    >
                        {day.short}
                    </button>
                ))}
            </div>
            {/* Quick presets */}
            <div style={{ display: 'flex', gap: '8px' }}>
                <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, reminderDays: JSON.stringify(weekdaysOnly) }))}
                    style={{
                        padding: '4px 12px', borderRadius: 'var(--radius-md)',
                        border: `1px solid ${isWeekdaysSelected ? 'var(--color-warning)' : 'var(--color-border)'}`,
                        background: isWeekdaysSelected ? 'var(--color-warning-bg)' : 'var(--color-bg-surface)',
                        color: isWeekdaysSelected ? 'var(--color-warning-hover)' : 'var(--color-text-secondary)',
                        fontSize: '0.6875rem', fontWeight: 600, cursor: 'pointer'
                    }}
                >
                    Dias úteis
                </button>
                <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, reminderDays: JSON.stringify(allDays) }))}
                    style={{
                        padding: '4px 12px', borderRadius: 'var(--radius-md)',
                        border: `1px solid ${isAllSelected ? 'var(--color-warning)' : 'var(--color-border)'}`,
                        background: isAllSelected ? 'var(--color-warning-bg)' : 'var(--color-bg-surface)',
                        color: isAllSelected ? 'var(--color-warning-hover)' : 'var(--color-text-secondary)',
                        fontSize: '0.6875rem', fontWeight: 600, cursor: 'pointer'
                    }}
                >
                    Todos os dias
                </button>
                <button
                    type="button"
                    onClick={() => setFormData(prev => ({ ...prev, reminderDays: '[]' }))}
                    style={{
                        padding: '4px 12px', borderRadius: 'var(--radius-md)',
                        border: '1px solid var(--color-border)',
                        background: 'var(--color-bg-surface)',
                        color: 'var(--color-text-tertiary)',
                        fontSize: '0.6875rem', fontWeight: 600, cursor: 'pointer'
                    }}
                >
                    Limpar
                </button>
            </div>
        </div>
    );
}
