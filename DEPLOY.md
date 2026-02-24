# Guia de Implantação (Deployment Guide)

Este documento descreve os passos necessários para colocar o sistema em produção em um ambiente SaaS.

## 1. Infraestrutura Recomendada

- **Frontend & Backend**: [Render.com](https://render.com) ou Railway.
- **Banco de Dados**: [Supabase](https://supabase.com) ou [Neon.tech](https://neon.tech) (PostgreSQL).
- **Storage**: [AWS S3](https://aws.amazon.com/s3) ou Google Cloud Storage (para persistência de PDFs).
- **IA**: [Google AI Studio](https://aistudio.google.com) (API Key do Gemini).

## 2. Variáveis de Ambiente (Environment Variables)

Configure as seguintes variáveis no seu provedor de hospedagem:

| Variável | Descrição | Exemplo |
| :--- | :--- | :--- |
| `DATABASE_URL` | URL de conexão com o Postgres | `postgres://user:pass@host:5432/db` |
| `JWT_SECRET` | Chave secreta para tokens JWT | `uma-string-muito-longa-e-aleatoria` |
| `GEMINI_API_KEY` | Chave da API do Google Gemini | `AIzaSy...` |
| `STORAGE_TYPE` | Tipo de armazenamento (`LOCAL` ou `S3`) | `S3` |
| `NODE_ENV` | Ambiente de execução | `production` |

### Se usar `STORAGE_TYPE=S3`:
| Variável | Descrição |
| :--- | :--- |
| `AWS_ACCESS_KEY_ID` | ID da chave AWS |
| `AWS_SECRET_ACCESS_KEY` | Chave secreta AWS |
| `AWS_REGION` | Região do Bucket (ex: `us-east-1`) |
| `AWS_S3_BUCKET` | Nome do bucket S3 |

## 3. Passos para Deploy no Render.com

### Backend
1. Crie um novo **Web Service**.
2. Conecte seu repositório GitHub.
3. Build Command: `cd server && npm install && npx prisma generate`
4. Start Command: `cd server && npm start`
5. Adicione as variáveis de ambiente citadas acima.

### Frontend
1. Crie um novo **Static Site**.
2. Conecte seu repositório GitHub.
3. Build Command: `npm install && npm run build`
4. Publish Directory: `dist`
5. Adicione a variável `VITE_API_BASE_URL` apontando para a URL do seu backend no Render.

## 4. Banco de Dados
Antes do primeiro deploy, execute as migrações:
```bash
cd server
npx prisma migrate deploy
```

## 5. CI/CD
O sistema já conta com um workflow do GitHub Actions em `.github/workflows/ci.yml` que valida o build a cada Push ou Pull Request.
