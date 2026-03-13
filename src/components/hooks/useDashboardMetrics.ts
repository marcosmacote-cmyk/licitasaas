import { useState, useMemo, useEffect } from 'react';
import { API_BASE_URL } from '../../config';
import type { BiddingProcess } from '../../types';

// ════════════════════════════════════════
//  useDashboardMetrics — extracted hook
// ════════════════════════════════════════

export interface ExpiringDoc {
  name: string;
  docType: string;
  expirationDate: string;
  companyName: string;
  status: string;
  daysLeft?: number;
}

export interface CriticalAlert {
  type: 'danger' | 'warning' | 'urgency';
  icon: React.ReactNode;
  message: string;
  action: string;
  count?: number;
  dest?: string;
}

interface DashboardMetrics {
  filteredItems: BiddingProcess[];
  totalValue: number;
  wonItems: BiddingProcess[];
  wonValue: number;
  lostItems: BiddingProcess[];
  activeItems: BiddingProcess[];
  totalFinished: number;
  winRate: number;
  captadoItems: BiddingProcess[];
  emAnaliseItems: BiddingProcess[];
  preparandoItems: BiddingProcess[];
  participandoItems: BiddingProcess[];
  todaySessions: BiddingProcess[];
  todayReminders: BiddingProcess[];
  upcomingSessions: BiddingProcess[];
  stalledProcesses: BiddingProcess[];
  needsAiAnalysis: BiddingProcess[];
  expiringDocs: ExpiringDoc[];
  pncpCount: number;
  aiCount: number;
  todayStr: string;
}

export function useDashboardMetrics(items: BiddingProcess[], selectedCompanyId: string): DashboardMetrics {
  const [expiringDocs, setExpiringDocs] = useState<ExpiringDoc[]>([]);

  const filteredItems = useMemo(() => {
    if (!selectedCompanyId) return items;
    return items.filter(i => i.companyProfileId === selectedCompanyId);
  }, [items, selectedCompanyId]);

  const totalValue = filteredItems.reduce((acc, curr) => acc + curr.estimatedValue, 0);
  const wonItems = filteredItems.filter(i => i.status === 'Vencido');
  const wonValue = wonItems.reduce((acc, curr) => acc + curr.estimatedValue, 0);
  const lostItems = filteredItems.filter(i => i.status === 'Perdido');
  const activeItems = filteredItems.filter(i => !['Vencido', 'Perdido', 'Sem Sucesso'].includes(i.status));
  const totalFinished = wonItems.length + lostItems.length;
  const winRate = totalFinished > 0 ? Math.round((wonItems.length / totalFinished) * 100) : 0;

  const captadoItems = filteredItems.filter(i => i.status === 'Captado');
  const emAnaliseItems = filteredItems.filter(i => i.status === 'Em Análise de Edital');
  const preparandoItems = filteredItems.filter(i => i.status === 'Preparando Documentação');
  const participandoItems = filteredItems.filter(i => i.status === 'Participando');

  // Fetch expiring documents
  useEffect(() => {
    const fetchDocs = async () => {
      const token = localStorage.getItem('token');
      if (!token) return;
      try {
        const res = await fetch(`${API_BASE_URL}/api/documents`, {
          headers: { 'Authorization': `Bearer ${token}` }
        });
        if (res.ok) {
          const docs = await res.json();
          const now = new Date();
          const expiring = docs
            .filter((d: any) => d.expirationDate)
            .map((d: any) => {
              const exp = new Date(d.expirationDate);
              const daysLeft = Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
              return {
                ...d,
                daysLeft,
                status: daysLeft < 0 ? 'vencido' : daysLeft <= 15 ? 'critico' : daysLeft <= 30 ? 'alerta' : 'ok'
              };
            })
            .filter((d: any) => d.status !== 'ok')
            .sort((a: any, b: any) => a.daysLeft - b.daysLeft);
          setExpiringDocs(expiring);
        }
      } catch { /* silent */ }
    };
    fetchDocs();
  }, []);

  const today = new Date();
  const todayStr = new Date(today.getTime() - (today.getTimezoneOffset() * 60000)).toISOString().split('T')[0];

  const todaySessions = useMemo(() => {
    return filteredItems.filter(item => {
      if (!item.sessionDate) return false;
      const d = new Date(item.sessionDate);
      const dateKey = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
      return dateKey === todayStr;
    }).sort((a, b) => new Date(a.sessionDate).getTime() - new Date(b.sessionDate).getTime());
  }, [filteredItems, todayStr]);

  const todayReminders = useMemo(() => {
    return filteredItems.filter(item => {
      if (!item.reminderDate || item.reminderStatus !== 'pending') return false;
      const d = new Date(item.reminderDate);
      const dateKey = new Date(d.getTime() - (d.getTimezoneOffset() * 60000)).toISOString().split('T')[0];
      return dateKey === todayStr;
    });
  }, [filteredItems, todayStr]);

  const upcomingSessions = useMemo(() => {
    const now = new Date();
    const in7days = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000);
    return filteredItems.filter(item => {
      if (!item.sessionDate) return false;
      const d = new Date(item.sessionDate);
      return d > now && d <= in7days;
    }).sort((a, b) => new Date(a.sessionDate).getTime() - new Date(b.sessionDate).getTime());
  }, [filteredItems]);

  const stalledProcesses = useMemo(() => {
    const now = new Date();
    return activeItems.filter(item => {
      const updated = new Date(item.sessionDate || new Date().toISOString());
      const daysSinceUpdate = Math.ceil((now.getTime() - updated.getTime()) / (1000 * 60 * 60 * 24));
      return daysSinceUpdate >= 7 && !['Captado'].includes(item.status);
    });
  }, [activeItems]);

  const needsAiAnalysis = useMemo(() => {
    return emAnaliseItems.filter(i => !i.aiAnalysis);
  }, [emAnaliseItems]);

  const pncpCount = items.filter(i => i.portal?.toLowerCase().includes('pncp') || i.link?.toLowerCase().includes('pncp.gov.br')).length;
  const aiCount = items.filter(i => i.aiAnalysis).length;

  return {
    filteredItems, totalValue, wonItems, wonValue, lostItems, activeItems,
    totalFinished, winRate, captadoItems, emAnaliseItems, preparandoItems,
    participandoItems, todaySessions, todayReminders, upcomingSessions,
    stalledProcesses, needsAiAnalysis, expiringDocs, pncpCount, aiCount, todayStr,
  };
}
