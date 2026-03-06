import { PrismaClient } from "@prisma/client";
import OpenAI from "openai";
import { v4 as uuidv4 } from "uuid";
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
        model: "text-embedding-3-small", // 1536 dimensões, extremamente barato e rápido
        input: text,
    });

    return response.data[0].embedding;
}

// Extrai texto físico dos PDFs e indexa tudo no banco de dados via vetores
export async function indexDocumentChunks(biddingProcessId: string, pdfParts: any[]) {
    try {
        console.log(`[RAG] Iniciando indexação para o processo: ${biddingProcessId}`);
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
                    console.warn(`[RAG] Falha ao extrair texto do PDF ${i + 1} para indexação: ${err.message}`);
                }
            }
        }

        if (!fullExtractedText.trim()) {
            console.warn(`[RAG] Nenhum texto legível encontrado nos PDFs para o processo ${biddingProcessId}. Tente PDFs com texto claro.`);
            return;
        }

        // 2. Quebrar o texto em blocos menores (chunks) compatíveis
        const chunks = chunkText(fullExtractedText, 800);
        console.log(`[RAG] Texto dividido em ${chunks.length} chunks. Gerando embeddings...`);

        // Deleta chunks anteriores caso estejamos re-analisando o edital
        await prisma.documentChunk.deleteMany({
            where: { biddingProcessId }
        });

        // 3. Gerar Embeddings e Inserir no Banco
        // O Supabase nativo aceita arrays json [0.1, 0.2] ao invés do Unsafe Raw, mas o executeRawUnsafe converte com segurança.
        for (let i = 0; i < chunks.length; i++) {
            const textChunk = chunks[i];
            if (!textChunk.trim()) continue;

            const embedding = await generateEmbedding(textChunk);
            const metadata = { chunkIndex: i, contentLength: textChunk.length };

            await prisma.$executeRawUnsafe(
                `INSERT INTO "DocumentChunk" ("id", "biddingProcessId", "content", "metadata", "embedding", "createdAt") 
                 VALUES ($1, $2, $3, $4::jsonb, $5::vector, NOW())`,
                uuidv4(),
                biddingProcessId,
                textChunk,
                JSON.stringify(metadata),
                `[${embedding.join(',')}]`
            );
        }
        console.log(`[RAG] Concluída a indexação de ${chunks.length} chunks com sucesso para o processo ${biddingProcessId}.`);
    } catch (error: any) {
        console.error(`[RAG] Erro catastrófico ao indexar documentos:`, error.message);
    }
}

// Busca os chunks mais semelhantes matematicamente à pergunta do usuário
export async function searchSimilarChunks(biddingProcessId: string, query: string, topK: number = 7): Promise<any[]> {
    try {
        const queryEmbedding = await generateEmbedding(query);

        // Uso da métrica de similaridade cosseno "1 - (embedding <=> query)" padrão no pgvector
        const results = await prisma.$queryRawUnsafe<any[]>(
            `SELECT id, content, metadata, 1 - (embedding <=> $1::vector) as similarity
             FROM "DocumentChunk"
             WHERE "biddingProcessId" = $2
             ORDER BY embedding <=> $1::vector
             LIMIT $3`,
            `[${queryEmbedding.join(',')}]`,
            biddingProcessId,
            topK
        );

        return results;
    } catch (error: any) {
        console.error(`[RAG] Erro ao buscar similaridade: ${error.message}`);
        return [];
    }
}
