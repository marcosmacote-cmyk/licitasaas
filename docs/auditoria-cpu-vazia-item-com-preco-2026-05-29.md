# Auditoria - CPU vazia com item orcamentario ainda precificado

Data: 2026-05-29

## Invariante de dominio

Uma composicao propria vazia nao pode sustentar preco no item orcamentario.

Regra esperada:

- `EngineeringComposition.totalPrice = 0`
- `EngineeringProposalItem.compositionTotalPrice = 0`
- `EngineeringProposalItem.unitCost = 0`
- `EngineeringProposalItem.unitPrice = 0`
- `EngineeringProposalItem.totalPrice = 0`
- `priceAudit.status = SEM_MATCH`

Se qualquer um desses campos permanecer com valor antigo, o usuario ve exatamente o bug reportado: CPU vazia no editor e preco ainda ativo na planilha.

## Pontos arquiteturais auditados

### 1. Persistencia convertia zero explicito em nulo

Arquivo: `server/routes/engineering.ts`

O save de itens usava `Number(item.compositionTotalPrice) || null`. Isso transforma `0` em `null`.

Impacto: o backend perde a diferenca entre "a composicao foi zerada" e "nao recebi preco formado". Na proxima hidratacao, o motor de calculo podia manter `unitCost` antigo, ressuscitando preco fantasma.

Severidade: P0.

Acao aplicada: preservar `0` como `0`; usar `null` apenas quando o campo nao veio no payload.

### 2. Motor de calculo contradizia a propria regra de casca

Arquivos: `src/components/proposals/engineering/calculationEngine.ts` e `src/components/proposals/engineering/types.ts`

`isCompositionShell()` define que composicao propria sem `compositionTotalPrice` ou com `<= 0` e casca. Mas `recalcAllItems()` mantinha `unitCost` antigo quando `compositionTotalPrice` era `null` ou `undefined`.

Impacto: depois que o backend transformava `0` em `null`, o recalc preservava o preco antigo.

Severidade: P0.

Acao aplicada: composicao propria casca agora zera `unitCost`, `unitPrice` e `totalPrice` no recalc.

### 3. Callback do editor podia atualizar campos em estados separados

Arquivo: `src/components/proposals/engineering/EngineeringProposalEditor.tsx`

O caminho generico de `onUpdateItem` aplicava `unitCost`, `sourceName` e `compositionTotalPrice` por atualizacoes separadas de estado. Em React isso abre janela para uma renderizacao intermediaria ou autosave capturar parte do estado.

Impacto: o item pode ficar com `unitCost` antigo e `compositionTotalPrice` novo, ou vice-versa, durante a janela de autosave.

Severidade: P1.

Acao aplicada: quando o update vem do editor de composicao com `unitCost` ou `compositionTotalPrice`, os campos de dominio sao aplicados em uma unica atualizacao atomica.

### 4. Auto-sync ignorava total zero

Arquivo: `src/components/proposals/engineering/CompositionEditor.tsx`

O efeito de sincronizacao retornava cedo em `ct <= 0`. Isso fazia sentido para evitar ruido, mas criava assimetria: totais positivos podiam ser sincronizados; total zero nao corrigia item orcamentario stale.

Impacto: uma CPU vazia podia continuar exibindo preco antigo na planilha.

Severidade: P1.

Acao aplicada: quando a CPU propria raiz soma zero e o item ainda tem preco, o editor propaga explicitamente `unitCost = 0` e `compositionTotalPrice = 0`.

### 5. Multiplas autoridades de preco continuam sendo risco estrutural

Hoje existem pelo menos quatro representacoes concorrentes:

- soma real dos insumos da CPU (`sumCompositionGroups`)
- snapshot da CPU (`EngineeringComposition.totalPrice`)
- preco formado no item (`EngineeringProposalItem.compositionTotalPrice`)
- preco usado na planilha (`EngineeringProposalItem.unitCost`)

Enquanto essas quatro fontes puderem divergir, bugs desse tipo podem reaparecer.

Recomendacao estrutural: para composicao propria, `unitCost` deve ser sempre derivado de `compositionTotalPrice`, e `compositionTotalPrice` deve ser derivado da CPU analitica. O campo `unitCost` pode continuar persistido por performance/relatorio, mas deve ser tratado como cache derivado, nunca como autoridade.

## Sequencia provavel do bug

1. Usuario limpa a composicao.
2. Backend limpa os insumos e zera a CPU.
3. Frontend mostra CPU vazia e total R$ 0,00.
4. Um save/autosave envia `compositionTotalPrice = 0`.
5. Backend converte `0` para `null`.
6. Na proxima hidratacao/recalc, `compositionTotalPrice` vem ausente.
7. O motor preserva `unitCost` antigo.
8. A planilha volta a exibir R$ 921,04 / R$ 1.162,26 / R$ 23.245,20 enquanto a CPU segue vazia.

## Plano corretivo

### Imediato

- Preservar zero explicito no backend.
- Zerar composicoes proprias casca no motor unico de calculo.
- Tornar o callback CPU -> item atomico.
- Fazer sincronizacao de zero no editor.
- Rodar testes focados de `calculationEngine`.
- Rodar build frontend e build backend.

### Proximo passo estrutural

- Criar helper unico `deriveProposalItemFromComposition(item, compositionSnapshot, config)`.
- Proibir escrita direta de `unitCost` para composicao propria fora desse helper.
- Persistir `compositionState`: `EMPTY`, `FORMED`, `STALE`, `OFFICIAL_REFERENCE`.
- Mostrar badge bloqueante na linha quando `compositionState = EMPTY` e `unitCost > 0`.
- Adicionar teste de regressao cobrindo limpar CPU, autosave e reload da proposta.
