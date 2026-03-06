# Plano de Evolução de Arquitetura de IA
## LicitaSaaS – Análise Inteligente de Editais

Este documento analisa o plano de evolução sugerido para nossa arquitetura de IA, validando-o em relação ao código atual e delineando os próximos passos de implementação.

### FASE 1 — DIAGNÓSTICO DA ARQUITETURA

#### Como o pipeline atual envia PDFs para o Gemini?
Atualmente, o processo `api/analyze-edital` (e `api/pncp/analyze`) converte arquivos PDFs (até 5 documentos no caso do PNCP, com extração inclusive dentro de ZIPs e RARs) em partes de buffer base64 (`mimeType: 'application/pdf'`). Essas partes compõem um array `pdfParts` que é enviado, inteiro e sem extração prévia de texto via bibliotecas, usando a capacidade Multimodal (`vision/PDF OCR`) nativa do modelo `gemini-2.5-flash` pelo SDK `@google/genai`. É feita uma validação por `tenantId` para os anexos proprietários (Supabase) visando segurança.

#### Existe algum limite de páginas ou tamanho de arquivo?
O limite explícito atual via código não se dá em número de páginas por arquivo, mas sim:
1. No PNCP: limita a no máximo **5 arquivos PDF**.
2. Nos downloads: as requisições falham e pulam arquivos por conta de `timeout: 90000` ou estouram a memória se o PDF for insanamente enorme.
3. No lado da IA: O limite virtual é o limite da janela de contexto do `gemini-2.5-flash` (que passa de 1M de tokens, embora exista uma configuração de output definida via `maxOutputTokens: 32768`).

#### Como está estruturado o JSON final retornado?
O JSON possui o seguinte schema validado na extração via `robustJsonParse`:
```json
{
  "process": {
    "title": "String",
    "summary": "String (>300 palavras)",
    "modality": "String",
    "portal": "String",
    "estimatedValue": "Number",
    "sessionDate": "ISO String",
    "risk": "Baixo|Médio|Alto|Crítico"
  },
  "analysis": {
    "requiredDocuments": "Object JSON",
    "biddingItems": "String",
    "pricingConsiderations": "String",
    "irregularitiesFlags": "Array<String> (ou String)",
    "fullSummary": "String (>400 palavras)",
    "deadlines": "Array<String> (ou String)",
    "penalties": "String",
    "qualificationRequirements": "String"
  }
}
```

#### Onde exatamente ocorre o robustJsonParse?
Dentro de `server/index.ts`, o `robustJsonParse` recebe o `rawText` da resposta do modelo e passa por 5 estágios (1: Regex clean, 2: Parsing nativo, 3: Depth-tracking truncation, 4: Error-based truncation guiada, 5: Stack repair para colchetes faltantes). Uma vez consertado, ele entra na rota e é consolidado pelas propriedades acima.

#### Como o chat contextual acessa os documentos?
O endpoint `/api/analyze-edital/chat` agrupa novamente o mesmo buffer (`inlineData: base64`) dos PDFs selecionados, envia numa mensagem multimodal junto do histórico da conversa para dar a continuidade e contexto, sem nenhum tipo de RAG local por vetorização.

#### Diagrama de Fluxo Atual (Mermaid)

```mermaid
flowchart TD
    User([Usuário]) -->|Upload PDF / Busca PNCP| API[Server Node.js]
    API --> Validate[Validação Tenant & DB Sync]
    Validate --> Download[Bufferizar PDFs Base64]
    Download --> ZIP[Check de ZIP/RAR]
    ZIP --> GeminiSDK[SDK - genai]
    
    GeminiSDK -->|Payload Multimodal| Gemini[☁️ Gemini 2.5 Flash]
    Gemini -->|Resposta JSON (às vezes unclosed)| Parse[robustJsonParse]
    
    Parse -.->|Se falhar| StackRepair[Stack/Bracket Repair]
    StackRepair --> JSONValid[JSON Válido]
    Parse -.->|Se passar| JSONValid
    
    JSONValid --> Prisma[DB Persistência]
    Prisma --> App[Kanban Board]
```

### Riscos de Mudança e Feedback às Sugestões (Visão Arquitetural)

1. **Sobre a Fase 2 (Chunking Semântico do Edital vs Atual Multimodal):**
   *Risco Crítico*: Substituir o modelo atual, onde o Gemini "lê visualmente" todo o PDF, por um modelo de OCR prévio + Segmentação via código, pode ser um grande regresso tecnológico. O OCR de PDFs escaneados (imagens) é a especialidade do Gemini 1.5/2.5 Pro e Flash. Desenvolver um script node.js para fazer OCR + Chunking é complexo, propenso a falhas judiciais (cortar parágrafos vitais no meio) e perderia a visão global que o modelo multimodal nativo tem atualmente. A abordagem atual Multi-modal é *state-of-the-art* (SOTA).
   *Proposta*: Em vez de quebrar em chunks "burros" antes, podemos enviar o PDF Multimodal inteiro, mas com um prompt encadeado (multi-step chain of thought), instruindo o próprio modelo a primeiro *sumarizar as regiões de bounding box* e depois emitir o JSON final.

2. **Sobre a Fase 3 (Arquitetura Multi-Modelo):**
   *Totalmente Viável*. Extrair a lógica do prompt de `server/index.ts` para um pattern "Strategy" no backend, com injetores para OpenAI e Anthropic, é um avanço natural. Além de prover redundância no caso de indisponibilidade da Google Auth/Rate Limit, de fato, os modelos são melhores em tarefas diferentes. 
   
3. **Sobre a Fase 4 (Detecção de Risco):**
   A arquitetura atual **já faz isso** na propriedade `irregularitiesFlags: [ "Pontos de atenção..." ]` retornada no JSON e na propriedade `process.risk` ("Baixo/Médio/Crítico"). A proposta foca em tornar esse ponto ainda mais rígido no esquema (JSON Schema), o que é excelente.

4. **Sobre Fase 6 (RAG Chat Avançado):**
   *Muito promissor*. O chat atual é pesado e caro pois envia o PDF inteiro (frequentemente com >100 páginas de peso visual) em CADA interação do chat. Vectorizar os textos (com Langchain/Supabase Vector) faria do chat uma arma letal de precisão rápida, mitigando custos vertiginosamente.

### PRÓXIMAS AÇÕES (Roadmap Mínimo Viável)
1. Extrair toda a lógica de chamada de IA no `server/index.ts` (que já chega a mais de 150 linhas em duas rotas) para uma pasta `services/ai/`.
2. Criar a **Interface Unificadora** (Router de IA) e incluir OpenAI como redundância do Gemini (OpenAI não lê PDF nativo da mesma forma mágica que o Gemini, requerendo transcrição ou uso restrito da `vision API` e custo por token/base64 de página, o que é um ponto de atenção).
3. Testar `pgvector` ou Supabase Vector para preparar a nova fase do Chat.

