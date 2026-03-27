import React from 'react';
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
import { Badge, ConfirmDialog } from './ui';
import { useDocumentsPage, DOCUMENT_GROUPS } from './hooks/useDocumentsPage';

// Fix double-encoded UTF-8 strings (e.g., "ATÃ‰" -> "ATÉ")
function fixEncoding(str: string): string {
    if (!str) return str;
    try {
        const decoded = decodeURIComponent(escape(str));
        if (decoded !== str) return decoded;
    } catch {
        // Not double-encoded, use as-is
    }
    return str;
}

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
    const d = useDocumentsPage({ companies, setCompanies });

    return (
        <>
        <div className="page-container" style={{ display: 'flex', flexDirection: 'row', gap: 'var(--space-6)', paddingRight: 'var(--space-6)' }}>

            {/* Sidebar: Companies List */}
            <div style={{ width: '300px', display: 'flex', flexDirection: 'column', gap: 'var(--space-4)' }}>
                <div className="flex-between">
                    <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--font-semibold)', color: 'var(--color-text-primary)' }}>Empresas</h2>
                    <button className="icon-btn" onClick={d.handleCreateCompany} title="Cadastrar Nova Empresa" style={{ background: 'var(--color-primary)', color: 'white', padding: '6px' }}>
                        <Plus size={16} />
                    </button>
                </div>

                <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--space-2)' }}>
                    {companies.map((company: CompanyProfile) => (
                        <div
                            key={company.id}
                            onClick={() => d.setSelectedCompanyId(company.id)}
                            style={{
                                padding: 'var(--space-4)',
                                backgroundColor: d.selectedCompanyId === company.id ? 'rgba(37, 99, 235, 0.03)' : 'var(--color-bg-surface)',
                                border: 'none',
                                boxShadow: d.selectedCompanyId === company.id ? '0 0 0 1px var(--color-primary), 0 4px 12px rgba(37, 99, 235, 0.06)' : '0 0 0 1px var(--color-border)',
                                borderRadius: 'var(--radius-xl)',
                                cursor: 'pointer',
                                transition: 'all 0.2s cubic-bezier(0.16, 1, 0.3, 1)',
                            }}
                        >
                            <div className="flex-between" style={{ marginBottom: '8px' }}>
                                <div className="flex-gap" style={{ color: d.selectedCompanyId === company.id ? 'var(--color-primary)' : 'var(--color-text-secondary)' }}>
                                    <Building2 size={16} />
                                    <span style={{ fontSize: 'var(--text-sm)', fontWeight: 'var(--font-semibold)', textTransform: 'uppercase' }}>
                                        {company.isHeadquarters ? 'Matriz' : 'Filial'}
                                    </span>
                                </div>
                                <div className="flex-gap" onClick={(e) => e.stopPropagation()}>
                                    <button className="icon-btn" onClick={() => d.handleEditCompany(company)} title="Editar Empresa" style={{ padding: '2px' }}>
                                        <Edit2 size={14} color="var(--color-text-secondary)" />
                                    </button>
                                    <button className="icon-btn" onClick={() => d.handleDeleteCompany(company.id)} title="Excluir Empresa" style={{ padding: '2px' }}>
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
                {d.activeCompany ? (
                    <>
                        <div style={{ padding: 'var(--space-6)', borderBottom: '1px solid var(--color-border)' }}>
                            <div className="flex-between" style={{ marginBottom: 'var(--space-6)' }}>
                                <div>
                                    <h2 style={{ fontSize: 'var(--text-2xl)', fontWeight: 'var(--font-semibold)', color: 'var(--color-text-primary)' }}>
                                        {d.activeCompany.razaoSocial}
                                    </h2>
                                    <p style={{ color: 'var(--color-text-secondary)', fontSize: 'var(--text-md)' }}>
                                        CNPJ: {d.activeCompany.cnpj}
                                    </p>
                                </div>
                                <div className="flex-gap" style={{ background: 'var(--color-bg-secondary)', padding: '4px', borderRadius: 'var(--radius-lg)', border: 'none', boxShadow: '0 0 0 1px var(--color-border)' }}>
                                    <button
                                        className={`tab-btn${d.activeTab === 'documents' ? ' active' : ''}`}
                                        onClick={() => d.setActiveTab('documents')}
                                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                                    >
                                        <FileText size={16} /> Documentos
                                    </button>
                                    <button
                                        className={`tab-btn${d.activeTab === 'credentials' ? ' active' : ''}`}
                                        onClick={() => d.setActiveTab('credentials')}
                                        style={{ display: 'flex', alignItems: 'center', gap: '6px' }}
                                    >
                                        <KeyRound size={16} /> Acessos e Senhas
                                    </button>
                                </div>
                            </div>

                            {d.activeTab === 'documents' && (
                                <div className="flex-between">
                                    <div className="flex-gap" style={{ background: 'var(--color-bg-surface)', padding: '8px 16px', borderRadius: 'var(--radius-lg)', border: 'none', boxShadow: '0 1px 2px rgba(0,0,0,0.05), 0 0 0 1px var(--color-border)', width: '320px', transition: 'all 0.2s ease' }}>
                                        <Search size={16} color="var(--color-text-secondary)" />
                                        <input
                                            type="text"
                                            placeholder="Buscar por tipo de documento..."
                                            style={{ border: 'none', background: 'transparent', outline: 'none', color: 'var(--color-text-primary)', flex: 1, fontSize: 'var(--text-md)' }}
                                            value={d.searchTerm}
                                            onChange={(e) => d.setSearchTerm(e.target.value)}
                                        />
                                    </div>
                                    <div className="flex-gap">
                                        <button
                                            className={`btn btn-outline ${d.isAlertConfigOpen ? 'active' : ''}`}
                                            onClick={() => d.setIsAlertConfigOpen(true)}
                                            style={{ gap: '8px' }}
                                        >
                                            <ShieldAlert size={16} /> Configurar Alertas
                                        </button>
                                        <input
                                            type="file"
                                            style={{ display: 'none' }}
                                            ref={d.fileInputRef}
                                            onChange={d.handleFileChange}
                                            accept=".pdf,.png,.jpg,.jpeg"
                                        />
                                        <button className="btn btn-primary" onClick={d.handleCreateDocument}>
                                            <Plus size={16} />
                                            Novo Documento
                                        </button>
                                    </div>
                                </div>
                            )}

                            {d.activeTab === 'credentials' && (
                                <div className="flex-between">
                                    <div></div>
                                    <button className="btn btn-primary" onClick={d.handleCreateCredential} style={{ backgroundColor: 'var(--color-success)', borderColor: 'var(--color-success)' }}>
                                        <Plus size={16} /> Nova Credencial
                                    </button>
                                </div>
                            )}
                        </div>

                        <div style={{ overflowX: 'auto', flex: 1 }}>
                            {d.activeTab === 'documents' && (
                                <table style={{ width: '100%', borderCollapse: 'collapse', textAlign: 'left' }}>
                                    <thead>
                                        <tr style={{ backgroundColor: 'var(--color-bg-surface-hover)', borderBottom: '1px solid var(--color-border)' }}>
                                            <th className="docs-th cursor-pointer" onClick={() => d.handleToggleSort('docType')}>
                                                <div className="flex-gap">Documento {d.sortField === 'docType' && (d.sortOrder === 'asc' ? '↑' : '↓')}</div>
                                            </th>
                                            <th className="docs-th cursor-pointer" onClick={() => d.handleToggleSort('status')}>
                                                <div className="flex-gap">Status {d.sortField === 'status' && (d.sortOrder === 'asc' ? '↑' : '↓')}</div>
                                            </th>
                                            <th className="docs-th cursor-pointer" onClick={() => d.handleToggleSort('expirationDate')}>
                                                <div className="flex-gap">Vencimento {d.sortField === 'expirationDate' && (d.sortOrder === 'asc' ? '↑' : '↓')}</div>
                                            </th>
                                            <th className="docs-th">Órgão / Link</th>
                                            <th className="docs-th">Arquivo</th>
                                            <th className="docs-th"></th>
                                        </tr>
                                    </thead>
                                    <tbody>
                                        {d.filteredDocs.length === 0 ? (
                                            <tr>
                                                <td colSpan={6} style={{ padding: '48px', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                                                    Nenhum documento encontrado para esta empresa.
                                                </td>
                                            </tr>
                                        ) : (
                                            d.filteredDocs.map((doc: CompanyDocument) => (
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
                                                            <span style={{ fontSize: '0.875rem', textDecoration: 'underline' }}>{fixEncoding(doc.fileName)}</span>
                                                        </a>
                                                    </td>
                                                    <td className="docs-td" style={{ textAlign: 'right' }}>
                                                        <div className="flex-gap" style={{ justifyContent: 'flex-end' }}>
                                                            <button className="icon-btn" onClick={() => d.handleEditDocument(doc)} title="Editar Documento">
                                                                <Edit2 size={16} color="var(--color-text-secondary)" />
                                                            </button>
                                                            <button className="icon-btn" onClick={() => d.handleDeleteDocument(doc.id)} title="Excluir Documento">
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

                            {d.activeTab === 'credentials' && (
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
                                        {!d.activeCompany.credentials || d.activeCompany.credentials.length === 0 ? (
                                            <tr>
                                                <td colSpan={5} style={{ padding: '48px', textAlign: 'center', color: 'var(--color-text-tertiary)' }}>
                                                    Nenhuma credencial ou senha salva para esta empresa.
                                                </td>
                                            </tr>
                                        ) : (
                                            d.activeCompany.credentials.map((cred: CompanyCredential) => (
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
                                                            <span style={{ fontFamily: 'monospace', fontSize: '1rem', letterSpacing: d.showPasswords[cred.id] ? 'normal' : '0.15em' }}>
                                                                {d.showPasswords[cred.id] ? cred.password : '••••••••'}
                                                            </span>
                                                            <button
                                                                className="icon-btn"
                                                                onClick={() => d.togglePasswordVisibility(cred.id)}
                                                                title={d.showPasswords[cred.id] ? "Ocultar Senha" : "Revelar Senha"}
                                                                style={{ padding: '4px' }}
                                                            >
                                                                {d.showPasswords[cred.id] ? <EyeOff size={16} /> : <Eye size={16} />}
                                                            </button>
                                                        </div>
                                                    </td>
                                                    <td className="docs-td" style={{ color: 'var(--color-text-secondary)', fontSize: '0.8rem', maxWidth: '200px' }}>
                                                        {cred.notes || '-'}
                                                    </td>
                                                    <td className="docs-td" style={{ textAlign: 'right' }}>
                                                        <div className="flex-gap" style={{ justifyContent: 'flex-end' }}>
                                                            <button className="icon-btn" onClick={() => d.handleEditCredential(cred)} title="Editar">
                                                                <Edit2 size={16} color="var(--color-text-secondary)" />
                                                            </button>
                                                            <button className="icon-btn" onClick={() => d.handleDeleteCredential(cred.id)} title="Excluir">
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
                d.isCompanyModalOpen && (
                    <CompanyFormModal
                        initialData={d.editingCompany}
                        onClose={() => d.setIsCompanyModalOpen(false)}
                        onSave={d.handleSaveCompany}
                    />
                )
            }

            {
                d.isDocumentModalOpen && d.activeCompany && (
                    <DocumentFormModal
                        initialData={d.editingDocument}
                        companyProfileId={d.activeCompany.id}
                        onClose={() => d.setIsDocumentModalOpen(false)}
                        onSave={d.handleSaveDocument}
                        groupAlertDays={d.sanitizedGroup}
                        defaultAlertDays={d.sanitizedDefault}
                    />
                )
            }

            {
                d.isCredentialModalOpen && d.activeCompany && (
                    <CredentialFormModal
                        initialData={d.editingCredential}
                        companyId={d.activeCompany.id}
                        onClose={() => d.setIsCredentialModalOpen(false)}
                        onSave={d.handleSaveCredential}
                    />
                )
            }

            {
                d.isAlertConfigOpen && (
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
                                    value={d.defaultAlertDays}
                                    onChange={(e) => d.setDefaultAlertDays(e.target.value === '' ? '' : parseInt(e.target.value, 10))}
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
                                                placeholder={`${d.defaultAlertDays || 0} (Herdado)`}
                                                value={d.groupAlertDays[group] !== undefined ? d.groupAlertDays[group] : ''}
                                                onChange={(e) => {
                                                    const val = e.target.value;
                                                    d.setGroupAlertDays(prev => {
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
                                    checked={d.applyToExisting}
                                    onChange={(e) => d.setApplyToExisting(e.target.checked)}
                                    style={{ width: '16px', height: '16px', accentColor: 'var(--color-primary)' }}
                                />
                                <label htmlFor="applyToExistingDocs" style={{ fontSize: 'var(--text-base)', color: 'var(--color-text-primary)', cursor: 'pointer', fontWeight: 'var(--font-medium)' }}>
                                    Aplicar estes novos prazos a todos os documentos existentes nesta empresa
                                </label>
                            </div>

                            <div className="flex-gap" style={{ justifyContent: 'flex-end' }}>
                                <button className="btn btn-ghost" onClick={() => d.setIsAlertConfigOpen(false)}>Cancelar</button>
                                <button className="btn btn-primary" onClick={d.handleSaveAlertConfig}>Salvar Configuração</button>
                            </div>
                        </div>
                    </div>
                )
            }
        </div >

            <ConfirmDialog
                open={!!d.confirmAction}
                title={d.confirmAction?.type === 'company' ? 'Excluir Empresa' : d.confirmAction?.type === 'document' ? 'Excluir Documento' : 'Excluir Credencial'}
                message={`Tem certeza que deseja excluir "${d.confirmAction?.label}"? Esta ação não pode ser desfeita.`}
                confirmLabel="Excluir"
                cancelLabel="Cancelar"
                variant="danger"
                onConfirm={d.executeDelete}
                onCancel={() => d.setConfirmAction(null)}
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
