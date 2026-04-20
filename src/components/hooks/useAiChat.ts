import { useState, useRef } from 'react';
import { API_BASE_URL } from '../../config';
import { aiService } from '../../services/ai';
import axios from 'axios';
import type { AiAnalysis, BiddingProcess } from '../../types';

// ════════════════════════════════════════
//  useAiChat — extracted chat logic from AiReportModal
// ════════════════════════════════════════

export interface ChatMessage {
    id: string;
    role: 'user' | 'model';
    text: string;
}

interface UseAiChatParams {
    analysis: AiAnalysis;
    process: BiddingProcess;
    onUpdate: () => void;
}

export function useAiChat({ analysis, process, onUpdate }: UseAiChatParams) {
    const [messages, setMessages] = useState<ChatMessage[]>(() => {
        try {
            return typeof analysis?.chatHistory === 'string'
                ? JSON.parse(analysis?.chatHistory)
                : (analysis?.chatHistory || []);
        } catch (e) {
            console.error("Failed to parse chat history:", e);
            return [];
        }
    });
    const [inputText, setInputText] = useState('');
    const [isSending, setIsSending] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    const scrollToBottom = () => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    };

    const handleSendMessage = async (textToOverride?: string) => {
        const textToUse = textToOverride || inputText;
        if (!textToUse.trim() || isSending) return;

        const userMsg: ChatMessage = { id: Date.now().toString(), role: 'user', text: textToUse.trim() };
        setMessages((prev: ChatMessage[]) => [...prev, userMsg]);
        setInputText('');
        setIsSending(true);

        try {
            let fileNames: string[] = [];
            if (analysis?.sourceFileNames) {
                try {
                    fileNames = JSON.parse(analysis.sourceFileNames);
                } catch (e) {
                    console.error("Failed to parse sourceFileNames", e);
                }
            }

            if (fileNames.length === 0 && process?.link) {
                const urls = process?.link.split(',').map(u => u.trim());
                fileNames = urls.map(url => url.split('/').pop() || '').filter(Boolean);
            }
            const currentMessagesForAI = [...messages, userMsg].map(m => ({ role: m.role, text: m.text }));
            const replyText = await aiService.chatWithEdital(fileNames, currentMessagesForAI, process?.id);

            const modelMsg: ChatMessage = { id: (Date.now() + 1).toString(), role: 'model', text: replyText };
            const updatedMessages = [...messages, userMsg, modelMsg];
            setMessages(updatedMessages);

            try {
                // Mutate the local analysis object so the parent has the updated history when exporting
                analysis.chatHistory = JSON.stringify(updatedMessages);

                if (process?.id && process.id !== 'pncp-temp') {
                    const { biddingProcessId: _bId, ...analysisData } = analysis as any;
                    await axios.post(`${API_BASE_URL}/api/analyze-edital/analysis`, {
                        biddingProcessId: process.id,
                        ...analysisData,
                        sourceFileNames: analysis.sourceFileNames,
                        chatHistory: analysis.chatHistory
                    }, {
                        headers: { 'Authorization': `Bearer ${localStorage.getItem('token')}` }
                    });
                }
                onUpdate();
            } catch (err) {
                console.error("Failed to persist chat history:", err);
            }
        } catch (error: any) {
            const errorMsg: ChatMessage = {
                id: (Date.now() + 1).toString(),
                role: 'model',
                text: `[Falha] Erro ao se comunicar com o consultor: ${error.message}`
            };
            setMessages(prev => [...prev, errorMsg]);
        } finally {
            setIsSending(false);
        }
    };

    return {
        messages,
        inputText,
        setInputText,
        isSending,
        messagesEndRef,
        scrollToBottom,
        handleSendMessage,
    };
}
