# VORQIX — estado de desenvolvimento

## Publicação das alterações locais — 31/10/2026

- As alterações deste checkout são publicadas na branch `feat/v1-super-urgency-workflow`, a partir de `4baefaa`.
- Este conjunto preserva os ajustes locais de fluxo operacional, cancelamento e substituição de OS, tipos de manutenção, notificações, sessão e interface. Inclui a correção da ordenação das ações por `generated_at` nas notificações e a tipagem explícita do retorno do cancelamento.
- A branch atualizada do Natan, `dev/natan-refinamento-frontend` em `1682366`, é mantida em outro checkout. Seus sete commits de plataforma/TI/PCM não foram mesclados neste conjunto.
- As migrations locais `0046_v1_work_order_type_alignment.sql` e `0047_cancelled_occurrence_work_order_replacement.sql` pertencem a esta linha de desenvolvimento. A integração futura com a branch do Natan precisa reconciliar a sequência de migrations; não aplicar indiscriminadamente as duas linhas sobre o mesmo banco.
- Foi executado teste direcionado na versão ativa do Natan, em banco isolado: cadastro de corretiva vinculada a ocorrência aprovado; preventiva assumida, iniciada, respondida, com evidência e concluída com OS/ação/execução em `COMPLETED`.
- Na mesma versão ativa, a suíte integrada ampla teve 39 testes: 36 aprovados e três falhas, sem testes ignorados. Falhas: contrato de integridade administrativa (`primary-storage` versus expectativa `postgresql`), assinatura pós-intervenção (`POST_INTERVENTION_EXECUTION_REQUIRED`) e limite de conexões do PostgreSQL no teste concorrente de numeração. Não classificar a suíte inteira como aprovada.
- Esses testes usaram banco dedicado, com identidades e ordens próprias de teste; nenhuma OS real do `vorqix_dev` foi concluída pelo procedimento.
- Arquivos `.env`, credenciais, tokens, backups e dados do banco não fazem parte desta publicação.

## Registro histórico de 17/10/2026

O registro abaixo descreve uma validação anterior e não representa o HEAD nem a quantidade de arquivos desta publicação.

Atualizado em 17/10/2026. Este registro resume o estado observado no checkout
`C:\Projetos\vorqix-repo`; não substitui o histórico dos commits nem relatórios
de homologação anteriores.

## Checkout e preservação

- Branch: `feat/v1-super-urgency-workflow`.
- HEAD observado: `e669cc9`; `main` e esta branch apontam atualmente ao mesmo
  commit-base.
- Há alterações locais não commitadas em 19 arquivos rastreados e dois arquivos
  novos não rastreados: a migration forward-only 0046 e este registro de continuidade.
  Preservar todos.
- O banco descartável autorizado foi confirmado e recebeu somente a migration
  0046; nenhum outro banco foi conectado ou alterado.
- Nenhum servidor HTTP foi iniciado ou reiniciado nesta validação.

## Decisões funcionais vigentes

- A operação usa o fluxo tradicional de Ordens de Serviço; o módulo independente
  de Super Urgência está descartado.
- Criticidade: `LOW`, `MEDIUM`, `HIGH`, `CRITICAL`, sendo `CRITICAL` a prioridade
  máxima da OS.
- Tipos de manutenção da V1: corretiva, preventiva, lubrificação e melhoria.
- Preditiva fica reservada à V2. Registros históricos devem permanecer legíveis.
- A Fase 3 (pendências, materiais e troca de turno) está no commit-base
  `e669cc9`.

## Estado observado

| Área | Classificação | Evidência / próximo passo |
| --- | --- | --- |
| Fase 3 — execução, falta de peças e troca de turno | Implementada no commit-base | Teste integrado operacional passou nesta validação. |
| Lubrificação em OS e planos | Implementada localmente | Testes integrados de operações e planejamento passaram nesta validação. |
| Bloqueio de criação/edição/publicação de planos preditivos na V1 | Implementado localmente | Teste de planejamento passou; PREDICTIVE permanece permitido na constraint para compatibilidade histórica. |
| Prioridade crítica e ordenação | Implementada | Testes integrados direcionados e teste unitário da avaliação passaram. |
| Validação do formulário de análise | Implementada localmente | Diagnóstico/recomendação alinhados aos mínimos da API; prioridade normalizada. |
| Super Urgência independente | Descartada no código de aplicação inspecionado | A migration histórica 0041 ainda aceita `SUPER_URGENCIA` na restrição de pausa. O teste verifica rejeição pela API. Remoção estrutural requer migration forward-only, sem editar 0041. |
| Migration 0046 — alinhamento do tipo de OS | Aplicada no banco descartável | A constraint agora aceita lubrificação, mantendo tipos históricos; migrations 0043–0045 antigas não foram reescritas. |
| Fase 4 — perfil Operador; Fase 5 — Qualidade/Segurança; Fase 6 — consolidação | Planejamento aprovado, conclusão não comprovada aqui | Verificar estado existente antes de iniciar trabalho novo. |

## Validações executadas nesta atualização

- Frontend typecheck: PASS.
- Frontend build: PASS (o Vite emitiu aviso sobre tamanho de chunk).
- Backend typecheck: PASS, exit code 0.
- ESLint direcionado aos arquivos alterados de operações, planejamento e testes:
  PASS, exit code 0.
- `occurrence-assessment.test.ts`: PASS, 1 teste, 0 falhas.
- `operations.integration.test.ts`: PASS na repetição direcionada. A primeira
  execução falhou transitoriamente com HTTP 500 durante conversão concorrente
  de ocorrência em OS; a causa não foi reproduzida na repetição.
- `planning.integration.test.ts`: PASS.
- `work-order-operational-model.integration.test.ts`: PASS.
- Total final direcionado: 4 cenários de teste PASS, 0 SKIP; houve 1 falha
  transitória inicial posteriormente aprovada na repetição.
- PostgreSQL 16.15 confirmado em `127.0.0.1:55432`, cluster ID
  `7696270692940348412`, banco `fab_control_node_test_20261013_193348`.
- Credencial runtime específica do cluster restaurada em arquivo protegido;
  role sem `SUPERUSER` e `BYPASSRLS`.
- Backend build: interrompido pela demora e pressão de memória; resultado
  inconclusivo nesta atualização.
- `git diff --check`: PASS, exit code 0 após a edição deste registro.
- Testes E2E visuais: não executados; Produção/Operador, Técnico e PCM seguem
  pendentes de homologação manual.

## Próxima sequência segura

1. Verificar novamente `git status` e `git diff --check`, preservando o estado.
2. Manter o banco descartável separado dos ambientes de desenvolvimento e
   homologação; a migration 0046 já foi aplicada somente nele.
3. Investigar a falha transitória de HTTP 500 se voltar a ocorrer.
4. Validar ponta a ponta os perfis Operador/Produção, Técnico e PCM; marcar como
   pendente qualquer fluxo não exercitado de fato.
5. Planejar, sem alterar migration histórica, a retirada da aceitação estrutural
   do código `SUPER_URGENCIA` se ainda for necessária.
6. Atualizar este registro com evidências. Não publicar, fazer merge ou congelar
   no `main` sem autorização e homologação do proprietário.

## Documentação histórica

Alguns documentos de migração anteriores ainda descrevem a antiga numeração de
fases. Eles registram o contexto histórico e não devem ser tratados como o
planejamento funcional vigente sem reconciliação.
