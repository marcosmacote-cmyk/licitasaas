import React, { useState, useRef, useEffect } from 'react';
import {
    Search, Plus, FileText, Trash2, Edit2,
    ExternalLink, Eye, EyeOff, Building2, KeyRound,
    ShieldAlert, Clock, CheckCircle2
} from 'lucide-react';
import { API_BASE_URL } from '../config';
import type { CompanyProfile, CompanyDocument, DocumentStatus, CompanyCredential } from '../types';
import { CompanyFormModal } from './CompanyFormModal';
import { DocumentFormModal } from './DocumentFormModal';
import { CredentialFormModal } from './CredentialFormModal';
import { Badge, useToast, ConfirmDialog } from './ui';

export const MOCK_COMPANIES: CompanyProfile[] = [
    { id: '1', cnpj: '12.345.678/0001-90', razaoSocial: 'Tech Solutions Matriz LTDA', isHeadquarters: true },
    { id: '2', cnpj: '12.345.678/0002-71', razaoSocial: 'Tech Solutions Filial SP', isHeadquarters: false },
    { id: '3', cnpj: '98.765.432/0001-10', razaoSocial: 'Inova Services Parceira SA', isHeadquarters: false },
];

interface Props {
    companies: CompanyProfile[];
    setCompanies: React.Dispatch<React.SetStateAction<CompanyProfile[]>>;
}

export function DocumentsPage({ companies, setCompanies }: Props) {
    const toast = useToast();
    const [confirmAction, setConfirmAction] = useState<{ type: 'company' | 'document' | 'credential'; id: string; label: string } | null>(null);
    const [documents, setDocuments] = useState<CompanyDocument[]>([]);

    useEffect(() => {
        const allDocs = companies.flatMap(c => c.documents || []);
        // Sort by upload date descending
        allDocs.sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime());
        setDocuments(allDocs);
    }, [companies]);
    const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');

    // Auto-select first company if none selected or selection invalid
    useEffect(() => {
        if (companies.length > 0) {
            const currentValid = companies.some(c => c.id === selectedCompanyId);
            if (!selectedCompanyId || !currentValid) {
                setSelectedCompanyId(companies[0].id);
            }
        }
    }, [companies, selectedCompanyId]);
    const [searchTerm, setSearchTerm] = useState('');

    // Modal State
    const [isCompanyModalOpen, setIsCompanyModalOpen] = useState(false);
    const [editingCompany, setEditingCompany] = useState<CompanyProfile | null>(null);
    const [isDocumentModalOpen, setIsDocumentModalOpen] = useState(false);
    const [editingDocument, setEditingDocument] = useState<CompanyDocument | null>(null);
    const [isCredentialModalOpen, setIsCredentialModalOpen] = useState(false);
    const [editingCredential, setEditingCredential] = useState<CompanyCredential | null>(null);
    const [activeTab, setActiveTab] = useState<'documents' | 'credentials'>('documents');
    const [showPasswords, setShowPasswords] = useState<Record<string, boolean>>({});

    // Sorting State
    const [sortField, setSortField] = useState<'docType' | 'expirationDate' | 'status' | 'docGroup'>('expirationDate');
    const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');

    // Alert Config State
    const [isAlertConfigOpen, setIsAlertConfigOpen] = useState(false);
    const [defaultAlertDays, setDefaultAlertDays] = useState<number | ''>(15);
    const [groupAlertDays, setGroupAlertDays] = useState<Record<string, number | ''>>({});
    const [applyToExisting, setApplyToExisting] = useState(false);

    const DOCUMENT_GROUPS = [
        'Habilitação Jurídica',
        'Regularidade Fiscal, Social e Trabalhista',
        'Qualificação Técnica',
        'Qualificação Econômica Financeira',
        'Outros'
    ];

    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/api/config/alerts`, {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setDefaultAlertDays(data.defaultAlertDays || 15);
                    setGroupAlertDays(data.groupAlertDays || {});
                }
            } catch (err) {
                console.error("Failed to fetch alert config", err);
            }
        };
        fetchConfig();
    }, []);

    const fileInputRef = useRef<HTMLInputElement>(null);

    const activeCompany = companies.find(c => c.id === selectedCompanyId);

    const filteredDocs = documents
        .filter((d: CompanyDocument) =>
            d.companyProfileId === selectedCompanyId &&
            (d.docType.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (d.docGroup || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (d.issuerLink || '').toLowerCase().includes(searchTerm.toLowerCase()))
        )
        .sort((a, b) => {
            let valA: any = a[sortField] || '';
            let valB: any = b[sortField] || '';

            if (sortField === 'expirationDate') {
                valA = new Date(valA).getTime();
                valB = new Date(valB).getTime();
            }

            if (valA < valB) return sortOrder === 'asc' ? -1 : 1;
            if (valA > valB) return sortOrder === 'asc' ? 1 : -1;
            return 0;
        });

    const handleToggleSort = (field: 'docType' | 'expirationDate' | 'status' | 'docGroup') => {
        if (sortField === field) {
            setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortOrder('asc');
        }
    };

    const handleSaveAlertConfig = async () => {
        const finalDefault = (typeof defaultAlertDays === 'number' && !isNaN(defaultAlertDays)) ? defaultAlertDays : 15;
        const finalGroup: Record<string, number> = {};
        for (const [k, v] of Object.entries(groupAlertDays)) {
            finalGroup[k] = (typeof v === 'number' && !isNaN(v)) ? v : finalDefault;
        }

        try {
            const res = await fetch(`${API_BASE_URL}/api/config/alerts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({ defaultAlertDays: finalDefault, groupAlertDays: finalGroup, applyToExisting })
            });

            if (res.status === 401 || res.status === 403) {
                toast.error('Sua sessão expirou. Recarregando...');
                window.location.reload();
                return;
            }

            if (res.ok) {
                setIsAlertConfigOpen(false);
                if (applyToExisting) {
                    const resCompanies = await fetch(`${API_BASE_URL}/api/companies`, {
                        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                    });
                    if (resCompanies.ok) {
                        const data = await resCompanies.json();
                        setCompanies(data);
                    }
                    toast.success("Configuração salva! Prazos aplicados aos documentos.");
                } else {
                    toast.success("Configuração de alertas salva com sucesso!");
                }
            } else {
                let errorData: any = null;
                try { errorData = await res.json(); } catch (e) { }
                let errorMsg = "Erro desconhecido do servidor (resposta não-JSON)";
                if (errorData) {
                    errorMsg = errorData.error || errorData.message || (Object.keys(errorData).length > 0 ? JSON.stringify(errorData) : "Erro de resposta vazia do servidor");
                }
                toast.error(`Erro ao salvar configuração: ${errorMsg}`);
            }
        } catch (err: any) {
            console.error("Failed to save alert config", err);
            toast.error(`Erro na requisição: ${err.message || String(err)}`);
        }
    };

    const sanitizedDefault = typeof defaultAlertDays === 'number' && !isNaN(defaultAlertDays) ? defaultAlertDays : 15;
    const sanitizedGroup = Object.fromEntries(Object.entries(groupAlertDays).map(([k, v]) => [k, typeof v === 'number' && !isNaN(v) ? v : sanitizedDefault]));

    const handleCreateCompany = () => {
        setEditingCompany(null);
        setIsCompanyModalOpen(true);
    };

    const handleEditCompany = (company: CompanyProfile) => {
        setEditingCompany(company);
        setIsCompanyModalOpen(true);
    };

    const handleDeleteCompany = (companyId: string) => {
        const comp = companies.find(c => c.id === companyId);
        setConfirmAction({ type: 'company', id: companyId, label: comp?.razaoSocial || 'esta empresa' });
    };

    const executeDelete = async () => {
        if (!confirmAction) return;
        const { type, id } = confirmAction;
        setConfirmAction(null);

        if (type === 'company') {
            try {
                const res = await fetch(`${API_BASE_URL}/api/companies/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                });
                if (res.status === 401 || res.status === 403) { toast.error('Sessão expirada.'); window.location.reload(); return; }
                if (!res.ok) throw new Error('Delete failed');
                setCompanies((prev: CompanyProfile[]) => prev.filter((c: CompanyProfile) => c.id !== id));
                setDocuments((prev: CompanyDocument[]) => prev.filter((d: CompanyDocument) => d.companyProfileId !== id));
                if (selectedCompanyId === id) setSelectedCompanyId('');
                toast.success('Empresa excluída com sucesso.');
            } catch (err) {
                console.error(err);
                toast.error('Erro ao excluir empresa.');
            }
        } else if (type === 'document') {
            try {
                const res = await fetch(`${API_BASE_URL}/api/documents/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                });
                if (res.status === 401 || res.status === 403) { toast.error('Sessão expirada.'); window.location.reload(); return; }
                if (res.ok) {
                    setDocuments(prev => prev.filter(d => d.id !== id));
                    toast.success('Documento excluído.');
                }
            } catch (err) {
                console.error(err);
                toast.error('Erro ao excluir documento.');
            }
        } else if (type === 'credential') {
            try {
                const res = await fetch(`${API_BASE_URL}/api/credentials/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                });
                if (res.status === 401 || res.status === 403) { toast.error('Sessão expirada.'); window.location.reload(); return; }
                if (!res.ok) throw new Error('Failed to delete credential');
                setCompanies(prev => prev.map(c =>
                    c.id === selectedCompanyId
                        ? { ...c, credentials: c.credentials?.filter(cr => cr.id !== id) }
                        : c
                ));
                toast.success('Credencial excluída.');
            } catch (err) {
                console.error(err);
                toast.error('Erro ao excluir credencial.');
            }
        }
    };

    const handleSaveCompany = async (companyData: Partial<CompanyProfile>) => {
        try {
            if (editingCompany && editingCompany.id) {
                const res = await fetch(`${API_BASE_URL}/api/companies/${editingCompany.id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    },
                    body: JSON.stringify(companyData)
                });

                if (res.status === 401 || res.status === 403) {
                    toast.error('Sessão expirada.');
                    window.location.reload();
                    return;
                }

                if (!res.ok) throw new Error("Failed to update company");
                const updatedCompany = await res.json();
                setCompanies((prev: CompanyProfile[]) => prev.map((c: CompanyProfile) => c.id === editingCompany.id ? updatedCompany : c));
            } else {
                // Create
                const res = await fetch(`${API_BASE_URL}/api/companies`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    },
                    body: JSON.stringify(companyData)
                });

                if (res.status === 401 || res.status === 403) {
                    toast.error('Sessão expirada.');
                    window.location.reload();
                    return;
                }

                if (!res.ok) throw new Error("Failed to create company");
                const newCompany = await res.json();
                setCompanies((prev: CompanyProfile[]) => [...prev, newCompany]);
                setSelectedCompanyId(newCompany.id); // Auto-select new company
            }
            setIsCompanyModalOpen(false);
        } catch (err) {
            console.error(err);
            toast.error('Erro ao salvar empresa no servidor.');
        }
    };

    const handleCreateDocument = () => {
        setEditingDocument(null);
        setIsDocumentModalOpen(true);
    };

    const handleEditDocument = (doc: CompanyDocument) => {
        setEditingDocument(doc);
        setIsDocumentModalOpen(true);
    };

    const handleDeleteDocument = (docId: string) => {
        const doc = documents.find(d => d.id === docId);
        setConfirmAction({ type: 'document', id: docId, label: doc?.docType || 'este documento' });
    };

    const handleSaveDocument = async (docData: Partial<CompanyDocument>, file?: File) => {
        const formData = new FormData();
        if (file) formData.append('file', file);

        formData.append('docType', docData.docType || '');
        formData.append('docGroup', docData.docGroup || 'Outros');
        formData.append('issuerLink', docData.issuerLink || '');
        formData.append('expirationDate', docData.expirationDate || '');
        formData.append('status', docData.status || 'Válido');
        const defaultAlertForGroup = groupAlertDays[docData.docGroup || 'Outros'] || defaultAlertDays;
        formData.append('alertDays', String(docData.alertDays || defaultAlertForGroup));

        if (editingDocument && editingDocument.id) {
            try {
                const res = await fetch(`${API_BASE_URL}/api/documents/${editingDocument.id}`, {
                    method: 'PUT',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                    body: formData
                });

                if (res.status === 401 || res.status === 403) {
                    toast.error('Sessão expirada.');
                    window.location.reload();
                    return;
                }

                if (!res.ok) throw new Error("Failed to update document");
                const updatedDoc = await res.json();
                setDocuments(prev => prev.map(d => d.id === editingDocument.id ? updatedDoc : d));

                // Sync with parent companies state
                setCompanies(prev => prev.map(c =>
                    c.id === selectedCompanyId
                        ? { ...c, documents: c.documents?.map(d => d.id === editingDocument.id ? updatedDoc : d) }
                        : c
                ));

                setIsDocumentModalOpen(false);
            } catch (err) {
                console.error(err);
                toast.error('Erro ao atualizar documento.');
            }
        } else {
            // Create New
            if (!file) {
                toast.warning('O arquivo PDF é obrigatório.');
                return;
            }
            try {
                formData.append('companyProfileId', docData.companyProfileId!);

                const res = await fetch(`${API_BASE_URL}/api/documents`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                    body: formData
                });

                if (res.status === 401 || res.status === 403) {
                    toast.error('Sessão expirada.');
                    window.location.reload();
                    return;
                }

                if (!res.ok) {
                    const errorData = await res.json().catch(() => ({}));
                    throw new Error(errorData.details || errorData.error || "Upload failed");
                }
                const newDoc = await res.json();
                setDocuments(prev => [newDoc, ...prev]);

                // Sync with parent companies state
                setCompanies(prev => prev.map(c =>
                    c.id === selectedCompanyId
                        ? { ...c, documents: [newDoc, ...(c.documents || [])] }
                        : c
                ));

                setIsDocumentModalOpen(false);
            } catch (err) {
                console.error(err);
                toast.error(`Falha ao salvar documento: ${err instanceof Error ? err.message : String(err)}`);
            }
        }
    };

    const handleCreateCredential = () => {
        setEditingCredential(null);
        setIsCredentialModalOpen(true);
    };

    const handleEditCredential = (cred: CompanyCredential) => {
        setEditingCredential(cred);
        setIsCredentialModalOpen(true);
    };

    const handleSaveCredential = async (credData: Partial<CompanyCredential>) => {
        try {
            if (editingCredential && editingCredential.id) {
                // Update
                const res = await fetch(`${API_BASE_URL}/api/credentials/${editingCredential.id}`, {
                    method: 'PUT',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    },
                    body: JSON.stringify(credData)
                });

                if (res.status === 401 || res.status === 403) {
                    toast.error('Sessão expirada.');
                    window.location.reload();
                    return;
                }

                if (!res.ok) throw new Error("Failed to update credential");
                const updatedCred = await res.json();

                setCompanies(prev => prev.map(c =>
                    c.id === selectedCompanyId
                        ? { ...c, credentials: c.credentials?.map(cr => cr.id === editingCredential.id ? updatedCred : cr) }
                        : c
                ));
            } else {
                // Create
                const res = await fetch(`${API_BASE_URL}/api/credentials`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'application/json',
                        'Authorization': `Bearer ${localStorage.getItem('token')}`
                    },
                    body: JSON.stringify({ ...credData, companyProfileId: selectedCompanyId })
                });

                if (res.status === 401 || res.status === 403) {
                    toast.error('Sessão expirada.');
                    window.location.reload();
                    return;
                }

                if (!res.ok) throw new Error("Failed to create credential");
                const newCred = await res.json();

                setCompanies(prev => prev.map(c =>
                    c.id === selectedCompanyId
                        ? { ...c, credentials: [newCred, ...(c.credentials || [])] }
                        : c
                ));
            }
            setIsCredentialModalOpen(false);
        } catch (err) {
            console.error(err);
            toast.error('Erro ao salvar credencial.');
        }
    };

    const handleDeleteCredential = (id: string) => {
        const cred = activeCompany?.credentials?.find(c => c.id === id);
        setConfirmAction({ type: 'credential', id, label: cred?.platform || 'esta credencial' });
    };

    const togglePasswordVisibility = (id: string) => {
        setShowPasswords(prev => ({ ...prev, [id]: !prev[id] }));
    };

    const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (!file || !activeCompany) return;

        try {
            const formData = new FormData();
            formData.append('file', file);
            formData.append('companyProfileId', activeCompany.id);
            formData.append('docType', 'Documento Adicionado Rapidamente');
            const expDate = new Date(Date.now() + 90 * 24 * 60 * 60 * 1000).toISOString();
            formData.append('expirationDate', expDate);
            formData.append('status', 'Válido');
            formData.append('alertDays', '15');

            const res = await fetch(`${API_BASE_URL}/api/documents`, {
                method: 'POST',
                headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                body: formData
            });

            if (res.status === 401 || res.status === 403) {
                toast.error('Sessão expirada.');
                window.location.reload();
                return;
            }

            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.details || errorData.error || "Fast upload failed");
            }
            const newDoc = await res.json();
            setDocuments((prev: CompanyDocument[]) => [newDoc, ...prev]);
        } catch (err) {
            console.error(err);
            toast.error(`Erro no upload rápido: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    return (
        <>
        <div className="page-container" style={{ display: 'flex', flexDirection: 'row', gap: 'var(--space-6)', paddingRight: 'var(--space-6)' }}>

            {/* Sidebar: Companies List */}
            <div style={{ width: '300px', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <div className="flex-between">
                    <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--font-semibold)', color: 'var(--color-text-primary)' }}>Empresas</h2>
                    <button className="icon-btn" onClick={handleCreateCompany} title="Cadastrar Nova Empresa" style={{ background: 'var(--color-primary)', color: 'white', padding: '6px' }}>
                        <Plus size={16} />
                    </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {companies.map((company: CompanyProfile) => (
                        <div
                            key={company.id}
                            onClick={() => setSelectedCompanyId(company.id)}
                            style={{
                                padding: 'var(--space-4)',
                                backgroundColor: selectedCompanyId === company.id ? 'var(--color-primary-light)' : 'var(--color-bg-surface)',
                                border: `1px solid ${selectedCompanyId === company.id ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                borderRadius: 'var(--radius-lg)',
                                cursor: 'pointer',
                                transition: 'var(--transition-fast)',
                            }}
                        >
                            <div className="flex-between" style={{ marginBottom: '8px' }}>
                                <div className="flex-gap" style={{ color: selectedCompanyId === company.id ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
                                    <Building2 size={16} />
                                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', textTransform: 'uppercase' }}>
                                        {company.isHeadquarters ? 'Matriz' : 'Filial'}
                                    </span>
                                </div>
                                <div className="flex-gap" onClick={(e) => e.stopPropagation()}>
                                    <button className="icon-btn" onClick={() => handleEditCompany(company)} title="Editar Empresa" style={{ padding: '2px' }}>
                                        <Edit2 size={14} color="var(--color-text-secondary)" />
                                    </button>
                                    <button className="icon-btn" onClick={() => handleDeleteCompany(company.id)} title="Excluir Empresa" style={{ padding: '2px' }}>
                                        <Trash2 size={14} color="var(--color-danger)" />
                                    </button>
                                </div>
                            </div>
                            <div style={{ fontWeight: 'var(--font-semibold)', color: 'var(--color-text-primary)', marginBottom: '4px', fontSize: 'var(--text-base)' }}>
                                {company.razaoSocial}
                            </div>
                            <div style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-tertiary)' }}>
                                CNPJ: {company.cnpj}
                            </div>
                        </div>
                    ))}
                    {companies.length === 0 && (
                        <div style={{ textAlign: 'center', padding: '32px 16px', background: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px dashed var(--color-border)' }}>
                            <p style={{ fontSize: '0.875rem', color: 'var(--color-text-tertiary)', margin: 0 }}>Nenhuma empresa cadastrada ainda.</p>
                        </div>
                    )}
                </div>
            </div>

            {/* Main Content: Documents Table */}
            <div style={{ flex: 1, backgroundColor: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column' }}>
                {activeCompany ? (
                    <>
                        <div style={{ padding: 'var(--space-6)', borderBottom: '1px solid var(--color-border)' }}>
                            <div className="flex-between" style={{ marginBottom: 'var(--space-6)' }}>
                                <div>
                                    <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--font-semibold)', color: 'var(--color-text-primary)' }}>
                                        {activeCompany.razaoSocial}
                                    </h2>
                                    <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-md)' }}>
                                        CNPJ: {activeCompany.cnpj}
                                    </p>
                                </div>
                                <div className="flex-gap" style={{ background: 'var(--color-bg-surface-hover)', padding: '4px', borderRadius: 'var(--radius-md)' }}>
                                    <button
                                        className={`tab-btn${activeTab === 'documents' ? ' active' : ''}`}
                                        onClick={() => setActiveTab('documents')}
                                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                                    >
                                        <FileText size={16} /> Documentos
                                    </button>
                                    <button
                                        className={`tab-btn${activeTab === 'credentials' ? ' active' : ''}`}
                                        onClick={() => setActiveTab('credentials')}
                                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                                    >
                                        <KeyRound size={16} /> Acessos e Senhas
                                    </button>
                                </div>
                            </div>

                            {activeTab === 'documents' && (
                                <div className="flex-between">
                                    <div className="flex-gap" style={{ background: 'var(--color-bg-surface-hover)', padding: '8px 16px', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-border)', width: '300px' }}>
                                        <Search size={16} color="var(--color-text-secondary)" />
                                        <input
                                            type="text"
                                            placeholder="Buscar por tipo de documento..."
                                            style={{ border: 'none', background: 'transparent', outline: 'none', color: 'var(--color-text-primary)', flex: 1, fontSize: 'var(--text-md)' }}
                                            value={searchTerm}
                                            onChange={(e) => setSearchTerm(e.target.value)}
                                        />
                                    </div>
                                    <div className="flex-gap">
                                        <button
                                            className={`btn btn-outline ${isAlertConfigOpen ? 'active' : ''}`}
                                            onClick={() => setIsAlertConfigOpen(true)}
                                            style={{ gap: '8px' }}
                                        >
                                            <ShieldAlert size={16} /> Configurar Alertas
                                        </button>
                                        <input
                                            type="file"
                                            style={{ display: 'none' }}
                                            ref={fileInputRef}
                                            onChange={handleFileChange}
                                            accept=".pdf,.png,.jpg,.jpeg"
                                        />
                                        <button className="btn btn-primary" onClick={handleCreateDocument}>
                                            <Plus size={16} />
                                            Novo Documento
                                        </button>
                                    </div>
                                </div>
                            )}

                            {activeTab === 'credentials' && (
                                <div className="flex-between">
                                    <div></div>
                                    <button className="btn btn-primary" onClick={handleCreateCredential} style={{ backgroundColor: 'var(--color-success)', borderColor: 'var(--color-success)' }}>
                                        <Plus size={16} /> Nova Credencial
                                    </button>
                                </div>
                            )}
                        </div>

                        <div style={{ overflowX: 'auto', flex: 1 }}>
                            {activeTab === 'documents' && (
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                    <thead>
                                        <tr style={{ backgroundColor: 'var(--color-bg-surface-hover)', borderBottom: '1px solid var(--color-border)' }}>
                                            <th className="docs-th" style={{ cursor: 'pointer' }} onClick={() => handleToggleSort('docType')}>
                                                <div className="flex-gap">Documento {sortField === 'docType' && (sortOrder === 'asc' ? '↑' : '↓')}</div>
                                            </th>
                                            <th className="docs-th" style={{ cursor: 'pointer' }} onClick={() => handleToggleSort('status')}>
                                                <div className="flex-gap">Status {sortField === 'status' && (sortOrder === 'asc' ? '↑' : '↓')}</div>
                                            </th>
                                            <th className="docs-th" style={{ cursor: 'pointer' }} onClick={() => handleToggleSort('expirationDate')}>
                                                <div className="flex-gap">Vencimento {sortField === 'expirationDate' && (sortOrder === 'asc' ? '↑' : '↓')}</div>
                                            </th>
                                            <th className="docs-th">Órgão / Link</th>
                                            <th className="docs-th">Arquivo</th>
                                            <th className="docs-th"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {filteredDocs.length === 0 ? (
                                            <tr>
                                                <td colSpan={6} style={{ padding: '48px', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                                                    Nenhum documento encontrado para esta empresa.
                                                </td>
                                            </tr>
                                        ) : (
                                            filteredDocs.map((doc: CompanyDocument) => (
                                                <tr key={doc.id} style={{ borderBottom: '1px solid var(--color-border)' }} className="table-row-hover">
                                                    <td className="docs-td">
                                                        <div style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>{doc.docType}</div>
                                                        <div style={{ fontSize: '0.7rem', display: 'inline-block', padding: '2px 6px', borderRadius: '4px', backgroundColor: 'var(--color-bg-base)', border: '1px solid var(--color-border)', marginTop: '4px', color: 'var(--color-text-secondary)' }}>
                                                            {doc.docGroup}
                                                        </div>
                                                    </td>
                                                    <td className="docs-td">
                                                        <StatusBadge status={doc.status} />
                                                    </td>
                                                    <td className="docs-td">
                                                        <div className="flex-gap" style={{ color: doc.status === 'Vencido' ? 'var(--color-danger)' : 'var(--color-text-primary)' }}>
                                                            <Clock size={16} />
                                                            {new Date(doc.expirationDate).toLocaleDateString('pt-BR')}
                                                        </div>
                                                    </td>
                                                    <td className="docs-td">
                                                        {doc.issuerLink ? (
                                                            <a href={doc.issuerLink} target="_blank" rel="noopener noreferrer" className="flex-gap" style={{ color: 'var(--color-primary)', fontSize: '0.875rem' }}>
                                                                <ExternalLink size={14} />
                                                                Portal Emissor
                                                            </a>
                                                        ) : (
                                                            <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>-</span>
                                                        )}
                                                    </td>
                                                    <td className="docs-td">
                                                        <a
                                                            href={doc.fileUrl.startsWith('http') ? doc.fileUrl : `${API_BASE_URL}${doc.fileUrl}`}
                                                            target="_blank"
                                                            rel="noopener noreferrer"
                                                            className="flex-gap"
                                                            style={{ color: 'var(--color-primary)', cursor: 'pointer', textDecoration: 'none' }}
                                                        >
                                                            <FileText size={16} />
                                                            <span style={{ fontSize: '0.875rem', textDecoration: 'underline' }}>{doc.fileName}</span>
                                                        </a>
                                                    </td>
                                                    <td className="docs-td" style={{ textAlign: 'right' }}>
                                                        <div className="flex-gap" style={{ justifyContent: 'flex-end' }}>
                                                            <button className="icon-btn" onClick={() => handleEditDocument(doc)} title="Editar Documento">
                                                                <Edit2 size={16} color="var(--color-text-secondary)" />
                                                            </button>
                                                            <button className="icon-btn" onClick={() => handleDeleteDocument(doc.id)} title="Excluir Documento">
                                                                <Trash2 size={16} color="var(--color-danger)" />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            )}

                            {activeTab === 'credentials' && (
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                    <thead>
                                        <tr style={{ backgroundColor: 'var(--color-bg-surface-hover)', borderBottom: '1px solid var(--color-border)' }}>
                                            <th className="docs-th">Plataforma</th>
                                            <th className="docs-th">Login / Usuário</th>
                                            <th className="docs-th">Senha</th>
                                            <th className="docs-th">Observações</th>
                                            <th className="docs-th"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {!activeCompany.credentials || activeCompany.credentials.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} style={{ padding: '48px', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                                                    Nenhuma credencial ou senha salva para esta empresa.
                                                </td>
                                            </tr>
                                        ) : (
                                            activeCompany.credentials.map((cred: CompanyCredential) => (
                                                <tr key={cred.id} style={{ borderBottom: '1px solid var(--color-border)' }} className="table-row-hover">
                                                    <td className="docs-td">
                                                        <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{cred.platform}</div>
                                                        {cred.url && (
                                                            <a href={cred.url} target="_blank" rel="noopener noreferrer" className="flex-gap" style={{ fontSize: '0.75rem', color: 'var(--color-primary)', marginTop: '4px', textDecoration: 'none' }}>
                                                                <ExternalLink size={12} /> Acessar Portal
                                                            </a>
                                                        )}
                                                    </td>
                                                    <td className="docs-td" style={{ fontFamily: 'monospace', fontSize: '1rem' }}>
                                                        {cred.login}
                                                    </td>
                                                    <td className="docs-td">
                                                        <div className="flex-gap">
                                                            <span style={{ fontFamily: 'monospace', fontSize: '1rem', letterSpacing: showPasswords[cred.id] ? 'normal' : '0.15em' }}>
                                                                {showPasswords[cred.id] ? cred.password : '••••••••'}
                                                            </span>
                                                            <button
                                                                className="icon-btn"
                                                                onClick={() => togglePasswordVisibility(cred.id)}
                                                                title={showPasswords[cred.id] ? "Ocultar Senha" : "Revelar Senha"}
                                                                style={{ padding: '4px' }}
                                                            >
                                                                {showPasswords[cred.id] ? <EyeOff size={16} /> : <Eye size={16} />}
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td className="docs-td" style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem', maxWidth: '200px' }}>
                                                        {cred.notes || '-'}
                                                    </td>
                                                    <td className="docs-td" style={{ textAlign: 'right' }}>
                                                        <div className="flex-gap" style={{ justifyContent: 'flex-end' }}>
                                                            <button className="icon-btn" onClick={() => handleEditCredential(cred)} title="Editar">
                                                                <Edit2 size={16} color="var(--color-text-secondary)" />
                                                            </button>
                                                            <button className="icon-btn" onClick={() => handleDeleteCredential(cred.id)} title="Excluir">
                                                                <Trash2 size={16} color="var(--color-danger)" />
                                                            </button>
                                                        </div>
                                                    </td>
                                                </tr>
                                            ))
                                        )}
                                    </tbody>
                                </table>
                            )}
                        </div>
                    </>
                ) : (
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--color-text-tertiary)' }}>
                        Selecione uma empresa na barra lateral.
                    </div>
                )}
            </div >

            {
                isCompanyModalOpen && (
                    <CompanyFormModal
                        initialData={editingCompany}
                        onClose={() => setIsCompanyModalOpen(false)}
                        onSave={handleSaveCompany}
                    />
                )
            }

            {
                isDocumentModalOpen && activeCompany && (
                    <DocumentFormModal
                        initialData={editingDocument}
                        companyProfileId={activeCompany.id}
                        onClose={() => setIsDocumentModalOpen(false)}
                        onSave={handleSaveDocument}
                        groupAlertDays={sanitizedGroup}
                        defaultAlertDays={sanitizedDefault}
                    />
                )
            }

            {
                isCredentialModalOpen && activeCompany && (
                    <CredentialFormModal
                        initialData={editingCredential}
                        companyId={activeCompany.id}
                        onClose={() => setIsCredentialModalOpen(false)}
                        onSave={handleSaveCredential}
                    />
                )
            }

            {
                isAlertConfigOpen && (
                    <div className="modal-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(15, 23, 42, 0.6)', backdropFilter: 'blur(4px)', animation: 'fadeIn 0.2s ease-out', position: 'fixed', top: 0, left: 0, right: 0, bottom: 0, zIndex: 1000 }}>
                        <div className="card" style={{ maxWidth: '450px', width: '100%', padding: 'var(--space-8)', maxHeight: '90vh', overflowY: 'auto', backgroundColor: 'var(--color-bg-surface)', border: '1px solid var(--color-border)', borderRadius: 'var(--radius-xl)', boxShadow: 'var(--shadow-xl)', animation: 'slideUp 0.3s ease-out' }}>
                            <h3 style={{ marginBottom: 'var(--space-2)', fontSize: 'var(--text-2xl)', fontWeight: 'var(--font-semibold)', color: 'var(--color-text-primary)' }}>Configurar Alertas</h3>
                            <p style={{ fontSize: 'var(--text-md)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-6)' }}>
                                A Regra Padrão é predominante para todos os documentos. Caso você defina prazos específicos por categoria, eles se tornarão a nova regra dominante sobre aquela categoria, revertendo a lógica.
                            </p>

                            <div style={{ marginBottom: 'var(--space-5)', backgroundColor: 'var(--color-bg-base)', padding: 'var(--space-4)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-primary)' }}>
                                <label style={{ display: 'block', fontSize: 'var(--text-lg)', marginBottom: 'var(--space-2)', fontWeight: 'var(--font-semibold)', color: 'var(--color-primary)' }}>Alerta Padrão Dominante (Dias)</label>
                                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-secondary)', marginBottom: 'var(--space-3)' }}>Aplica-se a todos os documentos do sistema se não houver regra específica.</p>
                                <input
                                    type="number"
                                    className="form-select"
                                    value={defaultAlertDays}
                                    onChange={(e) => setDefaultAlertDays(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
                                    style={{ fontWeight: 'var(--font-semibold)', fontSize: 'var(--text-xl)' }}
                                />
                            </div>

                            <div style={{ marginBottom: 'var(--space-6)', borderTop: '1px solid var(--color-border)', paddingTop: 'var(--space-5)' }}>
                                <label style={{ display: 'block', fontSize: 'var(--text-md)', marginBottom: '4px', fontWeight: 'var(--font-semibold)', color: 'var(--color-text-secondary)' }}>Alerta Específico por Categoria (Opcional)</label>
                                <p style={{ fontSize: 'var(--text-sm)', color: 'var(--color-text-tertiary)', marginBottom: 'var(--space-4)' }}>Ao informar um valor abaixo, ele se sobressai e ignora o padrão para aquela opção.</p>
                                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                    {DOCUMENT_GROUPS.map((group) => (
                                        <div key={group} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '8px' }}>
                                            <span style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-primary)', flex: 1 }}>{group}</span>
                                                <input
                                                type="number"
                                                className="form-select"
                                                placeholder={`${defaultAlertDays || 0} (Herdado)`}
                                                value={groupAlertDays[group] !== undefined ? groupAlertDays[group] : ''}
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    setGroupAlertDays(prev => {
                                                        const newGroup = { ...prev };
                                                        if (val === '') {
                                                            delete newGroup[group];
                                                        } else {
                                                            newGroup[group] = parseInt(val, 10);
                                                        }
                                                        return newGroup;
                                                    });
                                                }}
                                                style={{ width: '120px', textAlign: 'center' }}
                                            />
                                        </div>
                                    ))}
                                </div>
                            </div>

                            <div style={{ marginBottom: 'var(--space-6)', display: 'flex', alignItems: 'center', gap: 'var(--space-2)', backgroundColor: 'var(--color-bg-base)', padding: 'var(--space-3)', borderRadius: 'var(--radius-md)', border: '1px solid var(--color-primary-light)' }}>
                                <input
                                    type="checkbox"
                                    id="applyToExistingDocs"
                                    checked={applyToExisting}
                                    onChange={(e) => setApplyToExisting(e.target.checked)}
                                    style={{ width: '16px', height: '16px', accentColor: 'var(--color-primary)' }}
                                />
                                <label htmlFor="applyToExistingDocs" style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-primary)', cursor: 'pointer', fontWeight: 'var(--font-medium)' }}>
                                    Aplicar estes novos prazos a todos os documentos existentes nesta empresa
                                </label>
                            </div>

                            <div className="flex-gap" style={{ justifyContent: 'flex-end' }}>
                                <button className="btn btn-ghost" onClick={() => setIsAlertConfigOpen(false)}>Cancelar</button>
                                <button className="btn btn-primary" onClick={handleSaveAlertConfig}>Salvar Configuração</button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >

            <ConfirmDialog
                open={!!confirmAction}
                title={confirmAction?.type === 'company' ? 'Excluir Empresa' : confirmAction?.type === 'document' ? 'Excluir Documento' : 'Excluir Credencial'}
                message={`Tem certeza que deseja excluir "${confirmAction?.label}"? Esta ação não pode ser desfeita.`}
                confirmLabel="Excluir"
                cancelLabel="Cancelar"
                variant="danger"
                onConfirm={executeDelete}
                onCancel={() => setConfirmAction(null)}
            />
        </>
    );
}

function StatusBadge({ status }: { status: DocumentStatus }) {
    const config = status === 'Válido'
        ? { icon: <CheckCircle2 size={14} />, variant: 'success' as const }
        : status === 'Vencendo'
            ? { icon: <Clock size={14} />, variant: 'warning' as const }
            : { icon: <ShieldAlert size={14} />, variant: 'danger' as const };

    return (
        <Badge variant={config.variant} icon={config.icon}>
            {status}
        </Badge>
    );
}
