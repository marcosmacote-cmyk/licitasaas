export const API_BASE_URL = import.meta.env.VITE_API_URL || '';
export const API_URLS = {
    auth: `${API_BASE_URL}/api/auth`,
    biddings: `${API_BASE_URL}/api/biddings`,
    analysis: `${API_BASE_URL}/api/analysis`,
    companies: `${API_BASE_URL}/api/companies`,
    documents: `${API_BASE_URL}/api/documents`,
    upload: `${API_BASE_URL}/api/upload`,
    assets: `${API_BASE_URL}/uploads`
};
