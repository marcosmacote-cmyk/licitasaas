# Auditoria severa do modulo Proposta de Engenharia

Data: 2026-05-28
Escopo: wizard de 5 passos, editor orcamentario, calculos, bases oficiais/proprias, persistencia, cronograma, carta e exportacao.

## Resumo executivo

O modulo tem problemas estruturais graves. O principal defeito arquitetural e a convivencia de dois centros de comando: `EngineeringProposalWizard` e `EngineeringProposalEditor`. O wizard tenta ser o orquestrador dos 5 passos, mas o Step 2 embute o editor legado, que tambem possui estado, calculo, salvamento, cronograma, caderno, encargos e auditoria. Isso gera regras duplicadas e divergentes para BDI, descontos, arredondamento, sincronizacao de bases, salvamento e indicadores de alteracao.

As falhas relatadas pelo usuario sao coerentes com o codigo encontrado:

- mudanca de regime no Passo 1 nao reprecifica automaticamente contra a base correta;
- arredondamento e desconto sao aplicados por motores diferentes dependendo de quem salva;
- MAct/fator multiplicador altera quantidades filhas de forma destrutiva;
- base propria compete com bases oficiais dentro do mesmo motor de enriquecimento;
- autosave e salvamento manual podem gravar snapshots antigos;
- persistencia apaga e recria todos os itens, perdendo IDs estaveis;
- cronograma e caderno podem ficar com dados obsoletos;
- Step 5 alerta problemas, mas nao bloqueia exportacao ruim.

Conclusao: antes de fazer correcoes pontuais, o modulo precisa de uma refatoracao de dominio: um unico motor de calculo, uma unica fonte de verdade de estado e uma camada de persistencia incremental/versionada.

## Falhas transversais de arquitetura

### P0 - Duas fontes de verdade para itens, BDI e configuracao

Evidencia:

- `EngineeringProposalWizard` recalcula itens em `recalcAll` nas linhas 94-104.
- `EngineeringProposalEditor` tem outro `recalcAll` nas linhas 549-569.
- O Step 2 passa `onItemsChange={setItems}` direto para o wizard nas linhas 571-577 do wizard, enquanto o editor tambem mantem `hasUnsavedChanges` proprio.

Impacto:

O mesmo item pode ser calculado por regras diferentes. O editor aplica desconto individual; o wizard nao aplica. Ao voltar de Step 2 para Step 1, ou salvar pelo botao do wizard, descontos podem ser ignorados e totais podem mudar sem intencao do usuario.

Recomendacao:

Extrair um unico `engineeringCalculationEngine` compartilhado e remover calculos duplicados dos componentes. O UI deve chamar funcoes puras; nenhum componente deve possuir formula propria de preco.

### P0 - Autosave pode salvar dados antigos e sobrescrever edicoes recentes

Evidencia:

- O autosave do wizard agenda um timer nas linhas 174-209 de `EngineeringProposalWizard.tsx`.
- A lista de dependencias ignora `items`, `bdiConfig`, `effectiveBdi`, `engineeringConfig` e `cronogramaData`; usa basicamente `hasUnsavedChanges`, `isSaving`, `isAnyAIRunning` e `items.length`.

Impacto:

Se o usuario faz varias edicoes em Step 2 sem alterar a quantidade de linhas, o timer pode gravar o primeiro snapshot capturado, nao o estado mais recente. Isso explica inconsistencias de salvamento e valores que "voltam" depois de alguns segundos.

Recomendacao:

Substituir por autosave baseado em estado serializado/versionado, com debounce reiniciado a cada alteracao real, `AbortController`, timestamp/version no payload e rejeicao de snapshot obsoleto.

### P0 - Salvamento destrutivo apaga e recria todos os itens

Evidencia:

- `server/routes/engineering.ts` apaga todos os `EngineeringProposalItem` com `deleteMany` nas linhas 1298-1302.
- Depois recria tudo com `createMany` nas linhas 1305-1329.
- O modelo possui `id` proprio por item, `notes`, `discount`, `multiplicationFactor` e `priceAudit` nas linhas 693-724 do schema.

Impacto:

Cada salvamento troca todos os IDs no banco. Qualquer referencia futura por item fica instavel. Tambem aumenta risco de perda parcial quando duas abas/ambientes salvam em paralelo. O modelo atual nao tem optimistic locking nem merge incremental.

Recomendacao:

Trocar para persistencia incremental por `id`/`clientId`: upsert, update, delete explicito, versionamento da proposta e controle de concorrencia.

### P1 - Sem contrato unico para `EngineeringConfig`

Evidencia:

- `EngineeringConfig` aceita campos livres no backend (`[key: string]: any`) em `priceEnricher.ts`, linhas 47-53.
- O frontend guarda snapshots internos `_aiExtractedRef`, `_aiExtractedBdi`, `_aiExtractedEncargos` dentro do mesmo objeto persistido.

Impacto:

O objeto de configuracao mistura dado de dominio, cache de IA, estado visual e diagnostico. Isso dificulta salvar, comparar, versionar e migrar.

Recomendacao:

Separar `budgetConfig`, `aiExtractionEvidence`, `uiState` e `reportConfig`. Persistir apenas dominio e evidencias auditaveis, nao estado temporario de UI.

## Passo 1 - Configuracao, regime, BDI, encargos e bases

### P0 - Alterar regime nao reprecifica contra base correta

Evidencia:

- O select de regime apenas chama `onConfigChange({ ...engineeringConfig, regimeOneracao: ... })` nas linhas 463-464 de `Step1ConfigPanel.tsx`.
- O wizard responde a mudanca recalculando BDI sobre o mesmo `unitCost` nas linhas 94-104 de `EngineeringProposalWizard.tsx`.
- A busca real contra bases oficiais so ocorre quando o usuario aciona `price-audit`/sync manual.

Impacto:

Ao mudar de onerado para desonerado, o sistema recalcula preco final usando o custo antigo. O custo unitario da base correta nao e atualizado automaticamente. Isso bate diretamente com o bug relatado pelo usuario.

Recomendacao:

Regime, UF, base e data-base devem invalidar auditorias e precos de base. Exigir uma etapa atomica: mudar config -> reauditar -> propor diff -> usuario aplica.

### P0 - `priceEnricher` usa data-base global para todos os itens

Evidencia:

- O enriquecedor calcula `targetDate = parseDataBaseMonth(engineeringConfig?.dataBase)` na linha 481.
- Existe suporte parcial a `dataBases` em `getTargetDateForSource`, linhas 102-108, mas a escolha depende do nome do banco candidato, nao do banco originalmente escolhido pelo item.

Impacto:

Quando a proposta usa SINAPI com data mensal e SEINFRA/SICRO por versao, ou varias fontes com datas diferentes, o match pode escolher candidato errado ou gerar aviso falso de data-base.

Recomendacao:

Resolver data-base por fonte antes da busca, filtrar candidatos por fonte/data/regime no banco e retornar erro explicito quando a base configurada nao existir.

### P1 - Base propria entra no enriquecimento como concorrente da base oficial

Evidencia:

- `buildDatabaseWhere` inclui `OR: [{ type: 'OFICIAL' }, { tenantId }]` nas linhas 291-296 de `priceEnricher.ts`.
- `PROPRIA` e criada por tenant em `server/routes/engineering.ts`, linhas 635-642.

Impacto:

Itens proprios podem aparecer na mesma piscina de match de bases oficiais. Isso cria confusao entre "preco oficial", "preco proprio" e "preco manual", principalmente em auditoria e sincronizacao.

Recomendacao:

Separar modos: `auditar contra oficial`, `buscar no banco proprio`, `aplicar banco proprio`. Banco proprio nunca deve satisfazer auditoria oficial sem rótulo e consentimento explicito.

### P1 - Encargos sociais existem em dois formatos concorrentes

Evidencia:

- Step 1 usa uma tabela SINAPI detalhada com campos `a1_h`, `b1_m`, grupos A-D etc.
- O editor legado ainda possui aba `encargos_sociais` com chaves diferentes como `sesi_sesc`, `ferias_abono`, `multa_fgts` nas linhas 1903-1969 de `EngineeringProposalEditor.tsx`.

Impacto:

O usuario pode preencher encargos em uma tela e outra tela ler/mostrar outra estrutura. Isso e fonte forte de inconsistencias de M.O., composicoes e relatorios.

Recomendacao:

Remover ou migrar a aba legada. Manter um schema unico de encargos sociais, com migrador para dados antigos.

## Passo 2 - Planilha orcamentaria, MAct, banco proprio e operacoes matematicas

### P0 - Editor usa BDI efetivo de forma fragil

Evidencia:

- O editor define `effectiveBdi = bdiConfig.bdiGlobal` na linha 535 de `EngineeringProposalEditor.tsx`.
- O wizard usa `resolveEffectiveBdi(bdiConfig, precision)` na linha 78.

Impacto:

Se `bdiConfig.mode === 'TCU'` mas `bdiGlobal` estiver desatualizado, o Step 2 pode calcular com um BDI diferente do mostrado no Step 1. Essa divergencia aparece em preco unitario, total e exportacao.

Recomendacao:

Eliminar leitura direta de `bdiGlobal` como fonte primaria. Sempre resolver BDI por uma funcao unica a partir do modo atual e da precisao.

### P0 - Desconto individual e perdido quando o wizard recalcula/salva

Evidencia:

- O editor aplica desconto em `recalcAll` nas linhas 560-563.
- O wizard recalcula sem considerar `discount` nas linhas 94-101.

Impacto:

Itens com desconto podem voltar ao preco cheio quando o usuario muda configuracao, avanca passos, salva pelo topo ou autosave roda pelo wizard.

Recomendacao:

Mover desconto para o motor unico de calculo e testar regressao: item com desconto + alteracao de BDI + save + reload.

### P0 - MAct/fator multiplicador altera quantidade dos filhos de forma destrutiva

Evidencia:

- Ao alterar `multiplicationFactor`, o editor divide a quantidade atual pelo fator anterior e multiplica pelo novo nas linhas 2899-2924.

Impacto:

Arredondamentos sucessivos acumulam erro. Se o usuario altera fator varias vezes, a quantidade original se perde. Esse e o tipo de bug matematico que causa diferenca pequena, dificil de rastrear, e depois vira divergencia grande no total.

Recomendacao:

Persistir `baseQuantity` separada de `effectiveQuantity`. O fator deve ser uma transformacao derivada, nao uma mutacao destrutiva da quantidade.

### P1 - Deduplicacao pode remover item valido

Evidencia:

- A deduplicacao de `syncBases` usa chave `itemNumber::codigo` nas linhas 1198-1220.
- A decisao de manter um item usa "maior unitCost" como criterio nas linhas 1206-1215.

Impacto:

Em orcamentos reais, dois itens podem compartilhar codigo com descricoes, locais, fatores ou quantidades diferentes. Manter o maior custo nao e regra confiavel.

Recomendacao:

Deduplicar apenas por identidade persistida ou hash forte com descricao, unidade, hierarquia e origem. Nunca por maior preco.

### P1 - Banco proprio cria itens sem normalizacao consistente

Evidencia:

- Criacao propria usa `code` bruto para detectar duplicidade nas linhas 651-653 e 671-673.
- Nao ha normalizacao robusta de codigo/unidade/descricao antes de persistir.

Impacto:

Pode haver duplicatas por caixa, espaco, zero a esquerda, acento ou formato de codigo. Depois o motor de busca/auditoria tenta normalizar, mas a base ja ficou suja.

Recomendacao:

Criar normalizador canonico para codigo, unidade e descricao antes de salvar em `PROPRIA`.

## Passo 3 - Cronograma

### P1 - Cronograma marca alteracao ao montar

Evidencia:

- `CronogramaPanel` chama `onDataChange` em todo mount/mudanca de `meses` ou `etapas`, linhas 39-42.
- No wizard, `onDataChange` seta `hasUnsavedChanges(true)`.

Impacto:

Entrar no Step 3 pode marcar a proposta como alterada mesmo sem acao do usuario. Isso ativa salvamentos e avisos falsos.

Recomendacao:

Separar inicializacao de edicao real. Usar `isHydratedRef` ou comparar com snapshot original antes de marcar dirty.

### P1 - Auto-sync do cronograma nao detecta mudanca nos filhos

Evidencia:

- O fingerprint usa apenas `ETAPA.itemNumber` e `ETAPA.totalPrice`, linhas 53-58.
- Agrupadores normalmente ficam com `totalPrice` zerado; os valores reais estao nos filhos.

Impacto:

Alterar preco/quantidade de itens filhos pode nao atualizar o cronograma. O caderno pode exportar um cronograma antigo.

Recomendacao:

Fingerprint deve considerar soma dos filhos por etapa, ou receber do motor de calculo um `etapaTotal` derivado.

### P2 - Subetapa pode sobrescrever nome da etapa

Evidencia:

- `gerarEtapasPadrao` usa `type === 'ETAPA' || type === 'SUBETAPA'` e `depth <= 1` para nomear etapa nas linhas 69-75 de `cronogramaEngine.ts`.

Impacto:

Uma subetapa `1.1` pode virar nome da etapa `1`, trocando o capitulo principal por um subcapitulo.

Recomendacao:

Somente `ETAPA` deve nomear etapa padrao. `SUBETAPA` deve compor subtotal, nao substituir titulo principal.

### P2 - Arredondamento do cronograma pode nao fechar no total

Evidencia:

- Cada celula mensal e arredondada isoladamente na linha 36 de `cronogramaEngine.ts`.
- O acumulado soma celulas arredondadas nas linhas 46-50.

Impacto:

Mesmo com percentuais somando 100%, o acumulado financeiro pode ficar alguns centavos diferente do total global.

Recomendacao:

Aplicar estrategia de ajuste no ultimo mes/maior parcela para garantir fechamento financeiro.

## Passo 4 - Carta proposta

### P1 - Carta pode ser marcada como salva mesmo com erro HTTP

Evidencia:

- `handleSaveLetter` faz `fetch` nas linhas 191-197, mas nao verifica `res.ok`.
- `onLetterSaved?.()` roda logo depois na linha 200.
- O `catch` e silencioso nas linhas 201-202.

Impacto:

O Step 4 pode aparecer concluido mesmo que a carta nao tenha sido persistida. O Step 5 depois falha ou exporta carta antiga.

Recomendacao:

Checar `res.ok`, validar payload retornado, mostrar erro persistente e chamar `onLetterSaved` apenas apos confirmacao do backend.

### P2 - Adaptacao para carta descarta metadados de engenharia

Evidencia:

- `adaptItems` converte `EngItem` para `ProposalItem` nas linhas 32-47.
- Campos como `sourceName`, `bdiCategoria`, `discount`, `notes`, `priceOrigin`, auditoria e composicoes nao sao levados.

Impacto:

A carta pode usar valores finais, mas perde contexto importante de engenharia. Em disputa ou revisao, faltam origem do preco, BDI diferenciado e observacoes.

Recomendacao:

Criar um tipo especifico `EngineeringLetterItem` ou enriquecer o builder de carta para engenharia.

## Passo 5 - Exportacao e caderno

### P1 - Checklist nao bloqueia exportacao inconsistente

Evidencia:

- O Step 5 calcula `hasBlocker` nas linhas 636-640 do wizard, mas usa isso apenas para mensagem visual.
- `BudgetDocsPanel` continua renderizado e exportavel nas linhas 666-678.

Impacto:

Usuario consegue exportar caderno sem itens, sem BDI, sem encargos, sem cronograma ou sem carta, dependendo do caso.

Recomendacao:

Transformar checklist em gate real para exportacao, com override manual registrado e destacado.

### P1 - Insumos consolidados podem ficar obsoletos

Evidencia:

- Wizard carrega insumos uma vez com `insumosLoadedRef`, linhas 220-244.
- Editor tem mecanismo semelhante nas linhas 505-533.
- `BudgetDocsPanel` tambem possui fallback de uma vez, linhas 107-134.

Impacto:

Se o usuario altera itens, troca base, aplica banco proprio ou reextrai composicoes, ABC de insumos e CPU podem sair com dados antigos.

Recomendacao:

Invalidar insumos por hash dos itens relevantes (`code`, `sourceName`, `quantity`, `unitCost`, `insumos`) e recarregar quando o hash mudar.

### P2 - Exportacao de carta no caderno pode sair sem itens

Evidencia:

- `BudgetDocsPanel` normaliza carta com `items: []` nas linhas 190-196 e exporta tambem com `items: []` na linha 213.

Impacto:

Dependendo do template, a carta exportada pelo caderno pode nao conter a tabela/itens ou pode depender apenas de texto salvo anteriormente.

Recomendacao:

Passar os itens adaptados reais para o normalizer/exporter, ou declarar que a carta do caderno e apenas o envelope textual salvo.

## Backend, banco e concorrencia

### P0 - Nao ha controle de concorrencia entre Codex/Antigravity/abas/usuarios

Evidencia:

- `PriceProposal` tem `updatedAt`, mas o POST de itens nao recebe nem valida versao.
- Salvamento destrutivo substitui o conjunto completo de itens.

Impacto:

Duas abas abertas, ou trabalho alternado entre ambientes, podem sobrescrever silenciosamente. Isso e especialmente perigoso no fluxo Codex + Antigravity e em propostas longas.

Recomendacao:

Adicionar `revision`/`updatedAt` obrigatorio no payload. Backend deve rejeitar save se a revisao do cliente estiver velha, retornando diff/conflito.

### P1 - Auditoria de preco mistura "comparar" com "aplicar"

Evidencia:

- `refreshAllAudits` apenas audita e preserva custo.
- `syncBases` audita e aplica automaticamente `matchedUnitCost`, linhas 1184-1190.

Impacto:

O usuario pode acreditar que esta "auditando" e acabar alterando preco. Em engenharia, isso precisa ser deliberado e rastreavel.

Recomendacao:

Separar comandos e UI: "Auditar", "Aplicar selecionados", "Aplicar todos com alta confianca". Registrar origem e diff.

## Validacao executada

Tentativas:

- `npx tsc --noEmit --pretty false`: falhou porque o clone nao tem dependencias locais instaladas; `npx` tentou instalar o pacote errado `tsc@2.0.4`.
- `npx vitest run server/services/engineering src/components/hooks/__tests__/proposalEngine.test.ts`: falhou porque `vite` e `@vitejs/plugin-react` nao estao instalados em `node_modules`.

Conclusao de validacao:

A auditoria acima e estatica, baseada em leitura de codigo. Para transformar em plano de correcao com seguranca, instalar dependencias locais (`npm install`) e rodar:

- `npm run build`
- `npx vitest run server/services/engineering`
- `npx vitest run src/components/hooks/__tests__/proposalEngine.test.ts`
- testes novos para regime, BDI, arredondamento, desconto, MAct, banco proprio e save/reload.

## Plano recomendado de correcao

1. Congelar mudancas grandes no modulo ate criar testes de caracterizacao.
2. Criar motor unico de calculo com funcoes puras:
   - resolver BDI;
   - aplicar precisao;
   - calcular item;
   - calcular descontos;
   - aplicar fator MAct sem destruir quantidade base;
   - calcular totais por etapa.
3. Trocar persistencia destrutiva por upsert/versionamento.
4. Separar banco proprio de auditoria oficial.
5. Tornar mudanca de regime/data/UF/base um evento que invalida precos e exige reauditoria.
6. Unificar encargos sociais em um unico schema.
7. Remover o editor legado de dentro do wizard ou torná-lo controlado de verdade pelo wizard.
8. Transformar checklist de Step 5 em gate real.
9. Criar suite de regressao com cenarios combinatorios:
   - ONERADO -> DESONERADO;
   - ROUND -> TRUNCATE;
   - BDI TCU -> simplificado;
   - banco oficial -> banco proprio;
   - desconto individual;
   - MAct aplicado/desfeito;
   - save/reload;
   - exportacao do caderno.

## Veredito

O modulo nao esta apenas com bugs isolados; ele esta com divida arquitetural no nucleo. Corrigir sintomas sem reduzir duplicidade de estado e calculo tende a criar novas regressões. A prioridade deve ser estabilizar o dominio e a persistencia antes de expandir funcionalidades.
