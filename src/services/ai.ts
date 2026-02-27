import type { BiddingProcess, AiAnalysis } from '../types';
import { v4 as uuidv4 } from 'uuid';
import { API_BASE_URL } from '../config';

export const aiService = {
    /**
     * Simulates sending multiple PDF files text to an LLM
     * to extract structured data matching the BiddingProcess and AiAnalysis signature.
     */
    async parseEditalPDF(files: File[]): Promise<{ process: Partial<BiddingProcess>, analysis: AiAnalysis }> {
        const fileUrls: string[] = [];
        const fileNames: string[] = [];

        // 1. Upload all files
        for (const file of files) {
            const formData = new FormData();
            formData.append('file', file);

            try {
                console.log(`[AI Service] Attempting to upload file: ${file.name}`);
                const uploadResponse = await fetch(`${API_BASE_URL}/api/upload`, {
                    method: 'POST',
                    headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` },
                    body: formData
                });

                if (uploadResponse.ok) {
                    const uploadData = await uploadResponse.json();
                    fileUrls.push(uploadData.fileUrl);

                    // Use storageName (full path in bucket) if available, otherwise fallback to filename from URL
                    const fileName = uploadData.storageName || uploadData.fileUrl.split('/').pop() || '';
                    if (fileName) {
                        fileNames.push(fileName);
                    }
                } else {
                    console.error(`Failed to upload file ${file.name}`);
                }
            } catch (err) {
                console.error(`Network error during file upload for ${file.name}`, err);
                throw new Error(`Falha no upload do arquivo ${file.name}.`);
            }
        }

        if (fileNames.length === 0) {
            throw new Error("Nenhum arquivo válido enviado ou falha em todos os uploads.");
        }

        // 2. Request AI Analysis sending multiple file names
        try {
            const aiResponse = await fetch(`${API_BASE_URL}/api/analyze-edital`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({ fileNames })
            });

            if (!aiResponse.ok) {
                const errorData = await aiResponse.json();
                throw new Error(errorData.error || "Erro na análise da Inteligência Artificial.");
            }

            const aiData = await aiResponse.json();
            console.log('[AI Service] Response keys:', Object.keys(aiData));

            // Safe fallback in case the AI partially structured the response
            const process = aiData.process || aiData;
            const analysis = aiData.analysis || {};

            // Structure response mapped to the App's Interfaces
            const processData: Partial<BiddingProcess> = {
                ...process,
                link: fileUrls.join(', '), // Multiple links separated by comma
                status: 'Captado',
            };

            const analysisData: AiAnalysis = {
                id: uuidv4(),
                biddingProcessId: '', // Will be assigned upstream
                requiredDocuments: JSON.stringify(analysis.requiredDocuments || []),
                pricingConsiderations: analysis.pricingConsiderations || '',
                irregularitiesFlags: JSON.stringify(analysis.irregularitiesFlags || []),
                fullSummary: analysis.fullSummary || '',
                deadlines: JSON.stringify(analysis.deadlines || []),
                penalties: analysis.penalties || '',
                qualificationRequirements: analysis.qualificationRequirements || '',
                sourceFileNames: JSON.stringify(fileNames), // Persist uploaded PDF names for chat context
                analyzedAt: new Date().toISOString()
            };

            return { process: processData, analysis: analysisData };

        } catch (err) {
            console.error("AI parsing error:", err);
            // Re-throw with original message if it's already an Error, otherwise wrap
            if (err instanceof Error) {
                throw err;
            }
            throw new Error("A Inteligência Artificial não conseguiu interpretar este Edital. Tente novamente.");
        }
    },

    /**
     * Sends conversation history to the AI to answer questions about the previously parsed edital.
     */
    async chatWithEdital(fileNames: string[], messages: { role: 'user' | 'model', text: string }[], biddingProcessId?: string): Promise<string> {
        try {
            const aiResponse = await fetch(`${API_BASE_URL}/api/analyze-edital/chat`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                    'Authorization': `Bearer ${localStorage.getItem('token')}`
                },
                body: JSON.stringify({ fileNames, messages, biddingProcessId })
            });

            if (!aiResponse.ok) {
                const errorData = await aiResponse.json();
                throw new Error(errorData.error || "Erro na comunicação com o chat da Inteligência Artificial.");
            }

            const data = await aiResponse.json();
            return data.text;
        } catch (error) {
            console.error('Failed to chat with AI', error);
            throw error;
        }
    }
};
