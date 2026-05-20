import { GoogleGenAI } from '@google/genai';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

async function analyzePdf(filePath: string) {
    console.log(`Analyzing ${filePath}...`);
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');

    try {
        const response = await ai.models.generateContent({
            model: 'gemini-2.5-flash',
            contents: [
                { inlineData: { data: base64, mimeType: 'application/pdf' } },
                { text: `Você é um assistente de engenharia. Analise este documento PDF e responda:
1. Este documento contém alguma tabela detalhada (planilha analítica) de encargos sociais? (com os grupos A, B, C, D destrinchados com seus respectivos itens)? Se sim, em quais páginas (número de página físico/1-based)?
2. Este documento contém alguma tabela detalhada ou composição de BDI? Se sim, em quais páginas?
3. Forneça um breve resumo das tabelas encontradas e em quais páginas elas se localizam.` }
            ],
            config: { temperature: 0.1 }
        });

        console.log(`Result for ${path.basename(filePath)}:`);
        console.log(response.text);
        console.log('==================================================');
    } catch (err: any) {
        console.error(`Error analyzing ${filePath}:`, err.message);
    }
}

async function main() {
    await analyzePdf('/Users/marcosgomes/Downloads/3._ANEXO_2_.pdf');
    await analyzePdf('/Users/marcosgomes/Downloads/5._ANEXO_4_.pdf');
}

main().catch(console.error);
