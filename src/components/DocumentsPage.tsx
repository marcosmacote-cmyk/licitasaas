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
    const [documents, setDocuments] = useState<CompanyDocument[]>([]);

    useEffect(() => {
        const allDocs = companies.flatMap(c => c.documents || []);
        // Sort by upload date descending
        allDocs.sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime());
        setDocuments(allDocs);
    }, [companies]);
    const [selectedCompanyId, setSelectedCompanyId] = useState<string>('1');
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
    const [defaultAlertDays, setDefaultAlertDays] = useState(15);

    useEffect(() => {
        const fetchConfig = async () => {
            try {
                const res = await fetch(`${API_BASE_URL}/api/config/alerts`, {
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                });
                if (res.ok) {
                    const data = await res.json();
                    setDefaultAlertDays(data.defaultAlertDays || 15);
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

    const handleSaveAlertConfig = async (days: number) => {
        try {
            const res = await fetch(`${API_BASE_URL}/api/config/alerts`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({ defaultAlertDays: days })
            });
            if (res.ok) {
                setDefaultAlertDays(days);
                setIsAlertConfigOpen(false);
            }
        } catch (err) {
            console.error("Failed to save alert config", err);
        }
    };

    const handleCreateCompany = () => {
        setEditingCompany(null);
        setIsCompanyModalOpen(true);
    };

    const handleEditCompany = (company: CompanyProfile) => {
        setEditingCompany(company);
        setIsCompanyModalOpen(true);
    };

    const handleDeleteCompany = async (companyId: string) => {
        if (window.confirm('Tem certeza que deseja remover esta empresa e todos os seus documentos?')) {
            try {
                const res = await fetch(`${API_BASE_URL}/api/companies/${companyId}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                });
                if (!res.ok) throw new Error("Delete failed");
                setCompanies((prev: CompanyProfile[]) => prev.filter((c: CompanyProfile) => c.id !== companyId));
                setDocuments((prev: CompanyDocument[]) => prev.filter((d: CompanyDocument) => d.companyProfileId !== companyId));
                if (selectedCompanyId === companyId) {
                    setSelectedCompanyId('');
                }
            } catch (err) {
                console.error(err);
                alert("Erro ao excluir empresa.");
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
                if (!res.ok) throw new Error("Failed to create company");
                const newCompany = await res.json();
                setCompanies((prev: CompanyProfile[]) => [...prev, newCompany]);
                setSelectedCompanyId(newCompany.id); // Auto-select new company
            }
            setIsCompanyModalOpen(false);
        } catch (err) {
            console.error(err);
            alert("Erro ao salvar empresa no servidor.");
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

    const handleDeleteDocument = async (docId: string) => {
        if (window.confirm('Tem certeza que deseja apagar este documento?')) {
            try {
                const res = await fetch(`${API_BASE_URL}/api/documents/${docId}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                });
                if (res.ok) {
                    setDocuments(prev => prev.filter(d => d.id !== docId));
                }
            } catch (err) {
                console.error(err);
                alert("Erro ao excluir arquivo.");
            }
        }
    };

    const handleSaveDocument = async (docData: Partial<CompanyDocument>, file?: File) => {
        const formData = new FormData();
        if (file) formData.append('file', file);

        formData.append('docType', docData.docType || '');
        formData.append('docGroup', docData.docGroup || 'Outros');
        formData.append('issuerLink', docData.issuerLink || '');
        formData.append('expirationDate', docData.expirationDate || '');
        formData.append('status', docData.status || 'Válido');
        formData.append('alertDays', String(docData.alertDays || 15));

        if (editingDocument && editingDocument.id) {
            try {
                const res = await fetch(`${API_BASE_URL}/api/documents/${editingDocument.id}`, {
                    method: 'PUT',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                    body: formData
                });
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
                alert("Erro ao atualizar documento no servidor.");
            }
        } else {
            // Create New
            if (!file) {
                alert("O arquivo PDF é obrigatório.");
                return;
            }
            try {
                formData.append('companyProfileId', docData.companyProfileId!);

                const res = await fetch(`${API_BASE_URL}/api/documents`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                    body: formData
                });
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
                alert(`Falha ao salvar documento: ${err instanceof Error ? err.message : String(err)}`);
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
            alert("Erro ao salvar credencial no servidor.");
        }
    };

    const handleDeleteCredential = async (id: string) => {
        if (window.confirm('Tem certeza que deseja excluir esta credencial?')) {
            try {
                const res = await fetch(`${API_BASE_URL}/api/credentials/${id}`, {
                    method: 'DELETE',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                });
                if (!res.ok) throw new Error("Failed to delete credential");

                setCompanies(prev => prev.map(c =>
                    c.id === selectedCompanyId
                        ? { ...c, credentials: c.credentials?.filter(cr => cr.id !== id) }
                        : c
                ));
            } catch (err) {
                console.error(err);
                alert("Erro ao excluir credencial.");
            }
        }
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
            if (!res.ok) {
                const errorData = await res.json().catch(() => ({}));
                throw new Error(errorData.details || errorData.error || "Fast upload failed");
            }
            const newDoc = await res.json();
            setDocuments((prev: CompanyDocument[]) => [newDoc, ...prev]);
        } catch (err) {
            console.error(err);
            alert(`Erro no upload rápido: ${err instanceof Error ? err.message : String(err)}`);
        } finally {
            if (fileInputRef.current) fileInputRef.current.value = '';
        }
    };

    return (
        <div className="page-container" style={{ display: 'flex', flexDirection: 'row', gap: '24px', paddingRight: '24px' }}>

            {/* Sidebar: Companies List */}
            <div style={{ width: '300px', display: 'flex', flexDirection: 'column', gap: '16px' }}>
                <div className="flex-between">
                    <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>Empresas</h2>
                    <button className="icon-btn" onClick={handleCreateCompany} title="Cadastrar Nova Empresa" style={{ background: 'var(--color-primary)', color: 'white', padding: '6px' }}>
                        <Plus size={16} />
                    </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                    {companies.map((company: CompanyProfile) => (
                        <div
                            key={company.id}
                            onClick={() => setSelectedCompanyId(company.id)}
                            style={{
                                padding: '16px',
                                backgroundColor: selectedCompanyId === company.id ? 'var(--color-primary-light)' : 'var(--color-bg-surface)',
                                border: `1px solid ${selectedCompanyId === company.id ? 'var(--color-primary)' : 'var(--color-border)'}`,
                                borderRadius: 'var(--radius-lg)',
                                cursor: 'pointer',
                                transition: 'all 0.2s',
                            }}
                        >
                            <div className="flex-between" style={{ marginBottom: '8px' }}>
                                <div className="flex-gap" style={{ color: selectedCompanyId === company.id ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
                                    <Building2 size={16} />
                                    <span style={{ fontSize: '0.75rem', fontWeight: 600, textTransform: 'uppercase' }}>
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
                            <div style={{ fontWeight: 600, color: 'var(--color-text-primary)', marginBottom: '4px', fontSize: '0.9rem' }}>
                                {company.razaoSocial}
                            </div>
                            <div style={{ fontSize: '0.8rem', color: 'var(--color-text-tertiary)' }}>
                                CNPJ: {company.cnpj}
                            </div>
                        </div>
                    ))}
                </div>
            </div>

            {/* Main Content: Documents Table */}
            <div style={{ flex: 1, backgroundColor: 'var(--color-bg-surface)', borderRadius: 'var(--radius-lg)', border: '1px solid var(--color-border)', display: 'flex', flexDirection: 'column' }}>
                {activeCompany ? (
                    <>
                        <div style={{ padding: '24px', borderBottom: '1px solid var(--color-border)' }}>
                            <div className="flex-between" style={{ marginBottom: '24px' }}>
                                <div>
                                    <h2 style={{ fontSize: '1.25rem', fontWeight: 600, color: 'var(--color-text-primary)' }}>
                                        {activeCompany.razaoSocial}
                                    </h2>
                                    <p style={{ color: 'var(--color-text-secondary)', fontSize: '0.875rem' }}>
                                        CNPJ: {activeCompany.cnpj}
                                    </p>
                                </div>
                                <div className="flex-gap" style={{ background: 'var(--color-bg-surface-hover)', padding: '4px', borderRadius: 'var(--radius-md)' }}>
                                    <button
                                        className={`btn ${activeTab === 'documents' ? 'btn-primary' : 'btn-ghost'}`}
                                        onClick={() => setActiveTab('documents')}
                                        style={{ background: activeTab === 'documents' ? 'var(--color-bg-surface)' : 'transparent', color: activeTab === 'documents' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)', border: activeTab === 'documents' ? '1px solid var(--color-border)' : 'none', boxShadow: 'none' }}
                                    >
                                        <FileText size={16} /> Documentos
                                    </button>
                                    <button
                                        className={`btn ${activeTab === 'credentials' ? 'btn-primary' : 'btn-ghost'}`}
                                        onClick={() => setActiveTab('credentials')}
                                        style={{ background: activeTab === 'credentials' ? 'var(--color-bg-surface)' : 'transparent', color: activeTab === 'credentials' ? 'var(--color-text-primary)' : 'var(--color-text-secondary)', border: activeTab === 'credentials' ? '1px solid var(--color-border)' : 'none', boxShadow: 'none' }}
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
                                            style={{ border: 'none', background: 'transparent', outline: 'none', color: 'var(--color-text-primary)', flex: 1, fontSize: '0.875rem' }}
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
                                    <button className="btn btn-primary" onClick={handleCreateCredential} style={{ backgroundColor: '#10b981', borderColor: '#10b981' }}>
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
                                            <th style={{ ...thStyle, cursor: 'pointer' }} onClick={() => handleToggleSort('docType')}>
                                                <div className="flex-gap">Documento {sortField === 'docType' && (sortOrder === 'asc' ? '↑' : '↓')}</div>
                                            </th>
                                            <th style={{ ...thStyle, cursor: 'pointer' }} onClick={() => handleToggleSort('status')}>
                                                <div className="flex-gap">Status {sortField === 'status' && (sortOrder === 'asc' ? '↑' : '↓')}</div>
                                            </th>
                                            <th style={{ ...thStyle, cursor: 'pointer' }} onClick={() => handleToggleSort('expirationDate')}>
                                                <div className="flex-gap">Vencimento {sortField === 'expirationDate' && (sortOrder === 'asc' ? '↑' : '↓')}</div>
                                            </th>
                                            <th style={thStyle}>Órgão / Link</th>
                                            <th style={thStyle}>Arquivo</th>
                                            <th style={thStyle}></th>
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
                                                    <td style={tdStyle}>
                                                        <div style={{ fontWeight: 500, color: 'var(--color-text-primary)' }}>{doc.docType}</div>
                                                        <div style={{ fontSize: '0.7rem', display: 'inline-block', padding: '2px 6px', borderRadius: '4px', backgroundColor: 'var(--color-bg-base)', border: '1px solid var(--color-border)', marginTop: '4px', color: 'var(--color-text-secondary)' }}>
                                                            {doc.docGroup}
                                                        </div>
                                                    </td>
                                                    <td style={tdStyle}>
                                                        <StatusBadge status={doc.status} />
                                                    </td>
                                                    <td style={tdStyle}>
                                                        <div className="flex-gap" style={{ color: doc.status === 'Vencido' ? 'var(--color-danger)' : 'var(--color-text-primary)' }}>
                                                            <Clock size={16} />
                                                            {new Date(doc.expirationDate).toLocaleDateString('pt-BR')}
                                                        </div>
                                                    </td>
                                                    <td style={tdStyle}>
                                                        {doc.issuerLink ? (
                                                            <a href={doc.issuerLink} target="_blank" rel="noopener noreferrer" className="flex-gap" style={{ color: 'var(--color-primary)', fontSize: '0.875rem' }}>
                                                                <ExternalLink size={14} />
                                                                Portal Emissor
                                                            </a>
                                                        ) : (
                                                            <span style={{ color: 'var(--color-text-tertiary)', fontSize: '0.875rem' }}>-</span>
                                                        )}
                                                    </td>
                                                    <td style={tdStyle}>
                                                        <a href={`${API_BASE_URL}${doc.fileUrl}`} target="_blank" rel="noopener noreferrer" className="flex-gap" style={{ color: 'var(--color-primary)', cursor: 'pointer', textDecoration: 'none' }}>
                                                            <FileText size={16} />
                                                            <span style={{ fontSize: '0.875rem', textDecoration: 'underline' }}>{doc.fileName}</span>
                                                        </a>
                                                    </td>
                                                    <td style={{ ...tdStyle, textAlign: 'right' }}>
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
                                            <th style={thStyle}>Plataforma</th>
                                            <th style={thStyle}>Login / Usuário</th>
                                            <th style={thStyle}>Senha</th>
                                            <th style={thStyle}>Observações</th>
                                            <th style={thStyle}></th>
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
                                                    <td style={tdStyle}>
                                                        <div style={{ fontWeight: 600, color: 'var(--color-text-primary)' }}>{cred.platform}</div>
                                                        {cred.url && (
                                                            <a href={cred.url} target="_blank" rel="noopener noreferrer" className="flex-gap" style={{ fontSize: '0.75rem', color: 'var(--color-primary)', marginTop: '4px', textDecoration: 'none' }}>
                                                                <ExternalLink size={12} /> Acessar Portal
                                                            </a>
                                                        )}
                                                    </td>
                                                    <td style={{ ...tdStyle, fontFamily: 'monospace', fontSize: '1rem' }}>
                                                        {cred.login}
                                                    </td>
                                                    <td style={tdStyle}>
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
                                                    <td style={{ ...tdStyle, color: 'var(--color-text-secondary)', fontSize: '0.8rem', maxWidth: '200px' }}>
                                                        {cred.notes || '-'}
                                                    </td>
                                                    <td style={{ ...tdStyle, textAlign: 'right' }}>
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
            </div>

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

            {isAlertConfigOpen && (
                <div className="modal-overlay" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', backgroundColor: 'rgba(0,0,0,0.5)', zIndex: 1000 }}>
                    <div className="card" style={{ maxWidth: '400px', width: '100%', padding: '24px' }}>
                        <h3 style={{ marginBottom: '16px' }}>Configurar Alertas de Vencimento</h3>
                        <div style={{ marginBottom: '20px' }}>
                            <label style={{ display: 'block', fontSize: '0.875rem', marginBottom: '8px' }}>Prazos de Alerta Padrão (Dias):</label>
                            <input
                                type="number"
                                className="input-inner"
                                value={defaultAlertDays}
                                onChange={(e) => setDefaultAlertDays(parseInt(e.target.value))}
                                style={{ width: '100%', border: '1px solid var(--color-border)', padding: '8px', borderRadius: '4px' }}
                            />
                            <p style={{ fontSize: '0.75rem', color: 'var(--color-text-tertiary)', marginTop: '8px' }}>
                                Define quantos dias antes do vencimento o status do documento mudará para "Vencendo".
                            </p>
                        </div>
                        <div className="flex-gap" style={{ justifyContent: 'flex-end' }}>
                            <button className="btn btn-ghost" onClick={() => setIsAlertConfigOpen(false)}>Cancelar</button>
                            <button className="btn btn-primary" onClick={() => handleSaveAlertConfig(defaultAlertDays)}>Salvar Configuração</button>
                        </div>
                    </div>
                </div>
            )}
        </div >
    );
}

function StatusBadge({ status }: { status: DocumentStatus }) {
    let icon;
    let colorClass;

    if (status === 'Válido') {
        icon = <CheckCircle2 size={14} />;
        colorClass = 'badge-green';
    } else if (status === 'Vencendo') {
        icon = <Clock size={14} />;
        colorClass = 'badge-orange';
    } else {
        icon = <ShieldAlert size={14} />;
        colorClass = 'badge-red';
    }

    return (
        <span className={`badge ${colorClass}`} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
            {icon}
            {status}
        </span>
    );
}

const thStyle: React.CSSProperties = {
    padding: '12px 24px',
    fontSize: '0.75rem',
    fontWeight: 600,
    color: 'var(--color-text-secondary)',
    textTransform: 'uppercase',
    letterSpacing: '0.05em'
};

const tdStyle: React.CSSProperties = {
    padding: '16px 24px',
    fontSize: '0.875rem',
    color: 'var(--color-text-primary)',
    verticalAlign: 'middle'
};
