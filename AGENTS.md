# LicitaSaaS Codex Notes

## Projeto

Este repositorio e o projeto de producao do LicitaSaaS:

`/Users/marcosgomes/.gemini/antigravity/playground/ancient-copernicus/ai_service/licitasaas-prod`

## Deploy Seguro

Quando o usuario pedir deploy, deploy seguro, `deploy_seguro`, `/deploy-seguro` ou algo equivalente, seguir o workflow Antigravity:

`/Users/marcosgomes/.gemini/antigravity/playground/ancient-copernicus/ai_service/_agents/workflows/deploy/deploy-seguro.md`

Rotina obrigatoria antes de publicar:

1. Revisar o que mudou com `git diff --stat` e, quando necessario, `git diff`.
2. Rodar `npm run build`.
3. Se arquivos de IA foram alterados, rodar `npx tsc --noEmit --pretty` e revisar imports/tipos nos modulos de IA.
4. Commitar com mensagem descritiva.
5. Enviar para producao com `git push origin main`.
6. Verificar o deploy automatico no Railway, incluindo build logs, startup e primeiras requisicoes.
7. Fazer teste de sanidade na funcionalidade alterada.

Se o Railway CLI estiver desautenticado, registrar isso no retorno ao usuario e pedir login antes de depender de `railway logs/status`.
