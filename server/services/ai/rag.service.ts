import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";
import { logger } from '../../lib/logger';
const pdfParse = require("pdf-parse");

const prisma = new PrismaClient();

// Divide um texto grande em blocos/parágrafos menores
export function chunkText(text: string, maxTokens: number = 800): string[] {
    // Estimativa bruta: 1 token = ~4 caracteres. maxTokens * 4.
    const maxChars = maxTokens * 4;
    const paragraphs = text.split(/\n\s*\n/);
    const chunks: string[] = [];
    let currentChunk = "";

    for (const paragraph of paragraphs) {
        if ((currentChunk.length + paragraph.length) > maxChars) {
            if (currentChunk.trim().length > 0) {
                chunks.push(currentChunk.trim());
            }
            currentChunk = "";
        }
        currentChunk += paragraph + "\n\n";
    }

    if (currentChunk.trim().length > 0) {
        chunks.push(currentChunk.trim());
    }

    return chunks;
}

// Gera o vetor numérico (embedding) para um texto usando OpenAI
export async function generateEmbedding(text: string): Promise<number[]> {
    const apiKey = process.env.OPENAI_API_KEY;
    if (!apiKey) throw new Error("OPENAI_API_KEY is not configured.");

    const openai = new OpenAI({ apiKey });
    const response = await openai.embeddings.create({
        model: "text-embedding-3-small", // 1536 dimensões
        input: text,
    });

    return response.data[0].embedding;
}

// Extrai texto físico dos PDFs e indexa tudo no banco de dados
export async function indexDocumentChunks(biddingProcessId: string, pdfParts: any[]) {
    try {
        logger.info(`[RAG] Iniciando indexação para o processo: ${biddingProcessId}`);
        // 1. Extrair texto de todas as partes PDF usando pdf-parse
        let fullExtractedText = "";
        for (let i = 0; i < pdfParts.length; i++) {
            const part = pdfParts[i];
            if (part?.inlineData?.mimeType === 'application/pdf') {
                try {
                    const buffer = Buffer.from(part.inlineData.data, 'base64');
                    const data = await pdfParse(buffer);
                    fullExtractedText += `\n--- Documento ${i + 1} ---\n` + data.text;
                } catch (err: any) {
                    logger.warn(`[RAG] Falha ao extrair texto do PDF ${i + 1} para indexação: ${err.message}`);
                }
            }
        }

        if (!fullExtractedText.trim()) {
            logger.warn(`[RAG] Nenhum texto legível encontrado nos PDFs para o processo ${biddingProcessId}.`);
            return;
        }

        // 2. Quebrar o texto em blocos menores (chunks) compatíveis
        const chunks = chunkText(fullExtractedText, 800);
        logger.info(`[RAG] Texto dividido em ${chunks.length} chunks. Gerando embeddings...`);

        // Deleta chunks anteriores caso estejamos re-analisando o edital
        await prisma.documentChunk.deleteMany({
            where: { biddingProcessId }
        });

        // 3. Gerar Embeddings e Inserir no Banco 
        const BATCH_SIZE = 50;
        for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
            const batch = chunks.slice(i, i + BATCH_SIZE);
            const batchPromises = batch.map(async (textChunk, batchIndex) => {
                if (!textChunk.trim()) return null;
                const embedding = await generateEmbedding(textChunk);
                return {
                    biddingProcessId,
                    content: textChunk,
                    metadata: { chunkIndex: i + batchIndex, contentLength: textChunk.length },
                    embedding: embedding
                };
            });

            const resolvedBatch = (await Promise.all(batchPromises)).filter(Boolean) as any[];
            if (resolvedBatch.length > 0) {
                await prisma.documentChunk.createMany({
                    data: resolvedBatch
                });
            }
        }
        logger.info(`[RAG] Concluída a indexação de ${chunks.length} chunks com sucesso para o processo ${biddingProcessId}.`);
    } catch (error: any) {
        logger.error(`[RAG] Erro catastrófico ao indexar documentos:`, error.message);
    }
}

// Calcula a Similaridade de Cosseno (Cosine Similarity) entre dois vetores em memória
function cosineSimilarity(vecA: number[], vecB: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < vecA.length; i++) {
        dotProduct += vecA[i] * vecB[i];
        normA += vecA[i] * vecA[i];
        normB += vecB[i] * vecB[i];
    }
    if (normA === 0 || normB === 0) return 0;
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
}

// Busca os chunks mais semelhantes matematicamente à pergunta do usuário usando cálculo em memória
export async function searchSimilarChunks(biddingProcessId: string, query: string, topK: number = 7): Promise<any[]> {
    try {
        const queryEmbedding = await generateEmbedding(query);

        // Em vez de usar a extensão pgvector, trazemos os chunks (que são poucos por edital, ex: 100-300 registros) 
        // e calculamos a distância cosceno localmente (Memory/JS). Esse approach salva de crashes no postgres Railway 
        // e é incrivelmente rápido num array de 300 posições O(N).
        const chunks = await prisma.documentChunk.findMany({
            where: { biddingProcessId }
        });

        if (!chunks || chunks.length === 0) return [];

        const scoredChunks = chunks.map(chunk => {
            const chunkEmbedding = chunk.embedding as number[];
            let similarity = 0;
            if (Array.isArray(chunkEmbedding) && chunkEmbedding.length === queryEmbedding.length) {
                similarity = cosineSimilarity(queryEmbedding, chunkEmbedding);
            }
            return {
                id: chunk.id,
                content: chunk.content,
                metadata: chunk.metadata,
                similarity
            };
        });

        // Ordenar do mais similar (1) pro menos similar (-1)
        scoredChunks.sort((a, b) => b.similarity - a.similarity);

        // Retornar os TopK
        return scoredChunks.slice(0, topK);
    } catch (error: any) {
        logger.error(`[RAG] Erro ao buscar similaridade em memória: ${error.message}`);
        return [];
    }
}
