# Fase 3 — Checklists versionados e planos de manutenção

Status: bloco 3.3 concluído tecnicamente

Data: 04/08/2026

## Escopo concluído

O backend Node.js passou a fornecer, em paralelo ao Apps Script:

- modelos de checklist com revisões independentes;
- nove tipos de resposta suportados pelo Operador;
- criação, edição, remoção e reordenação atômica de etapas;
- envio ao filtro técnico;
- aprovação permanente por Qualidade, Segurança, um dos dois, ambos ou área personalizada;
- publicação com hash SHA-256;
- criação de nova revisão sem mutação do conteúdo publicado;
- planos preventivos, preditivos, de inspeção, lubrificação, corretivos e condicionais;
- disparos por periodicidade, horímetro, condição, ocorrência ou solicitação manual;
- publicação de plano apenas com checklist publicado e executável.

## Tipos de etapa

| Código                | Uso operacional                                     |
| --------------------- | --------------------------------------------------- |
| `INSTRUCAO`           | orientação sem resposta                             |
| `CONFIRMACAO`         | aceite objetivo                                     |
| `OK_NOK`              | decisão conforme ou não conforme                    |
| `NUMERO`              | medição numérica com limites opcionais              |
| `PARAMETRO`           | leitura vinculada a uma definição técnica           |
| `TEXTO`               | resposta livre                                      |
| `SELECAO`             | escolha em lista controlada                         |
| `EVIDENCIA`           | registro obrigatório de evidência                   |
| `LEITURA_OPERACIONAL` | leitura rastreável vinculada ao ativo ou componente |

O servidor rejeita combinações inconsistentes, como instrução com limites, seleção sem alternativas, evidência sem foto mínima ou parâmetro sem definição técnica.

## Estados e imutabilidade

O ciclo de checklist é:

```text
DRAFT -> IN_REVIEW -> APPROVED -> PUBLISHED -> SUPERSEDED
                  \-> CHANGES_REQUESTED
                  \-> REJECTED
```

- etapas só podem mudar em `DRAFT` ou `CHANGES_REQUESTED`;
- submissão exige pelo menos uma etapa ativa;
- cada revisor emite um único parecer imutável por revisão;
- a política determina quais assinaturas concluem a aprovação;
- publicação exige revisão aprovada e hash vigente;
- alterações futuras criam uma nova revisão e preservam a anterior.

Os planos seguem o mesmo princípio: somente a revisão editável muda, enquanto versões publicadas permanecem auditáveis.

## Autorização

Capacidades adicionadas:

- `maintenance.checklists.read`;
- `maintenance.checklists.manage`;
- `maintenance.checklists.review`;
- `maintenance.checklists.publish`;
- `maintenance.plans.read`;
- `maintenance.plans.manage`;
- `maintenance.plans.publish`.

O Administrador gerencia e publica. Qualidade e Segurança consultam e revisam. O Operador recebe somente consulta ao contrato publicado necessário para execução futura. Todas as decisões são novamente verificadas no servidor; a interface não é fonte de permissão.

## Massa de homologação

A massa controlada agora inclui:

- um checklist publicado para a bomba de alimentação;
- os nove tipos de etapa em uma única rotina executável;
- parecer permanente da Qualidade;
- parecer permanente da Segurança;
- um plano preventivo periódico publicado;
- um plano acionado por ocorrência publicado.

IDs são estáveis e a carga pode ser executada repetidamente sem duplicar registros.

## Validação executada

Ambiente:

- Node.js 24 LTS;
- PostgreSQL 18;
- banco isolado `fab_control_node_test_20260804_125901`;
- migrações `0001` a `0010`;
- usuário de runtime sem `SUPERUSER`, `CREATEDB`, `CREATEROLE` ou `BYPASSRLS`.

Resultado:

```text
9 testes
9 aprovados
0 falhas
2 execuções idênticas do seed aprovadas
```

O teste integrado comprovou os nove tipos, rejeição de combinação inválida, dupla aprovação, publicação, bloqueio de mutação no banco, criação e publicação de plano e abertura de novas revisões.

## Limite do bloco

Apps Script, planilhas, frontends e dados atuais permanecem intactos. O Node.js ainda não é a fonte operacional. Ordens de serviço, demandas, assinaturas de execução, notificações e telemetria em tempo real pertencem aos próximos blocos e serão conectados antes da Fase 4 e do corte formal.
