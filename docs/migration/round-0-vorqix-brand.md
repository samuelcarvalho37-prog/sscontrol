# Rodada 0 — Marca VORQIX

## Mudanças

- Textos visíveis dos dois frontends, telas de login/carregamento, cabeçalhos, apresentação dos portais, informações de conexão e títulos HTML usam VORQIX.
- A imagem `assets/vorqix-logo.png` foi copiada integralmente para a pasta pública de cada frontend e aplicada nas telas de entrada, cabeçalho operacional, gestão e administração. A imagem original não foi editada.
- Downloads de modelos e indicadores usam nomes VORQIX.
- Identificadores de sessão, cache, eventos, banco, rotas e compatibilidade com o backend legado permanecem intactos.

## Contrato

Não há migration nem alteração de dados. A apresentação dos perfis continua seguindo `roles-functional-identity.md`. A correção complementar do filtro do portal é documentada nesse contrato, com testes próprios.

## Validação

Verificação de textos antigos, três testes de acesso ao portal, contrato de autenticação e contrato administrativo. Typecheck/build dos dois frontends e `npm test` do backend em banco isolado são os critérios para encerrar esta rodada.

Rodada concluída: typecheck dos três pacotes e build dos dois frontends passaram. A repetição sequencial de `npm test` passou com 18 testes, zero falhas e zero cancelamentos (log local `results-1788916272646.log`). A execução anterior sofreu três timeouts enquanto os builds concorriam pelos recursos da máquina.

A prévia local de gestão utiliza o proxy `/api` do Vite para acessar a API em `127.0.0.1:3333`, evitando dependência da porta escolhida para o frontend na lista de CORS. A configuração local usa `VITE_API_BASE_URL=/api`; produção continua usando sua configuração de ambiente. O endpoint `/api/health/ready` confirmou API e banco disponíveis.
