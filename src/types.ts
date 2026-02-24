export type BiddingStatus = 'Captado' | 'Em Análise de Edital' | 'Preparando Documentação' | 'Participando' | 'Monitorando' | 'Recurso' | 'Vencido' | 'Sem Sucesso' | 'Perdido';
export type RiskTag = 'Bairro' | 'Baixo' | 'Médio' | 'Alto' | 'Crítico';

export interface ObservationLog {
    id: string;
    text: string;
    timestamp: string;
}

export interface BiddingProcess {
    id: string;
    title: string;
    summary?: string; // Objeto resumido
    status: BiddingStatus;
    estimatedValue: number;
    sessionDate: string;
    modality: string; // Tipo de disputa
    portal: string;
    risk?: RiskTag; // Tag de risco
    link?: string; // Link para acesso ao processo
    companyProfileId?: string; // ID da empresa vinculada
    observations?: string; // JSON stringified ObservationLog[]
    reminderDate?: string;
    reminderStatus?: 'pending' | 'triggered' | 'dismissed';
    reminderType?: 'once' | 'weekdays';
    reminderDays?: string; // JSON array of day numbers [0=Dom, 1=Seg...6=Sáb]
    aiAnalysis?: AiAnalysis | null;
}

export interface AiAnalysis {
    id: string;
    biddingProcessId: string;
    requiredDocuments: string | string[]; // List of required documents (e.g. CND, Balanço), might arrive as stringified JSON
    biddingItems?: string; // Detailed description of items being bidded
    pricingConsiderations: string; // Analysis on pricing rules
    irregularitiesFlags: string | string[]; // List of warnings/red flags, might arrive as stringified JSON
    fullSummary: string; // The complete AI generated text summary
    deadlines?: string | string[]; // List of specific deadlines (impugnação, esclarecimentos, etc)
    penalties?: string; // Analysis on penalties or fines
    qualificationRequirements?: string; // Analysis on technical qualification required
    chatHistory?: string;
    sourceFileNames?: string;
    analyzedAt: string;
}
export const COLUMNS: BiddingStatus[] = [
    'Captado',
    'Em Análise de Edital',
    'Preparando Documentação',
    'Participando',
    'Monitorando',
    'Recurso',
    'Vencido',
    'Sem Sucesso',
];

export interface CompanyProfile {
    id: string;
    cnpj: string;
    razaoSocial: string;
    isHeadquarters: boolean;
    qualification?: string;
    technicalQualification?: string;
    contactName?: string;
    contactEmail?: string;
    contactPhone?: string;
    name?: string; // Alias for razaoSocial used in some components
    documents?: CompanyDocument[]; // Nested documents from backend
    credentials?: CompanyCredential[]; // Nested credentials from backend
}

export type DocumentStatus = 'Válido' | 'Vencendo' | 'Vencido' | 'Alerta' | 'Crítico';

export interface CompanyDocument {
    id: string;
    companyProfileId: string;
    docType: string;
    fileName: string;
    fileUrl: string;
    uploadDate: string;
    expirationDate: string;
    status: DocumentStatus;
    docGroup: string;
    issuerLink?: string;
    alertDays?: number;
}

export interface CompanyCredential {
    id: string;
    companyProfileId: string;
    platform: string;
    url?: string;
    login: string;
    password?: string;
    notes?: string;
    createdAt?: string;
}
