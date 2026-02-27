# 🚀 Deploy LicitaSaaS — Guia 100% Visual (Sem Terminal)

> Este guia usa APENAS o navegador. Não precisa instalar nada.
> Tempo estimado: ~25 minutos.

---

## PARTE 1: Criar conta no GitHub (se ainda não tem)

1. Abra o navegador e acesse: **https://github.com**
2. Clique em **"Sign up"**
3. Siga os passos: email, senha, nome de usuário
4. Confirme seu email

> Se já tem conta, pule para a Parte 2.

---

## PARTE 2: Subir o código para o GitHub

### Passo 2.1 — Criar repositório vazio

1. Acesse: **https://github.com/new**
2. Preencha:
   - **Repository name**: `licitasaas`
   - **Description**: `Sistema de Gestão de Licitações`
   - Marque: **🔘 Private** (repositório privado)
   - ❌ NÃO marque "Add a README file"
   - ❌ NÃO marque "Add .gitignore"
3. Clique **"Create repository"**
4. Vai aparecer uma página com instruções. **Copie a URL** que aparece, algo como:
   ```
   https://github.com/SEU_USUARIO/licitasaas.git
   ```

### Passo 2.2 — Enviar o código (eu faço por você)

**Me diga a URL do repositório** que apareceu no passo anterior 
e eu executo os comandos para enviar o código.

O que vou executar é basicamente:
```
git remote add origin https://github.com/SEU_USUARIO/licitasaas.git
git push -u origin main
```

> Vai pedir seu **usuário e senha do GitHub** (ou um token).
> Se pedir token, siga o Passo 2.3 abaixo.

### Passo 2.3 — Criar Token de Acesso (se necessário)

Se o Git pedir senha e não aceitar, você precisa de um "token":

1. Acesse: **https://github.com/settings/tokens/new**
2. Preencha:
   - **Note**: `deploy licitasaas`
   - **Expiration**: `90 days`
   - Marque: ☑️ `repo` (acesso total a repos privados)
3. Clique **"Generate token"**
4. **COPIE O TOKEN** (começa com `ghp_...`)
5. Quando o Git pedir senha, cole esse token no lugar da senha

---

## PARTE 3: Criar servidor no Railway

### Passo 3.1 — Criar conta

1. Abra: **https://railway.app**
2. Clique **"Login"** → **"Login with GitHub"**
3. Autorize o acesso

### Passo 3.2 — Criar projeto

1. Clique **"+ New Project"**
2. Escolha **"Deploy from GitHub repo"**
3. Se pedir permissão, clique **"Configure GitHub App"** → autorize todos os repos
4. Selecione **"licitasaas"**
5. Clique **"Deploy Now"**

> ⚠️ Vai falhar na primeira vez. Normal! Falta configurar.

### Passo 3.3 — Adicionar banco de dados

1. No painel, clique **"+ New"** (botão roxo no canto)
2. Clique **"Database"**
3. Clique **"Add PostgreSQL"**
4. Aguarde ~30 segundos

### Passo 3.4 — Copiar URL do banco

1. Clique no card **"Postgres"** que apareceu
2. Vá na aba **"Variables"**  
3. Encontre `DATABASE_URL` e clique para copiar
4. Guarde esse valor!

---

## PARTE 4: Configurar variáveis

### Passo 4.1 — Adicionar variáveis ao app

1. Clique no outro card (o da **aplicação**, não o Postgres)
2. Vá na aba **"Variables"**
3. Adicione cada variável clicando **"+ New Variable"**:

```
DATABASE_URL = (cole a URL do Passo 3.4)
JWT_SECRET = mude-esta-chave-para-algo-secreto-e-longo-2026
GEMINI_API_KEY = AIzaSyD2XWaBY7BOf6qatd8BFkQ_xY3iy29I_nQ
NODE_ENV = production
PORT = 3001
STORAGE_TYPE = LOCAL
```

> 💡 Para o JWT_SECRET, invente uma frase longa qualquer, como:
> `minha-empresa-licitasaas-chave-super-secreta-2026-xyz`

### Passo 4.2 — Gerar URL de acesso

1. No card da aplicação, vá em **"Settings"**
2. Role até **"Networking"**
3. Clique **"Generate Domain"**
4. Anote a URL gerada (ex: `licitasaas-production.up.railway.app`)

### Passo 4.3 — Configurar o Builder

1. Ainda em **"Settings"**
2. Em **"Build"**, certifique-se que **"Dockerfile"** está selecionado
3. O caminho deve ser: `Dockerfile`

### Passo 4.4 — Redesployar

1. Vá na aba **"Deployments"**
2. Clique nos **3 pontinhos (⋯)** do último deploy
3. Clique **"Redeploy"**
4. Aguarde 3-5 minutos até aparecer **"Active"** ✅

---

## PARTE 5: Configurar banco e criar usuário

### Passo 5.1 — Abrir terminal remoto

1. No card da aplicação
2. Aba **"Deployments"** → clique no deploy que está **"Active"**
3. Procure e clique em **"Shell"** ou **"Open Shell"**
4. Um terminal preto vai abrir dentro do Railway

### Passo 5.2 — Preparar o banco

No terminal do Railway, cole:

```bash
cd /app/server && npx prisma db push
```

> ✅ Deve aparecer "Your database is now in sync"

### Passo 5.3 — Criar seu usuário admin

Cole este comando no terminal do Railway (troque email e senha):

```bash
node -e "
const{PrismaClient}=require('@prisma/client');
const bcrypt=require('bcryptjs');
const p=new PrismaClient();
(async()=>{
const t=await p.tenant.create({data:{razaoSocial:'Minha Empresa', rootCnpj: '00000000'}});
await p.user.create({data:{
tenantId:t.id,name:'Admin',role:'Admin',
email:'SEU_EMAIL_AQUI@email.com',
passwordHash:await bcrypt.hash('SUA_SENHA_AQUI',10)
}});
console.log('Pronto! Use: SEU_EMAIL_AQUI@email.com');
await p.$disconnect();
})();
"
```

> ⚠️ **ANTES de colar**: troque `SEU_EMAIL_AQUI@email.com` pelo seu email 
> e `SUA_SENHA_AQUI` por uma senha que você vai lembrar.

---

## PARTE 6: Usar o sistema! 🎉

1. Abra no navegador: **sua URL do Railway** (ex: `https://licitasaas-production.up.railway.app`)
2. Faça login com o email e senha que você criou
3. **Pronto!** Compartilhe essa URL com sua equipe!

---

## 🔄 Como atualizar no futuro

Quando fizermos melhorias, eu executo os comandos de push para você.
O Railway detecta e atualiza automaticamente.

---

## ❓ Se algo der errado

Me diga exatamente o que aparece na tela e eu te ajudo a resolver!
