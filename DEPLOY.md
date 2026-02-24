# 🚀 Guia de Deploy — LicitaSaaS

## Opções de Deploy

### Opção A: Railway (Recomendado — mais rápido)
### Opção B: Render.com (Grátis para começar)
### Opção C: VPS com Docker (Controle total)

---

## Opção A: Railway (Mais fácil)

### Passo 1: Criar conta e projeto
1. Acesse [railway.app](https://railway.app) e faça login com GitHub
2. Clique **"New Project"**

### Passo 2: Subir o código para o GitHub
```bash
# No terminal, na pasta do projeto:
gh repo create licitasaas --private --push --source=.
# OU manualmente:
git remote add origin https://github.com/SEU_USER/licitasaas.git
git push -u origin main
```

### Passo 3: Adicionar PostgreSQL
1. No painel do Railway, clique **"+ New"** → **"Database"** → **"PostgreSQL"**
2. Copie a `DATABASE_URL` gerada

### Passo 4: Deploy do Backend + Frontend
1. Clique **"+ New"** → **"GitHub Repo"** → selecione `licitasaas`
2. Railway detecta automaticamente o `Dockerfile`
3. Configure as variáveis de ambiente:

| Variável | Valor |
|----------|-------|
| `DATABASE_URL` | (copiada do PostgreSQL Railway) |
| `JWT_SECRET` | Gere com: `openssl rand -hex 64` |
| `GEMINI_API_KEY` | Sua chave do [Google AI Studio](https://aistudio.google.com) |
| `NODE_ENV` | `production` |
| `PORT` | `3001` |
| `STORAGE_TYPE` | `LOCAL` |
| `VITE_API_URL` | (deixe vazio) |

4. Clique **"Deploy"**

### Passo 5: Rodar migration do banco
No terminal do Railway (aba **"Deploy" → "Terminal"**):
```bash
cd server && npx prisma db push
```

### Passo 6: Criar primeiro usuário
```bash
cd server && node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const p = new PrismaClient();
(async () => {
  const t = await p.tenant.create({ data: { name: 'Minha Empresa' } });
  await p.user.create({ data: {
    tenantId: t.id, name: 'Admin', role: 'Admin',
    email: 'admin@minhaempresa.com',
    passwordHash: await bcrypt.hash('SuaSenha123', 10)
  }});
  console.log('✅ Pronto! Login: admin@minhaempresa.com / SuaSenha123');
})();
"
```

---

## Opção B: Render.com

### Backend (Web Service)
1. Crie **Web Service** → conecte o repo GitHub
2. **Root Directory**: `server`
3. **Build Command**: `npm install && npx prisma generate && npx tsc`
4. **Start Command**: `node dist/index.js`
5. **Variáveis de ambiente**: mesmas da tabela acima
6. Adicione um **PostgreSQL** gratuito no Render

### Frontend (Static Site)
1. Crie **Static Site** → conecte o mesmo repo
2. **Build Command**: `npm install && npm run build`
3. **Publish Directory**: `dist`
4. **Variável**: `VITE_API_URL` → URL do backend Render (ex: `https://licitasaas.onrender.com`)
5. **Rewrite rules**: `/* → /index.html` (200)

---

## Opção C: VPS com Docker (DigitalOcean, AWS, etc.)

### Passo 1: Instalar Docker na VPS
```bash
curl -fsSL https://get.docker.com | sh
```

### Passo 2: Clonar o projeto
```bash
git clone https://github.com/SEU_USER/licitasaas.git
cd licitasaas
```

### Passo 3: Configurar variáveis
```bash
cp .env.example .env
nano .env  # Edite com suas credenciais
```

### Passo 4: Subir tudo com Docker Compose
```bash
docker compose up -d --build
```

### Passo 5: Executar migration
```bash
docker compose exec app sh -c "cd /app/server && npx prisma db push"
```

### Passo 6: Criar usuário admin
```bash
docker compose exec app node -e "
const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');
const p = new PrismaClient();
(async () => {
  const t = await p.tenant.create({ data: { name: 'Minha Empresa' } });
  await p.user.create({ data: {
    tenantId: t.id, name: 'Admin', role: 'Admin',
    email: 'admin@empresa.com',
    passwordHash: await bcrypt.hash('SuaSenha123', 10)
  }});
  console.log('✅ Pronto!');
})();
"
```

### Passo 7: (Opcional) HTTPS com Nginx + Certbot
```bash
apt install nginx certbot python3-certbot-nginx
```

Crie `/etc/nginx/sites-available/licitasaas`:
```nginx
server {
    server_name seudominio.com.br;
    
    location / {
        proxy_pass http://127.0.0.1:3001;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
        client_max_body_size 50M;
    }
}
```

```bash
ln -s /etc/nginx/sites-available/licitasaas /etc/nginx/sites-enabled/
certbot --nginx -d seudominio.com.br
systemctl restart nginx
```

---

## 🔐 Segurança Importante

| Item | Ação |
|------|------|
| **JWT_SECRET** | Use `openssl rand -hex 64` para gerar. NUNCA use o valor padrão |
| **POSTGRES_PASSWORD** | Senha forte, diferente da development |
| **GEMINI_API_KEY** | Gere uma chave dedicada para produção |
| **HTTPS** | Obrigatório em produção (Railway/Render incluem SSL automático) |
| **Backups** | Configure backups automáticos do PostgreSQL |
| **.env** | NUNCA commite. Está no `.gitignore` |

---

## 📊 Monitoramento

- **Railway**: Dashboard nativo com logs
- **Render**: Logs em tempo real + alertas
- **VPS**: `docker compose logs -f app`

---

## 🔄 Atualizações

```bash
# Faça alterações localmente, depois:
git add -A && git commit -m "descrição da atualização"
git push origin main

# Railway/Render: deploy automático via GitHub
# VPS: repita docker compose up -d --build
```
