---
description: Protocolo obrigatório de aprovação visual e de interface para toda entrega do LicitaSaaS
---

# Protocolo de Aprovação Visual — LicitaSaaS

## Regras permanentes

Toda nova tela, componente, modal, fluxo ou feature do LicitaSaaS **deve passar obrigatoriamente** por este protocolo antes de ser considerada pronta.

### Identidade Visual Obrigatória

1. O LicitaSaaS deve parecer uma **plataforma séria, institucional, técnica, corporativa e premium** para gestão de licitações públicas
2. Nenhuma tela nova pode parecer app casual, dashboard genérico, ferramenta estilo Notion, workspace criativo ou sistema no-code improvisado
3. Usar **apenas o design system já consolidado** do produto
4. Usar **apenas a iconografia oficial** do sistema (Lucide React, stroke consistente, escala padronizada)
5. **Proibido**: emojis, ícones emoji-like, pictogramas lúdicos ou "fofos"
6. Manter **semântica de cores oficial** do produto:
   - `--color-primary` (azul): ações principais, navegação
   - `--color-success` (verde): confirmação, ganhos, válido
   - `--color-warning` (amber): alertas, atenção, pendências
   - `--color-danger` (vermelho): erros, vencido, bloqueios
   - `--color-ai` (roxo): IA, geração, inteligência
7. Toda tela deve ter **hierarquia visual clara**, com ação principal evidente
8. Tabelas, formulários e modais devem seguir os **padrões visuais já aprovados**
9. Toda feature nova deve parecer **parte do mesmo ecossistema** do LicitaSaaS
10. Se houver desalinhamento visual, ruído institucional ou perda de consistência, a entrega deve ser **revisada antes de ser aprovada**

### Padrões de Componentes Aprovados

- **Headers de módulo**: ícone em box (30-44px) com borda + gradient sutil, título fontWeight 800, subtítulo contextual dinâmico
- **Labels de campo**: uppercase tiny (0.65-0.68rem), letterSpacing 0.07-0.08em, com ícone contextual quando aplicável
- **KPI Cards**: label uppercase, número grande (1.75-2.8rem fontWeight 800), barra de progresso quando aplicável, borda colorida semântica
- **Botões CTA**: gradient + boxShadow luminoso, borderRadius xl, height mínimo 46px
- **Empty states**: layout editorial com ghost preview ou ícone em box + título bold + descrição + features list
- **Painéis de gráfico**: header separado por borderBottom, gradient sutil, ícone com borda
- **Tabelas**: thead uppercase tiny com gradient, zebra striping, badges semânticos por status

## Checklist de Aprovação

Antes de considerar qualquer entrega finalizada, verificar **todos** os itens:

- [ ] Parece parte do LicitaSaaS?
- [ ] Está institucional e séria?
- [ ] Tem hierarquia visual clara?
- [ ] Usa ícones corretos (Lucide, sem emoji)?
- [ ] Usa botões no padrão correto?
- [ ] Respeita semântica de cor?
- [ ] Não parece casual ou genérica?
- [ ] Está no mesmo nível visual das telas centrais do sistema?
- [ ] Labels e tipografia seguem o design system?
- [ ] Empty states são nobres e intencionais?

## Processo

1. Implementar a feature/tela/componente
2. Build sem erros (tsc --noEmit)
3. **Executar checklist acima mentalmente antes do commit**
4. Se qualquer item falhar → revisar antes de committar
5. Documentar no commit o que foi validado
