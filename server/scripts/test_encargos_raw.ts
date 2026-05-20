import { GoogleGenAI, Type } from '@google/genai';
import * as fs from 'fs';
import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.join(__dirname, '../.env') });

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const n = { type: Type.NUMBER };
const encargosSchema = {
    type: Type.OBJECT,
    properties: {
        found: { type: Type.BOOLEAN }, basePrincipal: { type: Type.STRING, nullable: true },
        totalHorista: { type: Type.NUMBER }, totalMensalista: { type: Type.NUMBER },
        a1_h: n, a1_m: n, a2_h: n, a2_m: n, a3_h: n, a3_m: n,
        a4_h: n, a4_m: n, a5_h: n, a5_m: n, a6_h: n, a6_m: n,
        a7_h: n, a7_m: n, a8_h: n, a8_m: n, a9_h: n, a9_m: n,
        b1_h: n, b1_m: n, b2_h: n, b2_m: n, b3_h: n, b3_m: n,
        b4_h: n, b4_m: n, b5_h: n, b5_m: n, b6_h: n, b6_m: n,
        b7_h: n, b7_m: n, b8_h: n, b8_m: n, b9_h: n, b9_m: n,
        b10_h: n, b10_m: n,
        c1_h: n, c1_m: n, c2_h: n, c2_m: n, c3_h: n, c3_m: n,
        c4_h: n, c4_m: n, c5_h: n, c5_m: n,
        d1_h: n, d1_m: n, d2_h: n, d2_m: n,
        details: { type: Type.STRING, nullable: true }
    },
    required: ['found', 'totalHorista', 'totalMensalista']
};

const encargosPrompt = `Você é um engenheiro orçamentista. Analise os documentos e encontre a TABELA DE ENCARGOS SOCIAIS detalhada.

🚨 DIRETRIZES DE CONTROLE E ALUCINAÇÃO (LEIA COM ATENÇÃO):
1. Você deve retornar found=false se o documento NÃO contém a composição detalhada dos encargos sociais (ou seja, se NÃO apresenta os grupos A, B, C e D destrinchados com os valores de cada item de A1 a D2).
2. Se o documento contiver apenas os percentuais globais/finais (ex: "Encargos Sociais: Horista = 92.17%, Mensalista = 53.50%") sem a tabela detalhada de grupos, NÃO tente inventar ou preencher os itens individuais com base no SINAPI ou em seu conhecimento. Marque found=false e explique isso no campo "details".
3. Se e somente se houver uma tabela detalhada com os itens de cada grupo (A1 a D2), marque found=true e copie os valores exatos. Se um item específico da tabela estiver em branco/não mencionado, retorne 0 para ele.

A tabela de encargos detalhada tem 4 GRUPOS com colunas HORISTA (%) e MENSALISTA (%):

GRUPO A — Encargos Sociais Básicos:
  A1=INSS, A2=SESI, A3=SENAI, A4=INCRA, A5=SEBRAE, A6=Sal.Educação, A7=SAT/RAT, A8=FGTS, A9=SECONCI

GRUPO B — Encargos Trabalhistas:
  B1=Repouso Semanal, B2=Feriados, B3=Aux.Enfermidade, B4=13º Salário, B5=Lic.Paternidade,
  B6=Faltas Justificadas, B7=Dias de Chuvas, B8=Aux.Acidente, B9=Férias Gozadas, B10=Sal.Maternidade

GRUPO C — Encargos Rescisórios:
  C1=AP Indenizado, C2=AP Trabalhado, C3=Férias Indenizadas, C4=Dep.Rescisão, C5=Ind.Adicional

GRUPO D — Reincidências:
  D1=Reincidência A sobre B, D2=Reinc.A/AP + FGTS/AP

⚠️ A tabela COMPLETA tem os 4 grupos. O Total Horista normalmente fica entre 80% e 130%.
Se seu total ficou menor que 50%, você PERDEU grupos. Procure MELHOR no documento.

PROCURE em TODAS as páginas por:
- Tabelas "ENCARGOS SOCIAIS", "LEIS SOCIAIS"
- Colunas "HORISTA %" e "MENSALISTA %"
- Subtotais de cada grupo (A, B, C, D)

RETORNE JSON com TODOS estes campos (use 0 para itens não encontrados):
{
  "found": true, "basePrincipal": "SINAPI",
  "totalHorista": 115.10, "totalMensalista": 71.84,
  ... (todos os 52 campos) ...
  "details": "Mensagem descritiva"
}`;

async function main() {
    const filePath = '/Users/marcosgomes/Downloads/5._ANEXO_4_.pdf';
    const buffer = fs.readFileSync(filePath);
    const base64 = buffer.toString('base64');

    console.log('Calling Gemini with Key:', process.env.GEMINI_API_KEY ? 'FOUND' : 'MISSING');
    const result = await ai.models.generateContent({
        model: 'gemini-2.5-flash',
        contents: [
            { inlineData: { data: base64, mimeType: 'application/pdf' } },
            { text: encargosPrompt }
        ],
        config: { responseMimeType: 'application/json', responseSchema: encargosSchema, temperature: 0.1 }
    });

    console.log('RAW JSON response:');
    console.log(result.text);
}

main().catch(console.error);
