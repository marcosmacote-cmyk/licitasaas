---
description: Workflow rigoroso para refinamento visual Ultra-Premium do LicitaSaaS sem alterar regras de negócio ou funcionalidades existentes.
---

# 🎨 Renovação Visual Ultra-Premium

Este workflow é um "modo cirúrgico" dedicado **exclusivamente** à estética e percepção de valor do LicitaSaaS. A regra de ouro absoluta aqui é: **MELHORAR APENAS O VISUAL, PRESERVAR TOTALMENTE A FUNCIONALIDADE**.

Todo o sistema já opera perfeitamente; seu trabalho é repaginar a "casca" para um padrão *Vercel/Linear/Stripe*.

---

## 🚨 REGRA DE OURO INEGOCIÁVEL
- **Não altere estado (useState, useEffect, reducers)** a menos que seja puramente para estado de animação/UI.
- **Não modifique a lógica de consumo de API** ou processamento de IA.
- **Preserve TODOS os IDs, data-attributes e event handlers originais (`onClick`, `onSubmit`).**
- Limite as mudanças a `index.css`, classes utilitárias no `.tsx`, inclusão de containers visuais e bibliotecas de estilo (como Lucide/Framer Motion).

---

## 🛠 ETAPA 1 — Setup de Estilo Seguro

1. Identificar o componente alvo definido pelo usuário.
2. Garantir que as variáveis do design system (no `index.css`) apoiam a mudança. Se faltar um *token* de sombra (Glass) ou gradiente, adicione globalmente no `:root`.
3. Analisar a estrutura DOM do componente:
   - Os handlers funcionais (`onClick={() => salva(dados)}`) não podem ser tocados.
   - Qualquer refatoração estrutural (ex: trocar uma `div` de alerta por um banner de destaque) deve re-repassar todas as variáveis *prop* dinâmicas originais.

---

## 💎 ETAPA 2 — Checklist "Premium" a Aplicar

Para cada fragmento a ser repaginado, você **deve** considerar implementar:

- [ ] **Profundidade (Glassmorphism & Glow):** Substituir bordas sólidas por sombras sutis (ex: `box-shadow`) ou `backdrop-filter: blur(12px)` para modais e headers. Fundos semi-transparentes em elementos sobrepostos.
- [ ] **Cinética (Animações):** Transições rápidas `[transition: all 0.2s cubic-bezier(...)]` ou usar a lib base de animação (Framer-motion ou CSS nativo) para expansões, entradas em tela ou mudanças de cor ao passar o mouse (*hover*).
- [ ] **Tipografia Focada:** Se for um número estatístico, um título `<h1>` ou card de placíar, garantir que esteja usando o peso da fonte correto (*font-extrabold*), *tracking* adequado e cores menos óbvias para subtítulos (textos de apoio na cor certa de `slate` ou `blue-gray`).
- [ ] **Estados Vazios Handcrafted (Empty States):** Se for aplicar numa tabela vazia ou tela zero-dados, adicione uma ilustração SVG abstrata ou um ícone flutuante sutil.

---

## 👁 ETAPA 3 — "Cirurgia de Interface"

1. Fazer o *replace_file_content* do arquivo `.tsx` focado **estritamente em UI/UX**. 
   Exemplo de alteração permitida:
   ```diff
   - <div className="border border-gray-400 P-4" onClick={handleProcess}>
   + <div className="glass-card premium-hover-effect p-6" onClick={handleProcess}>
   ```
2. Ao finalizar a edição num componente, audite imediatamente: "Eu alterei alguma variável de estado? Alguma checagem condicional foi quebrada?" Se a resposta for sim, reverter imediatamente.

---

## 🔎 ETAPA 4 — Fast-Check (Revisão)

Responda silenciosamente antes de confirmar a conclusão da etapa para o usuário:
* A responsividade continua intacta?
* O contraste no Dark Mode foi prejudicado pelo novo efeito de sombra?
* O formulário original continua disparando o submit sem erros?

Se o código visual está limpo e a função intocada, submeta o resultado ao usuário e aguarde validação.
