import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act, waitFor } from '@testing-library/react';
import { useAiChat } from '../useAiChat';
import { createAnalysis, createBidding, resetMocks } from '../../../test/helpers';
import type { AiAnalysis, BiddingProcess } from '../../../../types';

// Mock aiService
vi.mock('../../../services/ai', () => ({
    aiService: {
        chatWithEdital: vi.fn(),
    }
}));

// Mock axios
vi.mock('axios', () => ({
    default: {
        post: vi.fn().mockResolvedValue({ data: {} }),
    }
}));

import { aiService } from '../../../services/ai';
import axios from 'axios';

describe('useAiChat', () => {
    let analysis: AiAnalysis;
    let process: BiddingProcess;
    const onUpdate = vi.fn();

    beforeEach(() => {
        resetMocks();
        onUpdate.mockClear();
        (aiService.chatWithEdital as ReturnType<typeof vi.fn>).mockReset();
        (axios.post as ReturnType<typeof vi.fn>).mockReset().mockResolvedValue({ data: {} });

        analysis = createAnalysis({ chatHistory: undefined, sourceFileNames: JSON.stringify(['edital.pdf']) });
        process = createBidding({ id: 'bid-1', link: '/uploads/edital.pdf' });
    });

    const renderUseAiChat = () => renderHook(() => useAiChat({ analysis, process, onUpdate }));

    // ═══════════════════════════════════
    // INITIAL STATE
    // ═══════════════════════════════════
    describe('Estado Inicial', () => {
        it('deve inicializar com mensagens vazias quando chatHistory vazio', () => {
            const { result } = renderUseAiChat();
            expect(result.current.messages).toEqual([]);
        });

        it('deve carregar chatHistory existente', () => {
            const history = [{ id: '1', role: 'user', text: 'Pergunta' }, { id: '2', role: 'model', text: 'Resposta' }];
            analysis.chatHistory = JSON.stringify(history);
            const { result } = renderUseAiChat();
            expect(result.current.messages).toHaveLength(2);
        });

        it('deve lidar com chatHistory inválido', () => {
            analysis.chatHistory = 'invalid json';
            const { result } = renderUseAiChat();
            expect(result.current.messages).toEqual([]);
        });

        it('deve inicializar inputText vazio', () => {
            const { result } = renderUseAiChat();
            expect(result.current.inputText).toBe('');
        });

        it('deve inicializar isSending false', () => {
            const { result } = renderUseAiChat();
            expect(result.current.isSending).toBe(false);
        });
    });

    // ═══════════════════════════════════
    // SENDING MESSAGES
    // ═══════════════════════════════════
    describe('Envio de Mensagens', () => {
        it('não deve enviar mensagem vazia', async () => {
            const { result } = renderUseAiChat();
            await act(async () => result.current.handleSendMessage());
            expect(aiService.chatWithEdital).not.toHaveBeenCalled();
        });

        it('deve enviar mensagem e receber resposta da IA', async () => {
            (aiService.chatWithEdital as ReturnType<typeof vi.fn>).mockResolvedValueOnce('Resposta da IA');

            const { result } = renderUseAiChat();
            act(() => result.current.setInputText('Qual o prazo?'));

            await act(async () => result.current.handleSendMessage());

            await waitFor(() => {
                expect(result.current.messages).toHaveLength(2);
                expect(result.current.messages[0].role).toBe('user');
                expect(result.current.messages[0].text).toBe('Qual o prazo?');
                expect(result.current.messages[1].role).toBe('model');
                expect(result.current.messages[1].text).toBe('Resposta da IA');
            });
        });

        it('deve aceitar textToOverride como parâmetro', async () => {
            (aiService.chatWithEdital as ReturnType<typeof vi.fn>).mockResolvedValueOnce('OK');

            const { result } = renderUseAiChat();
            await act(async () => result.current.handleSendMessage('Texto override'));

            await waitFor(() => {
                expect(result.current.messages[0].text).toBe('Texto override');
            });
        });

        it('deve setar isSending durante envio', async () => {
            let resolveChat!: (v: string) => void;
            (aiService.chatWithEdital as ReturnType<typeof vi.fn>).mockReturnValueOnce(
                new Promise(resolve => { resolveChat = resolve; })
            );

            const { result } = renderUseAiChat();

            // Set input text first
            await act(async () => {
                result.current.setInputText('Pergunta');
            });

            // Start sending
            let sendPromise: Promise<void>;
            await act(async () => {
                sendPromise = result.current.handleSendMessage();
            });

            // Should be sending now
            expect(result.current.isSending).toBe(true);

            // Resolve the chat
            await act(async () => {
                resolveChat('Resposta');
                await sendPromise!;
            });

            expect(result.current.isSending).toBe(false);
        });

        it('deve limpar inputText após enviar', async () => {
            (aiService.chatWithEdital as ReturnType<typeof vi.fn>).mockResolvedValueOnce('OK');

            const { result } = renderUseAiChat();
            await act(async () => {
                result.current.setInputText('Pergunta');
            });
            await act(async () => {
                await result.current.handleSendMessage();
            });

            expect(result.current.inputText).toBe('');
        });

        it('deve persistir chatHistory no backend', async () => {
            (aiService.chatWithEdital as ReturnType<typeof vi.fn>).mockResolvedValueOnce('Resposta');

            const { result } = renderUseAiChat();
            await act(async () => {
                result.current.setInputText('Pergunta');
            });
            await act(async () => {
                await result.current.handleSendMessage();
            });

            await waitFor(() => {
                expect(axios.post).toHaveBeenCalledWith(
                    expect.stringContaining('/api/analysis'),
                    expect.objectContaining({
                        biddingProcessId: 'bid-1',
                        chatHistory: expect.any(String),
                    }),
                    expect.any(Object)
                );
            });
        });

        it('deve chamar onUpdate após persistir', async () => {
            (aiService.chatWithEdital as ReturnType<typeof vi.fn>).mockResolvedValueOnce('OK');

            const { result } = renderUseAiChat();
            await act(async () => {
                result.current.setInputText('Test');
            });
            await act(async () => {
                await result.current.handleSendMessage();
            });

            await waitFor(() => {
                expect(onUpdate).toHaveBeenCalled();
            });
        });
    });

    // ═══════════════════════════════════
    // ERROR HANDLING
    // ═══════════════════════════════════
    describe('Tratamento de Erros', () => {
        it('deve adicionar mensagem de erro quando chat falha', async () => {
            (aiService.chatWithEdital as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Timeout'));

            const { result } = renderUseAiChat();
            await act(async () => {
                result.current.setInputText('Pergunta');
            });
            await act(async () => {
                await result.current.handleSendMessage();
            });

            await waitFor(() => {
                const lastMsg = result.current.messages[result.current.messages.length - 1];
                expect(lastMsg.role).toBe('model');
                expect(lastMsg.text).toContain('Falha');
            });
        });

        it('deve setar isSending false mesmo com erro', async () => {
            (aiService.chatWithEdital as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error('Error'));

            const { result } = renderUseAiChat();
            await act(async () => {
                result.current.setInputText('Test');
            });
            await act(async () => {
                await result.current.handleSendMessage();
            });

            expect(result.current.isSending).toBe(false);
        });
    });
});
