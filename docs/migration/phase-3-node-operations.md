# Fase 3 — Ordens, validação técnica e execução

Status: bloco 3.4 concluído tecnicamente

Data: 04/08/2026

## Escopo concluído

O backend Node.js passou a controlar, em paralelo ao Apps Script, o fluxo transacional completo:

1. o Administrador cria uma OS exclusivamente a partir de plano publicado;
2. a API confirma que o plano referencia checklist publicado com etapas ativas;
3. o conteúdo da OS é selado por SHA-256 e enviado ao filtro técnico;
4. uma devolução pode ser corrigida e reenviada sem apagar a demanda anterior;
5. Qualidade, Segurança, um dos dois ou ambos assinam conforme a política escolhida;
6. cada assinatura permanece vinculada à identidade, área, cargo, entidade, versão e hash;
7. o Administrador libera somente uma demanda integralmente aprovada;
8. a liberação cria uma ação executável na fila do Operador;
9. ao assumir, o checklist publicado vira um snapshot imutável da execução;
10. respostas e evidências são validadas conforme o contrato de cada etapa;
11. a conclusão remove a ação da fila do Operador e preserva todo o histórico.

## Barreiras no PostgreSQL

As regras críticas não dependem da interface:

- `maintenance.validate_work_order_release` impede liberar OS sem plano publicado, checklist publicado, etapas ativas, demanda aprovada, hash correspondente ou requisitos pendentes;
- `workflow.validate_technical_signature` impede assinatura sem atribuição técnica ativa, por autor segregado ou em conteúdo divergente;
- `maintenance.validate_execution_transition` impede assumir ação não liberada e concluir com respostas ou evidências pendentes;
- `maintenance.refresh_execution_evidence_count` mantém o contador de evidências derivado dos registros reais;
- revisões publicadas e assinaturas são imutáveis;
- as tabelas continuam isoladas por tenant através de RLS.

## Capacidades

| Capacidade                        | Uso                                             |
| --------------------------------- | ----------------------------------------------- |
| `maintenance.work-orders.read`    | consultar OS, validações e histórico            |
| `maintenance.work-orders.manage`  | criar e enviar OS ao filtro técnico             |
| `maintenance.work-orders.review`  | assinar ou solicitar correções                  |
| `maintenance.work-orders.release` | liberar ao Operador após aprovação              |
| `maintenance.executions.read`     | consultar execução, respostas e evidências      |
| `maintenance.executions.perform`  | assumir, iniciar, responder e concluir execução |

O Administrador recebe gestão e liberação. Os perfis técnicos recebem leitura e revisão. O Operador recebe leitura e execução. A autorização é recalculada no servidor em cada requisição.

## Massa de homologação

O seed idempotente acrescenta dois cenários com IDs estáveis:

- `OS-HML-REVIEW-001`: ordem crítica aguardando assinaturas de Qualidade e Segurança;
- `OS-HML-READY-001`: ordem já assinada e liberada, com ação disponível ao Operador.

Assim, Administrador, Gestor de Qualidade, Gestor de Segurança e Operador conseguem testar caminhos distintos sem depender de registros históricos das planilhas.

## Teste integrado

O teste `operations.integration.test.ts` percorre o caminho real pela API:

- autenticação dos quatro atores;
- criação e submissão da OS;
- devolução, correção e reenvio com duas revisões preservadas;
- comprovação de que a primeira assinatura não libera a ordem;
- assinatura de Qualidade e Segurança;
- comprovação de permanência das assinaturas;
- liberação e criação da fila operacional;
- atribuição e início da execução;
- resposta de confirmação;
- resposta de parâmetro e criação automática da leitura técnica;
- bloqueio da conclusão sem evidência;
- vínculo de objeto de armazenamento existente;
- conclusão da execução, ação e OS;
- ausência da ação concluída na fila do Operador;
- presença dos eventos na auditoria.

## Garantia de não perda

Nenhum arquivo do Apps Script, frontend ou planilha foi removido ou substituído. O PostgreSQL usado na validação é isolado e preservado para inspeção. O Node.js ainda não é a fonte de produção; o corte só ocorrerá após o script de migração, reconciliação dos dados e homologação formal dos três perfis.

## Próximo bloco

O bloco 3.5 deve migrar ocorrências, paradas, notificações, consultas analíticas e indicadores técnicos. Depois dele, a Fase 4 implementará extração, transformação, carga e reconciliação das planilhas para o PostgreSQL.
