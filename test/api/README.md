# Coleção da API (TRA-148)

`trackerr.postman_collection.json` cobre os fluxos críticos da API: saúde, cadastro, login, refresh com rotação, carteira, isolamento entre usuários (IDOR) e os direitos do titular (exportar e apagar a conta).

Roda no CI, no job `docker` de `.github/workflows/ci.yml`, contra a imagem de produção com Mongo e Redis efêmeros. **Cria e apaga usuários: nunca aponte para produção.**

Para rodar localmente contra uma API de desenvolvimento:

```bash
npx --yes newman@6.2.1 run test/api/trackerr.postman_collection.json --env-var baseUrl=http://127.0.0.1:3000
```

A coleção abre no Postman (Import → arquivo). Rotas novas entram aqui quando forem críticas (dinheiro, dado pessoal ou autorização).
