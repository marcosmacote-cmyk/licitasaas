import React, { useState, useRef, useEffect } from 'react';
import { API_BASE_URL } from '../../config';
import type { CompanyProfile, CompanyDocument, CompanyCredential } from '../../types';
import { useToast } from '../ui';

export const DOCUMENT_GROUPS = [
    'Habilitação Jurídica',
    'Regularidade Fiscal, Social e Trabalhista',
    'Qualificação Técnica',
    'Qualificação Econômica Financeira',
    'Outros'
];

interface UseDocumentsPageParams {
    companies: CompanyProfile[];
    setCompanies: React.Dispatch<React.SetStateAction<CompanyProfile[]>>;
    initialFilter?: { statuses?: string[]; highlight?: string; specialFilter?: string } | null;
    onFilterConsumed?: () => void;
}

export function useDocumentsPage({ companies, setCompanies, initialFilter, onFilterConsumed }: UseDocumentsPageParams) {
    const toast = useToast();
    const [confirmAction, setConfirmAction] = useState<{ type: 'company' | 'document' | 'credential'; id: string; label: string } | null>(null);
    const [documents, setDocuments] = useState<CompanyDocument[]>([]);

    useEffect(() => {
        const allDocs = companies.flatMap(c => c.documents || []);
        allDocs.sort((a, b) => new Date(b.uploadDate).getTime() - new Date(a.uploadDate).getTime());
        setDocuments(allDocs);
    }, [companies]);

    const [selectedCompanyId, setSelectedCompanyId] = useState<string>('');

    useEffect(() => {
        if (companies.length > 0) {
            const currentValid = companies.some(c => c.id === selectedCompanyId);
            if (!selectedCompanyId || !currentValid) {
                setSelectedCompanyId(companies[0].id);
            }
        }
    }, [companies, selectedCompanyId]);

    const [isGlobalExpiringView, setIsGlobalExpiringView] = useState(false);

    useEffect(() => {
        if (initialFilter?.specialFilter === 'expiring_docs') {
            setIsGlobalExpiringView(true);
            setSelectedCompanyId('');
            onFilterConsumed?.();
        }
    }, [initialFilter]);

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
            } catch (err) { console.error("Failed to fetch alert config", err); }
        };
        fetchConfig();
    }, []);

    const fileInputRef = useRef<HTMLInputElement>(null);
    const activeCompany = companies.find(c => c.id === selectedCompanyId);

    const filteredDocs = documents
        .filter((d: CompanyDocument) => {
            if (isGlobalExpiringView) {
                // Show only documents that need attention
                if (d.status === 'Válido') return false;
            } else {
                if (d.companyProfileId !== selectedCompanyId) return false;
            }
            if (!searchTerm) return true;
            return (d.docType.toLowerCase().includes(searchTerm.toLowerCase()) ||
                (d.docGroup || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
                (d.issuerLink || '').toLowerCase().includes(searchTerm.toLowerCase()));
        })
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
        if (sortField === field) { setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc'); }
        else { setSortField(field); setSortOrder('asc'); }
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
                headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                body: JSON.stringify({ defaultAlertDays: finalDefault, groupAlertDays: finalGroup, applyToExisting })
            });
            if (res.status === 401 || res.status === 403) { toast.error('Sua sessão expirou. Recarregando...'); window.location.reload(); return; }
            if (res.ok) {
                setIsAlertConfigOpen(false);
                if (applyToExisting) {
                    const resCompanies = await fetch(`${API_BASE_URL}/api/companies`, {
                        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                    });
                    if (resCompanies.ok) { const data = await resCompanies.json(); setCompanies(data); }
                    toast.success("Configuração salva! Prazos aplicados aos documentos.");
                } else { toast.success("Configuração de alertas salva com sucesso!"); }
            } else {
                let errorData: any = null;
                try { errorData = await res.json(); } catch (e) { }
                let errorMsg = "Erro desconhecido do servidor (resposta não-JSON)";
                if (errorData) { errorMsg = errorData.error || errorData.message || (Object.keys(errorData).length > 0 ? JSON.stringify(errorData) : "Erro de resposta vazia do servidor"); }
                toast.error(`Erro ao salvar configuração: ${errorMsg}`);
            }
        } catch (err: any) {
            console.error("Failed to save alert config", err);
            toast.error(`Erro na requisição: ${err.message || String(err)}`);
        }
    };

    const sanitizedDefault = typeof defaultAlertDays === 'number' && !isNaN(defaultAlertDays) ? defaultAlertDays : 15;
    const sanitizedGroup = Object.fromEntries(Object.entries(groupAlertDays).map(([k, v]) => [k, typeof v === 'number' && !isNaN(v) ? v : sanitizedDefault]));

    const handleCreateCompany = () => { setEditingCompany(null); setIsCompanyModalOpen(true); };
    const handleEditCompany = (company: CompanyProfile) => { setEditingCompany(company); setIsCompanyModalOpen(true); };
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
                const res = await fetch(`${API_BASE_URL}/api/companies/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } });
                if (res.status === 401 || res.status === 403) { toast.error('Sessão expirada.'); window.location.reload(); return; }
                if (!res.ok) throw new Error('Delete failed');
                setCompanies((prev: CompanyProfile[]) => prev.filter((c: CompanyProfile) => c.id !== id));
                setDocuments((prev: CompanyDocument[]) => prev.filter((d: CompanyDocument) => d.companyProfileId !== id));
                if (selectedCompanyId === id) setSelectedCompanyId('');
                toast.success('Empresa excluída com sucesso.');
            } catch (err) { console.error(err); toast.error('Erro ao excluir empresa.'); }
        } else if (type === 'document') {
            try {
                const res = await fetch(`${API_BASE_URL}/api/documents/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } });
                if (res.status === 401 || res.status === 403) { toast.error('Sessão expirada.'); window.location.reload(); return; }
                if (res.ok) { setDocuments(prev => prev.filter(d => d.id !== id)); toast.success('Documento excluído.'); }
            } catch (err) { console.error(err); toast.error('Erro ao excluir documento.'); }
        } else if (type === 'credential') {
            try {
                const res = await fetch(`${API_BASE_URL}/api/credentials/${id}`, { method: 'DELETE', headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` } });
                if (res.status === 401 || res.status === 403) { toast.error('Sessão expirada.'); window.location.reload(); return; }
                if (!res.ok) throw new Error('Failed to delete credential');
                setCompanies(prev => prev.map(c => c.id === selectedCompanyId ? { ...c, credentials: c.credentials?.filter(cr => cr.id !== id) } : c));
                toast.success('Credencial excluída.');
            } catch (err) { console.error(err); toast.error('Erro ao excluir credencial.'); }
        }
    };

    const handleSaveCompany = async (companyData: Partial<CompanyProfile>) => {
        try {
            if (editingCompany && editingCompany.id) {
                const res = await fetch(`${API_BASE_URL}/api/companies/${editingCompany.id}`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                    body: JSON.stringify(companyData)
                });
                if (res.status === 401 || res.status === 403) { toast.error('Sessão expirada.'); window.location.reload(); return; }
                if (!res.ok) throw new Error("Failed to update company");
                const updatedCompany = await res.json();
                setCompanies((prev: CompanyProfile[]) => prev.map((c: CompanyProfile) => c.id === editingCompany.id ? updatedCompany : c));
            } else {
                const res = await fetch(`${API_BASE_URL}/api/companies`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                    body: JSON.stringify(companyData)
                });
                if (res.status === 401 || res.status === 403) { toast.error('Sessão expirada.'); window.location.reload(); return; }
                if (!res.ok) throw new Error("Failed to create company");
                const newCompany = await res.json();
                setCompanies((prev: CompanyProfile[]) => [...prev, newCompany]);
                setSelectedCompanyId(newCompany.id);
            }
            setIsCompanyModalOpen(false);
        } catch (err) { console.error(err); toast.error('Erro ao salvar empresa no servidor.'); }
    };

    const handleCreateDocument = () => { setEditingDocument(null); setIsDocumentModalOpen(true); };
    const handleEditDocument = (doc: CompanyDocument) => { setEditingDocument(doc); setIsDocumentModalOpen(true); };
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
                    method: 'PUT', headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }, body: formData
                });
                if (res.status === 401 || res.status === 403) { toast.error('Sessão expirada.'); window.location.reload(); return; }
                if (!res.ok) throw new Error("Failed to update document");
                const updatedDoc = await res.json();
                setDocuments(prev => prev.map(d => d.id === editingDocument.id ? updatedDoc : d));
                setCompanies(prev => prev.map(c => c.id === selectedCompanyId ? { ...c, documents: c.documents?.map(d => d.id === editingDocument.id ? updatedDoc : d) } : c));
                setIsDocumentModalOpen(false);
            } catch (err) { console.error(err); toast.error('Erro ao atualizar documento.'); }
        } else {
            if (!file) { toast.warning('O arquivo PDF é obrigatório.'); return; }
            try {
                formData.append('companyProfileId', docData.companyProfileId!);
                const res = await fetch(`${API_BASE_URL}/api/documents`, {
                    method: 'POST', headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }, body: formData
                });
                if (res.status === 401 || res.status === 403) { toast.error('Sessão expirada.'); window.location.reload(); return; }
                if (!res.ok) { const errorData = await res.json().catch(() => ({})); throw new Error(errorData.details || errorData.error || "Upload failed"); }
                const newDoc = await res.json();
                setDocuments(prev => [newDoc, ...prev]);
                setCompanies(prev => prev.map(c => c.id === selectedCompanyId ? { ...c, documents: [newDoc, ...(c.documents || [])] } : c));
                setIsDocumentModalOpen(false);
            } catch (err) { console.error(err); toast.error(`Falha ao salvar documento: ${err instanceof Error ? err.message : String(err)}`); }
        }
    };

    const handleCreateCredential = () => { setEditingCredential(null); setIsCredentialModalOpen(true); };
    const handleEditCredential = (cred: CompanyCredential) => { setEditingCredential(cred); setIsCredentialModalOpen(true); };

    const handleSaveCredential = async (credData: Partial<CompanyCredential>) => {
        try {
            if (editingCredential && editingCredential.id) {
                const res = await fetch(`${API_BASE_URL}/api/credentials/${editingCredential.id}`, {
                    method: 'PUT', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                    body: JSON.stringify(credData)
                });
                if (res.status === 401 || res.status === 403) { toast.error('Sessão expirada.'); window.location.reload(); return; }
                if (!res.ok) throw new Error("Failed to update credential");
                const updatedCred = await res.json();
                setCompanies(prev => prev.map(c => c.id === selectedCompanyId ? { ...c, credentials: c.credentials?.map(cr => cr.id === editingCredential.id ? updatedCred : cr) } : c));
            } else {
                const res = await fetch(`${API_BASE_URL}/api/credentials`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                    body: JSON.stringify({ ...credData, companyProfileId: selectedCompanyId })
                });
                if (res.status === 401 || res.status === 403) { toast.error('Sessão expirada.'); window.location.reload(); return; }
                if (!res.ok) throw new Error("Failed to create credential");
                const newCred = await res.json();
                setCompanies(prev => prev.map(c => c.id === selectedCompanyId ? { ...c, credentials: [newCred, ...(c.credentials || [])] } : c));
            }
            setIsCredentialModalOpen(false);
        } catch (err) { console.error(err); toast.error('Erro ao salvar credencial.'); }
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
                method: 'POST', headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }, body: formData
            });
            if (res.status === 401 || res.status === 403) { toast.error('Sessão expirada.'); window.location.reload(); return; }
            if (!res.ok) { const errorData = await res.json().catch(() => ({})); throw new Error(errorData.details || errorData.error || "Fast upload failed"); }
            const newDoc = await res.json();
            setDocuments((prev: CompanyDocument[]) => [newDoc, ...prev]);
        } catch (err) {
            console.error(err);
            toast.error(`Erro no upload rápido: ${err instanceof Error ? err.message : String(err)}`);
        } finally { if (fileInputRef.current) fileInputRef.current.value = ''; }
    };

    return {
        // State
        confirmAction, setConfirmAction, documents, selectedCompanyId, setSelectedCompanyId,
        isGlobalExpiringView, setIsGlobalExpiringView,
        searchTerm, setSearchTerm,
        // Modal state
        isCompanyModalOpen, setIsCompanyModalOpen, editingCompany,
        isDocumentModalOpen, setIsDocumentModalOpen, editingDocument,
        isCredentialModalOpen, setIsCredentialModalOpen, editingCredential,
        activeTab, setActiveTab, showPasswords,
        // Sort
        sortField, sortOrder,
        // Alert config
        isAlertConfigOpen, setIsAlertConfigOpen, defaultAlertDays, setDefaultAlertDays,
        groupAlertDays, setGroupAlertDays, applyToExisting, setApplyToExisting,
        // Computed
        activeCompany, filteredDocs, sanitizedDefault, sanitizedGroup, fileInputRef,
        // Handlers
        handleToggleSort, handleSaveAlertConfig,
        handleCreateCompany, handleEditCompany, handleDeleteCompany, executeDelete,
        handleSaveCompany,
        handleCreateDocument, handleEditDocument, handleDeleteDocument, handleSaveDocument,
        handleCreateCredential, handleEditCredential, handleSaveCredential, handleDeleteCredential,
        togglePasswordVisibility, handleFileChange,
    };
}
