# 🚀 Guia de Deploy para Iniciantes — LicitaSaaS

> Este guia é para quem nunca fez deploy antes. Cada passo está explicado com detalhes.
> Tempo estimado: ~30 minutos.

---

## 📋 O que você vai precisar

- [x] Uma conta no **GitHub** (grátis) → [github.com](https://github.com)
- [x] Uma conta no **Railway** (grátis até US$ 5/mês) → [railway.app](https://railway.app)
- [x] Sua **chave da API Gemini** (você já tem, está no projeto)
- [x] O **Terminal** do seu Mac (você já usa)

---

## PARTE 1: Subir o código para o GitHub

### Passo 1.1 — Instalar o GitHub CLI

Abra o **Terminal** e cole este comando:

```bash
brew install gh
```

> ⏳ Aguarde uns 2 minutos até instalar completamente.
> Se aparecer "Already installed", tudo bem, já está instalado.

### Passo 1.2 — Fazer login no GitHub pelo Terminal

```bash
gh auth login
```

Vai aparecer uma série de perguntas. Responda assim:

```
? What account do you want to log into?  →  GitHub.com
? What is your preferred protocol?       →  HTTPS
? Authenticate Git with your GitHub credentials?  →  Yes
? How would you like to authenticate?    →  Login with a web browser
```

Vai aparecer um **código de 8 dígitos**. O navegador vai abrir automaticamente.
Cole o código lá e clique **"Authorize"**.

### Passo 1.3 — Criar o repositório e enviar o código

Cole este comando no Terminal (tudo junto, uma linha de cada vez):

```bash
cd /Users/marcosgomes/.gemini/antigravity/playground/magnetic-cluster
```

Depois:

```bash
gh repo create licitasaas --private --push --source=.
```

> ✅ Se aparecer algo como "Created repository marcosgomes/licitasaas on GitHub"
> e "Pushed commits to...", **funcionou!**

---

## PARTE 2: Criar o servidor no Railway

### Passo 2.1 — Criar conta no Railway

1. Abra no navegador: **[railway.app](https://railway.app)**
2. Clique em **"Login"** (canto superior direito)
3. Escolha **"Login with GitHub"**
4. Autorize o acesso

### Passo 2.2 — Criar um novo projeto

1. No painel do Railway, clique no botão **"+ New Project"**
2. Escolha **"Deploy from GitHub repo"**
3. Se pedir permissão para acessar seus repositórios, clique **"Configure GitHub App"** e autorize
4. Selecione **"licitasaas"** na lista
5. Clique **"Deploy Now"**

> ⚠️ O deploy vai **falhar** na primeira vez. Isso é normal!
> Precisamos configurar o banco de dados e as variáveis primeiro.

### Passo 2.3 — Adicionar o Banco de Dados (PostgreSQL)

1. No painel do seu projeto Railway, clique no botão **"+ New"** (canto superior direito)
2. Selecione **"Database"**
3. Selecione **"Add PostgreSQL"**
4. O banco será criado automaticamente em ~30 segundos

### Passo 2.4 — Copiar a URL do banco

1. Clique no serviço **"Postgres"** que acabou de aparecer
2. Vá na aba **"Variables"**
3. Procure a variável **`DATABASE_URL`**
4. Clique nela para copiar o valor (algo como `postgresql://postgres:abc123@...`)

> 📋 Deixe esse valor copiado, vamos usar no próximo passo.

---

## PARTE 3: Configurar as Variáveis de Ambiente

### Passo 3.1 — Gerar uma chave de segurança

No seu Terminal (no Mac), cole este comando:

```bash
openssl rand -hex 32
```

> 📋 Vai aparecer uma sequência aleatória tipo `a1b2c3d4e5f6...`. Copie e guarde essa sequência.
> Essa é sua **JWT_SECRET** — a chave que protege o login dos usuários.

### Passo 3.2 — Adicionar as variáveis no Railway

1. No Railway, clique no serviço da sua **aplicação** (não no Postgres)
   - É o serviço que mostra o nome "licitasaas" ou similar
2. Vá na aba **"Variables"**
3. Clique em **"+ New Variable"** e adicione cada uma:

| Nome da Variável | Valor | Explicação |
|:---|:---|:---|
| `DATABASE_URL` | *(cole a URL do Passo 2.4)* | Conexão com o banco de dados |
| `JWT_SECRET` | *(cole a chave do Passo 3.1)* | Protege o login |
| `GEMINI_API_KEY` | `AIzaSyD2XWaBY7BOf6qatd8BFkQ_xY3iy29I_nQ` | API da inteligência artificial |
| `NODE_ENV` | `production` | Diz ao sistema que é produção |
| `PORT` | `3001` | Porta do servidor |
| `STORAGE_TYPE` | `LOCAL` | Onde salvar os PDFs |

> 💡 **Dica**: Para cada variável, clique "New Variable", digite o nome à esquerda
> e o valor à direita. Depois clique qualquer lugar fora para salvar.

### Passo 3.3 — Configurar a porta de acesso

1. Ainda no serviço da aplicação, vá na aba **"Settings"**
2. Role até **"Networking"**
3. Clique em **"Generate Domain"**
4. O Railway vai gerar uma URL tipo `licitasaas-production.up.railway.app`

> ✅ **Anote essa URL!** É o endereço que você e sua equipe vão usar para acessar o sistema.

---

## PARTE 4: Fazer o Deploy funcionar

### Passo 4.1 — Configurar o build

1. Na aba **"Settings"** do serviço da aplicação
2. Em **"Build"**, verifique se **"Dockerfile"** está selecionado como builder
   - Se não estiver, mude para **"Dockerfile"**
3. O caminho do Dockerfile deve ser: `Dockerfile`

### Passo 4.2 — Redesployar

1. Vá na aba **"Deployments"**
2. Clique nos **três pontinhos (⋯)** do último deploy
3. Clique **"Redeploy"**

> ⏳ Aguarde uns 3-5 minutos. Você verá o progresso na tela.
> Quando aparecer **"Active"** em verde, o sistema está no ar! 🎉

---

## PARTE 5: Configurar o Banco e Criar seu Usuário

### Passo 5.1 — Rodar a migração do banco

1. No serviço da aplicação, vá na aba **"Settings"**
2. Clique em **"Open Shell"** (ou vá na aba Deployments → clique no deploy ativo → clique "Shell")
3. No terminal que abrir, digite:

```bash
cd /app/server && npx prisma db push
```

> ✅ Deve aparecer "Your database is now in sync" — o banco está pronto!

### Passo 5.2 — Criar o primeiro usuário (Admin)

Ainda no mesmo terminal do Railway, cole este comando **inteiro** (copie tudo de uma vez):

```bash
node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const p = new PrismaClient();
(async () => {
  const t = await p.tenant.create({ data: { name: 'Minha Empresa' } });
  await p.user.create({ data: {
    tenantId: t.id,
    name: 'Marcos Gomes',
    role: 'Admin',
    email: 'marcos@minhaempresa.com',
    passwordHash: await bcrypt.hash('MinhaSenh@123', 10)
  }});
  console.log('Usuario criado com sucesso!');
  console.log('Email: marcos@minhaempresa.com');
  console.log('Senha: MinhaSenh@123');
  await p.\$disconnect();
})();
"
```

> ⚠️ **IMPORTANTE**: Troque `marcos@minhaempresa.com` pelo seu email real
> e `MinhaSenh@123` por uma senha forte que você vai lembrar.

---

## PARTE 6: Acessar o Sistema! 🎉

1. Abra a URL que o Railway gerou (Passo 3.3) no navegador:
   - Exemplo: `https://licitasaas-production.up.railway.app`
2. Faça login com o email e senha que você criou no Passo 5.2
3. **Pronto! Você está usando o sistema em produção!**

### Compartilhar com a equipe:
Basta enviar a URL para seus colegas. Para criar mais usuários, eles podem se registrar 
ou você pode repetir o Passo 5.2 com os dados deles.

---

## 🔧 Manutenção Futura

### Como atualizar o sistema
Quando fizermos melhorias no código, basta rodar no Terminal do Mac:

```bash
cd /Users/marcosgomes/.gemini/antigravity/playground/magnetic-cluster
git add -A
git commit -m "descrição da atualização"
git push
```

> O Railway detecta o push e faz o deploy automaticamente! 🚀

### Ver logs (se algo der errado)
1. Vá no Railway → seu projeto → serviço da aplicação
2. Aba **"Deployments"** → clique no deploy ativo
3. Aba **"Logs"** — mostra tudo que o servidor está fazendo

### Custo
- **Railway**: Grátis para os primeiros US$ 5 de uso (~500 horas/mês)
  - Depois: ~US$ 5-10/mês para uso contínuo
- **Gemini API**: Grátis até 15 requisições/minuto (mais que suficiente)

---

## ❓ Problemas Comuns

### "Build failed" (Erro no build)
→ Verifique se todas as variáveis de ambiente foram adicionadas (Passo 3.2)

### "Cannot connect to database"
→ Verifique se a `DATABASE_URL` está correta e o serviço PostgreSQL está rodando

### "Login não funciona"
→ Verifique se executou o Passo 5.1 (migração) e Passo 5.2 (criar usuário)

### "Página em branco"
→ Verifique se `NODE_ENV` está como `production` e redesplye (Passo 4.2)

---

> 💡 **Dica final**: Salve este arquivo! Sempre que precisar, consulte-o.
> Se tiver dúvidas em qualquer passo, me pergunte!
