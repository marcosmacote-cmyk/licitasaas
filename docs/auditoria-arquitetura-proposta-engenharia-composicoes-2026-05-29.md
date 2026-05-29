# Auditoria Arquitetural — Proposta de Engenharia / Integridade de Composições

Data: 2026-05-29

Artefato analisado:
`/Users/marcosgomes/.gemini/antigravity-ide/knowledge/licitasaas-composition-price-integrity/artifacts/composition-price-integrity.md`

## Resumo executivo

O problema de composição PROPRIA não é apenas um bug pontual de arredondamento ou cache. A falha é estrutural: o sistema ainda não tem um contrato imutável para preço salvo de linha de composição, total da composição e custo do item orçamentário.

Hoje uma composição editada pode ser salva corretamente, mas ao carregar novamente o backend e o frontend tratam a leitura como uma oportunidade de recalcular, re-enriquecer ou normalizar valores. Isso viola a regra fundamental de orçamento: a composição salva deve ser a fonte de verdade do orçamento.

Invariante que precisa ser protegida:

```text
Para uma composição PROPRIA da proposta P:

EngineeringComposition.totalPrice
  == sum(EngineeringCompositionItem.subtotalSnapshot)
  == EngineeringProposalItem.unitCost * referenceDivisor

com tolerância máxima de centavos conforme a precisão da proposta.
```

Carregar uma composição PROPRIA não deve consultar preço oficial, não deve trocar preço por regime, não deve recalcular por `EngineeringItem.price` e não deve corrigir coeficiente de forma silenciosa.

## Achados críticos

### P0. GET de composição PROPRIA ainda re-enriquece preços oficiais

O artefato informa que o bloco destrutivo `enrichWithOfficialPrices` teria sido removido. No código atual ele ainda existe em `server/routes/engineering.ts`.

Trecho observado:

- `server/routes/engineering.ts:1054` ativa re-enriquecimento quando `sourceName === 'PROPRIA'`.
- `server/routes/engineering.ts:1088` chama `enrichWithOfficialPrices`.
- `server/routes/engineering.ts:1102-1107` sobrescreve `ci.item.price`, `ci.auxiliaryComposition.totalPrice` e `ci.price`.

Impacto: uma composição salva como própria pode abrir com preços da base oficial atual, de outro regime ou de outra data-base. Isso explica o sintoma de o orçamento guardar um valor e a composição recarregada exibir outro.

Ação imediata: remover esse enriquecimento do path de leitura PROPRIA. Para PROPRIA, a leitura deve usar snapshots salvos, não preço oficial.

### P0. Backend recalcula `totalDirect` a partir do preço mutável do JOIN

Em `server/routes/engineering.ts:1151-1158`, o backend calcula `totalDirect` com:

```text
coefficient * (ci.item.price || ci.auxiliaryComposition.totalPrice)
```

Isso ignora o subtotal salvo em `EngineeringCompositionItem.price`. Como `ci.item.price` vem da tabela `EngineeringItem`, ele pode refletir preço oficial, preço atualizado no banco ou preço re-enriquecido.

Impacto: mesmo que `EngineeringCompositionItem.price` esteja correto, a resposta final pode apresentar total divergente.

Ação imediata: para PROPRIA, `totalDirect` e `totalPrice` devem ser `sum(ci.price)`, com a mesma precisão da proposta.

### P0. Frontend normaliza composição própria recalculando linhas

Em `src/components/proposals/engineering/CompositionEditor.tsx`:

- `getLineUnitPrice` usa `ci.item.price` ou `ci.auxiliaryComposition.totalPrice` (`:204-207`).
- `getLineSubtotal` recalcula `coefficient * unitPrice` antes de considerar `ci.price` (`:209-216`).
- `normalizeCompositionMath` sobrescreve `ci.price` com o subtotal recalculado (`:219-260`).
- `loadComposition` chama `normalizeCompositionMath` imediatamente após o GET (`:796`).

Impacto: mesmo que o backend devolva `ci.price` correto, o frontend pode substituí-lo pelo valor calculado a partir de uma referência mutável.

Ação imediata: para PROPRIA, `normalizeCompositionMath` deve preservar `ci.price` como subtotal autoritativo. O preço unitário exibido deve ser derivado de `ci.price / coefficient` apenas para UI, sem substituir o snapshot salvo.

### P0. A composição salva não possui snapshot explícito de preço unitário

O schema atual tem `EngineeringCompositionItem.price` como subtotal salvo, mas não tem `unitPriceSnapshot`.

Campos atuais:

- `EngineeringCompositionItem.coefficient`
- `EngineeringCompositionItem.price`
- `EngineeringCompositionItem.itemId`
- `EngineeringCompositionItem.auxiliaryCompositionId`

Impacto: o sistema precisa reconstruir preço unitário a partir de subtotal dividido por coeficiente ou do JOIN com `EngineeringItem`. As duas opções são frágeis: a primeira perde semântica e arredonda; a segunda reintroduz preço mutável.

Ação estrutural: adicionar `unitPriceSnapshot`, `subtotalSnapshot`, `sourceDatabaseId`, `sourceItemId`, `priceSource` e `isUserOverridden` ou equivalentes. Enquanto isso não existir, o módulo continuará dependendo de inferência.

### P0. Item orçamentário não aponta para uma revisão/snapshot da composição

`EngineeringProposalItem` guarda `code`, `sourceName`, `unitCost` e `priceAudit`, mas não guarda `compositionId`, `compositionRevisionId` ou `compositionTotalPrice`.

Impacto: a ligação entre orçamento e composição é reconstruída por `code + sourceName + proposalId`. Ao trocar versão, mudar sourceName, cachear consulta ou existir uma composição com mesmo código em outra base, a UI pode abrir uma composição diferente daquela que gerou o custo salvo no orçamento.

Ação estrutural: orçamento deve apontar para a composição/revisão que gerou o custo. Código e fonte são metadados, não identidade de snapshot.

## Achados importantes

### P1. Caminho de load pode não entrar no modo PROPRIA

`CompositionEditor.loadComposition` monta a consulta com:

- `databaseId = currentItem.priceAudit.matchedDatabaseId`
- `sourceName = currentItem.sourceName`

Se o item orçamentário ainda estiver com `sourceName` oficial ou `priceAudit.matchedDatabaseId` oficial, o GET pode usar contexto oficial mesmo depois de a composição ter sido salva como própria.

Ação: depois de salvar como PROPRIA, persistir no orçamento `sourceName = PROPRIA`, `compositionId` e `compositionRevisionId`. Na ausência do novo schema, o load deve preferir PROPRIA quando existir composição própria para `proposalId + code`.

### P1. Save sincroniza orçamento antes de recriar linhas da composição

No PUT de composição, o backend atualiza `EngineeringComposition.totalPrice` e sincroniza `EngineeringProposalItem.unitCost` usando `composition.totalPrice` enviado pelo frontend, antes de persistir e validar as linhas.

Impacto: se o frontend enviou `totalPrice` divergente dos itens, ou se o backend alterou coeficiente/preço durante persistência, o item orçamentário pode ficar sincronizado com um total que não corresponde às linhas salvas.

Ação: no save, persistir linhas primeiro, recomputar total no servidor a partir dos snapshots salvos e só então sincronizar o orçamento.

### P1. Correção automática de coeficiente pode alterar dado sem autorização

O PUT tem uma rotina de sanity check que divide coeficientes por 100 ou 1000 quando detecta possível anomalia de escala.

Impacto: uma heurística pode alterar uma composição válida. Esse tipo de correção deve ser diagnóstico, não mutação silenciosa.

Ação: transformar em warning de integridade. Se for necessário corrigir, exigir ação explícita do usuário.

### P1. `CompositionDrawer` duplica a matemática problemática

`CompositionDrawer.tsx` também calcula subtotal a partir de `coefficient * item.price` e sobrescreve `ci.price`. Isso cria uma segunda superfície onde a composição pode parecer diferente do valor salvo.

Ação: extrair uma única função pura de leitura/apresentação de composição, com modo explícito `OFFICIAL` vs `PROPRIA`.

### P1. Cache pode mascarar correções, mas não é a causa principal

`compositionCache` tem TTL de 30 minutos e é invalidado em vários writes. Ele pode esconder correções ou manter respostas divergentes entre variantes de query, mas o problema principal é anterior ao cache: a resposta pode ser recalculada incorretamente antes de entrar no cache.

Ação: incluir hash de integridade e desabilitar cache para PROPRIA durante a fase de estabilização, ou cachear apenas depois de passar por verificação de snapshot.

## Diagnóstico arquitetural

O módulo mistura quatro responsabilidades em pontos demais:

1. Leitura de composição oficial.
2. Edição e persistência de composição própria.
3. Auditoria contra base oficial.
4. Sincronização do orçamento.

Quando essas responsabilidades se misturam, uma ação de leitura vira reprecificação, uma normalização de UI vira mutação financeira e um save de composição vira update parcial do orçamento.

O desenho correto precisa separar claramente:

- composição oficial: preço da base, auditável e re-enriquecível;
- composição própria: snapshot editável e versionado da proposta;
- auditoria: comparação não destrutiva entre snapshot e base oficial;
- orçamento: consumidor de um snapshot de composição, não recomputador livre.

## Plano de melhorias e correções

### Fase 0 — Contenção e prova do bug

Objetivo: parar a perda visível de valores e criar uma reprodução objetiva.

1. Criar teste/reprodução com uma composição real afetada: editar preço, salvar, trocar versão, recarregar, abrir composição.
2. Logar no PUT: `compositionId`, `code`, `proposalId`, `lineId`, `coefficient`, `ci.price`, `item.price`, `database`.
3. Logar no GET: valores antes/depois de qualquer transformação.
4. Desabilitar re-enriquecimento no GET de PROPRIA.
5. Fazer `totalDirect` de PROPRIA ser `sum(ci.price)`.
6. Ajustar `normalizeCompositionMath` para preservar `ci.price` em PROPRIA.
7. Converter sanity check de coeficiente em warning-only.

Critério de aceite: salvar e recarregar a mesma composição não muda nenhum subtotal nem o total, salvo variação máxima de centavo por regra de precisão.

### Fase 1 — Contrato de snapshot de composição

Objetivo: remover inferências perigosas.

Adicionar campos nullable e fazer backfill gradual:

```prisma
model EngineeringCompositionItem {
  unitPriceSnapshot Float?
  subtotalSnapshot  Float?
  sourceDatabaseId  String?
  sourceItemId      String?
  priceSource       String? // OFFICIAL_SNAPSHOT | USER_EDITED | AUX_SNAPSHOT | AI_EXTRACTED
  isUserOverridden  Boolean @default(false)
}

model EngineeringProposalItem {
  compositionId         String?
  compositionRevisionId String?
  compositionTotalPrice Float?
}
```

Regra: `subtotalSnapshot` é a fonte de verdade da linha; `unitPriceSnapshot` é fonte de verdade do preço unitário exibido. `EngineeringItem.price` passa a ser apenas referência de origem.

### Fase 2 — Revisões de composição

Objetivo: tornar versionamento confiável.

Criar `EngineeringCompositionRevision` ou estrutura equivalente:

```text
EngineeringComposition
  id, code, databaseId, currentRevisionId

EngineeringCompositionRevision
  id, compositionId, proposalId, revision, totalPrice, metadata, createdAt

EngineeringCompositionRevisionItem
  revisionId, coefficient, unitPriceSnapshot, subtotalSnapshot, source refs
```

O orçamento deve apontar para uma revisão. Assim, trocar versão da proposta ou atualizar uma base oficial não altera a composição que justificou o preço salvo.

### Fase 3 — Serviços de domínio

Objetivo: tirar regra de negócio do arquivo monolítico e dos componentes.

Criar serviços puros:

- `server/services/engineering/compositionReadService.ts`
- `server/services/engineering/compositionWriteService.ts`
- `server/services/engineering/compositionPricingEngine.ts`
- `server/services/engineering/compositionIntegrityService.ts`

Contratos:

- read PROPRIA: nunca re-enriquece;
- read OFICIAL: pode enriquecer conforme base/regime;
- write PROPRIA: salva snapshots e retorna integridade;
- audit: compara snapshot com base oficial sem alterar snapshot.

### Fase 4 — Frontend controlado por ações

Objetivo: UI não deve mutar dado financeiro durante hidratação.

1. Extrair `compositionMath.ts` com funções testadas.
2. Criar modo explícito:
   - `hydrateOfficialComposition`
   - `hydratePropriaCompositionSnapshot`
   - `calculateEditableCompositionDraft`
3. `CompositionEditor` deve manter estado de draft, mas carregar snapshot sem recalcular.
4. Toda alteração do usuário deve passar por ação explícita: alterar coeficiente, alterar preço unitário, trocar base, inserir insumo, remover linha.
5. `CompositionDrawer` deve usar o mesmo motor de apresentação do editor.

### Fase 5 — Persistência não destrutiva e concorrência

Objetivo: parar perda de identidade.

1. Trocar delete/create de itens por upsert com `clientLineId` ou `lineId` persistente.
2. Adicionar `revision` ou `updatedAt` no payload de save.
3. Rejeitar save se o cliente estiver editando revisão antiga.
4. Marcar linhas removidas explicitamente em vez de apagar tudo sem rastreio.

### Fase 6 — Suite de regressão combinatória

Criar testes obrigatórios para:

- composição própria com insumo oficial sem preço editado;
- composição própria com preço editado;
- composição auxiliar dentro de composição própria;
- mudança de regime onerado/desonerado;
- troca de versão da proposta;
- F5 após salvar;
- divisor de referência;
- coeficiente com expressão;
- MAct/fator multiplicador;
- arredondamento ROUND/TRUNCATE;
- base própria com código igual a base oficial.

Teste de ouro:

```text
abrir composição oficial
editar preço/coefficient
salvar como PROPRIA
confirmar orçamento atualizado
trocar versão da proposta
voltar
recarregar página
abrir composição
comparar linha a linha e total
```

## Primeira entrega recomendada

Implementar uma PR pequena de contenção:

1. Remover re-enriquecimento de PROPRIA no GET.
2. Fazer total de PROPRIA vir de `sum(ci.price)`.
3. Preservar `ci.price` no frontend quando `database.type/name` for PROPRIA.
4. Ajustar `CompositionDrawer` para não recalcular snapshot PROPRIA.
5. Criar testes focados para `normalizeCompositionMath` e para o serializador de GET.

Essa entrega deve ser deployada antes da migração estrutural, porque corrige a superfície que hoje muda valores após reload.

## Riscos residuais depois da primeira entrega

A contenção não resolve sozinha:

- ausência de `unitPriceSnapshot`;
- falta de revisão/snapshot apontado pelo orçamento;
- save destrutivo de linhas;
- concorrência entre abas;
- mistura de regras em `server/routes/engineering.ts`;
- cache sem hash de integridade.

Ela deve reduzir a perda imediata percebida pelo usuário, mas a correção definitiva exige as fases 1 a 5.

## Conclusão

A causa provável do bug persistente é a combinação de leitura destrutiva no backend com normalização destrutiva no frontend. O sistema ainda permite que uma composição própria, que deveria ser snapshot da proposta, seja recalculada como se fosse composição oficial.

O caminho seguro não é reescrever o editor inteiro de uma vez. O caminho é criar um contrato de snapshot, impedir mutação durante leitura, versionar composições próprias e depois extrair os serviços de domínio para fora dos componentes e da rota monolítica.
