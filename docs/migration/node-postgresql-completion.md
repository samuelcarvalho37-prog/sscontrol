# Migração Node.js + PostgreSQL — estado de conclusão

Data da validação: 11/08/2026

## Resultado

A implementação da migração está concluída para homologação local. O Apps Script e as planilhas continuam preservados como origem de rollback; nenhum código legado ou dado de produção foi excluído.

O corte de produção ainda depende somente da infraestrutura externa escolhida, da carga delta final e do aceite dos três perfis. Não deve ser executado apontando diretamente para a planilha de produção.

## Cobertura implementada

- Fastify/Node.js com TypeScript estrito e contrato HTTP versionado;
- PostgreSQL com 16 migrações aditivas, RLS multiempresa e usuário de runtime sem privilégios administrativos;
- autenticação Argon2id, primeiro acesso, recuperação, sessões revogáveis e bloqueio progressivo;
- acesso integral de manutenção com janela auditada, código de uso único armazenado somente como HMAC e expiração curta;
- usuários, áreas, cargos, capacidades e matriz de permissões;
- estrutura fabril, ativos, componentes, materiais, parâmetros, limites, leituras e alertas;
- nove tipos de etapa de checklist, versões, revisões, assinaturas permanentes e publicação;
- planos, OS, ações, fila do Operador, execução, respostas, evidências e revisão pós-execução pelo Gestor;
- ocorrências, paradas, análise técnica, solicitação de ação sobre parâmetro e notificações persistentes;
- indicadores técnicos sem OEE quando não existe base de produção;
- documentos privados, auditoria, backup verificado, restauração protegida e importação governada;
- carga idempotente das 48 abas exportadas e reconciliação sem duplicação;
- adaptadores Node para os fluxos ativos dos portais Operador, Gestor e Administrador.

## Validação reproduzível

No PowerShell, a partir da raiz do repositório:

```powershell
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
& '.\backend\node-api\scripts\test-local.ps1'
```

O comando cria um banco descartável novo, aplica todas as migrações, valida o contrato relacional, executa os testes e aplica a massa de homologação duas vezes para comprovar idempotência.

Resultado aprovado em 11/08/2026:

```text
16 migrações aplicadas
17 testes aprovados
0 falhas
seed de homologação aplicado 2 vezes
contrato RLS e multiempresa aprovado
```

## Homologação manual dos três portais

Depois da validação anterior:

```powershell
npm.cmd run build --prefix '.\backend\node-api'
Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass -Force
& '.\scripts\start-node-homologation.ps1' -Restart
```

Endereços:

| Perfil | Endereço |
| --- | --- |
| Operador | `http://127.0.0.1:5173/` |
| Gestor, Qualidade, Segurança e Manutenção | `http://127.0.0.1:5174/` |
| Administrador | `http://127.0.0.1:5175/` |
| API e documentação OpenAPI | `http://127.0.0.1:3333/` e `http://127.0.0.1:3333/docs` |

O inicializador gera senhas aleatórias, atualiza somente o banco descartável e grava as credenciais em `.homologation-runtime/node/access.local.json`. Esse diretório é ignorado pelo Git. Matrículas disponíveis:

- `USR-ADMIN-DEMO`;
- `USR-QUAL-DEMO`;
- `USR-SEG-DEMO`;
- `USR-MAN-DEMO`;
- `USR-OPE-DEMO`.

## Roteiro mínimo de aceite

1. Administrador: criar checklist com etapas de confirmação, número, parâmetro, texto e evidência; enviar para Qualidade e Segurança.
2. Qualidade: revisar, assinar e confirmar que a primeira assinatura não libera uma política dupla.
3. Segurança: assinar e confirmar que as duas assinaturas permanecem no documento.
4. Administrador: publicar o plano, criar a OS e liberar a ação.
5. Operador: abrir a fila, assumir, responder o checklist, anexar evidência e concluir.
6. Gestor: revisar a execução e aprovar ou devolver com comentário.
7. Gestor: ler um ativo, registrar parâmetro fora da faixa e solicitar ação ao Administrador.
8. Administrador: abrir a notificação, confirmar o contexto correto e consultar a auditoria.
9. Todos: sair e entrar novamente para confirmar persistência de leitura, assinatura e status.

## Acesso de manutenção

O modo integral não usa senha fixa. Abra uma janela com usuário administrativo:

```powershell
npm.cmd run maintenance:open --prefix '.\backend\node-api' -- --operator=USR-ADMIN-DEMO --reason="Manutenção homologada" --minutes=30
```

O código exibido funciona uma vez, cria sessão `SISTEMA`, expira com a janela e é auditado. Cinco tentativas inválidas bloqueiam temporariamente a troca.

## Corte seguro de produção

1. congelar escritas administrativas por uma janela curta;
2. executar e verificar os backups do Apps Script, planilhas e PostgreSQL;
3. aplicar as migrações com uma credencial separada de implantação;
4. executar `migration:run` sobre o snapshot autenticado;
5. executar `migration:delta` para capturar alterações ocorridas depois do snapshot;
6. reprovar o corte se a reconciliação apontar órfão, divergência de contagem ou checksum;
7. configurar segredos em cofre, TLS `verify-full`, CORS explícito e armazenamento privado;
8. apontar primeiro o canário para a API Node e executar o roteiro de aceite;
9. somente após o aceite, alterar os endpoints de produção;
10. manter Apps Script e planilhas somente leitura durante a janela de estabilização.

## Rollback

Em caso de falha após o corte:

1. interromper novas escritas na API Node;
2. preservar logs, outbox, auditoria e banco sem apagar tabelas;
3. restaurar o endpoint dos frontends para o Web App legado;
4. reativar a escrita nas planilhas somente depois de confirmar consistência;
5. registrar o intervalo Node e reconciliar essas transações antes de uma nova tentativa.

O rollback nunca usa `DROP`, exclusão de planilhas ou sobrescrita do código legado.

## Pendências externas ao código

- provisionar PostgreSQL gerenciado e hospedagem Node com TLS;
- cadastrar segredos reais no provedor, sem arquivos `.env` versionados;
- executar carga delta e homologação formal com os usuários responsáveis;
- configurar domínio, observabilidade e política de retenção de backups;
- empacotar e publicar os aplicativos nas lojas após o aceite do ambiente web.
