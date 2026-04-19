# 🛡️ Workflow de Manutenção do Sistema — LicitaSaaS

> **Slash Command:** `/manutencao`
> **Quando usar:** Sempre que o usuário invocar `/manutencao` ou pedir auditoria geral do sistema.
> **Objetivo:** Ser o agente de manutenção preventiva — alertar, cobrar, antecipar riscos e sugerir melhorias.

---

## 📋 Protocolo de Execução

### PASSO 1: Ler o relatório de saúde

```bash
cat .health-report.json
```

Se o arquivo não existir ou estiver desatualizado (>24h), gerar novo:

```bash
npx tsx scripts/health-check.ts
```

// turbo

### PASSO 2: Rodar a suíte de testes

```bash
npx vitest run
```

// turbo

**Critério:** Se houver falhas, este é o item #1 de prioridade. Nenhum outro passo importa até os testes estarem verdes.

### PASSO 3: Verificar dependências críticas

```bash
npm outdated 2>/dev/null | head -20
```

// turbo

**Avaliar:**
- Atualizações MAJOR → risco de breaking changes, precisa planejamento
- Atualizações de segurança → urgente, deve ser feito imediatamente
- Atualizações minor → baixo risco, pode agendar

### PASSO 4: Auditar qualidade do código

```bash
grep -rn "TODO\|FIXME\|HACK\|XXX" src/ server/ --include="*.ts" --include="*.tsx" | head -20
```

// turbo

**Avaliar:**
- FIXMEs são dívida técnica ativa — priorizar
- TODOs são lembretes — categorizar por urgência
- HACKs são workarounds — planejar solução definitiva

### PASSO 5: Verificar arquivos grandes (candidatos a refatoração)

```bash
find src/ server/ -name "*.ts" -o -name "*.tsx" | xargs wc -l 2>/dev/null | sort -rn | head -15
```

// turbo

**Critério:** Arquivos com >500 linhas são candidatos a refatoração. >800 linhas é urgente.

### PASSO 6: Verificar logs recentes de erro (se Railway estiver acessível)

Consultar o usuário sobre erros recentes em produção:
- Algum módulo está falhando?
- Algum cliente reportou problema?
- Algum comportamento estranho?

### PASSO 7: Gerar Relatório de Manutenção

Criar um artefato com:

1. **Status Geral** — 🟢 Verde / 🟡 Atenção / 🔴 Crítico
2. **Alertas Ativos** — problemas que precisam de ação imediata
3. **Dívida Técnica** — TODOs/FIXMEs categorizados
4. **Recomendações** — melhorias sugeridas com prioridade
5. **Próximos Passos** — ações concretas para a próxima sessão

---

## 🧠 Regras do Agente de Manutenção

### Postura
- Seja **proativo**: não espere o usuário perguntar, antecipe problemas
- Seja **específico**: "O arquivo X tem 850 linhas, sugiro extrair Y" — nunca "considere refatorar"
- Seja **cauteloso**: toda sugestão deve avaliar risco de regressão
- Seja **prático**: priorize ações que podem ser feitas na sessão atual

### Prioridades (ordem fixa)
1. 🔴 **Testes falhando** → corrigir imediatamente
2. 🔴 **Vulnerabilidades de segurança** → atualizar dependência
3. 🟡 **Erros em produção** → diagnosticar e corrigir
4. 🟡 **Dependências MAJOR** → avaliar e planejar migração
5. 🟢 **Dívida técnica** → refatorações incrementais
6. 🟢 **Otimizações** → performance, UX, observabilidade

### Anti-Padrões (PROIBIDO)
- ❌ Refatorações estruturais sem testes cobrindo a área
- ❌ Atualizar dependência MAJOR sem testar localmente
- ❌ Mudar rotas de API sem atualizar mocks de teste
- ❌ Fazer mais de 3 mudanças significativas por sessão

### Memória entre sessões
- O relatório `.health-report.json` persiste entre builds
- Comparar com o relatório anterior para detectar tendências
- Se o bundle cresceu >10%, alertar sobre possível import desnecessário
- Se testes diminuíram, alertar sobre perda de cobertura

---

## 📊 Checklist de Revisão Periódica

### Semanal
- [ ] Testes passando (310+)
- [ ] Sem FIXMEs críticos
- [ ] Bundle size estável
- [ ] Nenhum erro recorrente em produção

### Mensal
- [ ] Dependências atualizadas (minor)
- [ ] Arquivos grandes revisados
- [ ] TODOs limpos ou convertidos em issues
- [ ] Performance do pipeline de IA auditada

### Trimestral
- [ ] Dependências MAJOR avaliadas
- [ ] Arquitetura revisada (novos módulos, deprecated APIs)
- [ ] Benchmark de IA re-executado com Golden Dataset
- [ ] Documentação de workflows atualizada
