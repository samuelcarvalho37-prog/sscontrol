# Blueprint de migração — Fase 1

Status: concluído para validação do proprietário

Escopo: levantamento do ambiente atual, sem alteração de produção

Data do levantamento: 29/07/2026

Versão candidata mapeada: 1.4.0

Base de produção preservada: 1.3.1

## 1. Regra de segurança

Esta migração será aditiva. Nenhum arquivo, aba, implantação, dado, evidência ou segredo do ambiente atual pode ser removido, substituído ou sobrescrito durante a construção do novo ambiente.

O Apps Script e as planilhas continuarão sendo a fonte operacional até que, cumulativamente:

1. os backups tenham sido criados e verificados;
2. o esquema novo tenha sido aprovado;
3. a primeira migração tenha ocorrido em ambiente isolado;
4. contagens, chaves, relações, arquivos e hashes tenham sido conferidos;
5. os três perfis tenham passado pelo fluxo ponta a ponta;
6. o corte tenha uma janela aprovada e um procedimento de retorno testado;
7. o proprietário aprove explicitamente a troca da fonte principal.

Não será feita migração direta sobre produção. O novo backend deve nascer em paralelo.

## 2. Fontes examinadas

- Repositório local: `C:\Users\natan\OneDrive\Documentos\fab-control-cmms-initial-structure`
- Repositório remoto existente: `https://github.com/NMCSDEV02/fab-control-cmms.git`
- Branch atual: `feat/gestor-app-1.4.0`
- Backend Apps Script: `backend/apps-script`
- Manifesto da aplicação: `backend/apps-script/appsscript.json`
- Manifesto da versão: `release/fab-control.release.json`
- Snapshot declarado do esquema: `release/spreadsheet-schema.snapshot.json`
- Frontend do Administrador: `frontend`
- Frontend do Gestor: `frontend-gestor`
- Frontend do Operador: integrado ao projeto existente

O levantamento identificou que, apesar da premissa inicial de inexistência de Git, há um repositório Git ativo, com remoto configurado. Isso aumenta a segurança da migração, mas não substitui os backups das planilhas, do Apps Script, do Drive e das propriedades do projeto.

## 3. Ambientes atuais

| Ambiente | Release | Apps Script | Planilha | Situação |
|---|---:|---|---|---|
| Produção | 1.3.1 | implantação imutável registrada no manifesto | planilha de produção registrada no manifesto | deve permanecer inalterada |
| Homologação/canário | 1.4.0 | versão imutável 39 | planilha isolada de canário | estrutura candidata mapeada |

O código 1.4.0 declara 48 abas. A base pública de produção 1.3.1 declara um subconjunto anterior. Portanto:

- o dicionário de 48 abas representa o contrato atual que deverá ser suportado pelo novo backend;
- antes da migração de dados será obrigatório gerar um snapshot autenticado de nomes, cabeçalhos, quantidade de linhas e chaves das duas planilhas;
- nenhuma coluna será presumida como existente em produção apenas porque existe no código 1.4.0;
- diferenças serão tratadas como migração de versão, nunca como erro a ser “corrigido” diretamente na base original.

## 4. Inventário técnico

O backend atual contém:

- 34 arquivos JavaScript;
- 720 funções declaradas;
- 174 ações roteadas pelo endpoint HTTP;
- runtime V8;
- fuso `America/Sao_Paulo`;
- acesso às APIs de Google Sheets e Google Drive;
- Web App executado como o usuário que publicou;
- Web App atualmente acessível anonimamente, com autenticação de aplicação implementada nas rotas.

O inventário nominal de funções e rotas está em [app-script-inventory.md](./app-script-inventory.md).

## 5. Domínios funcionais que precisam ser recriados

### 5.1 Núcleo HTTP e autenticação

- entrada `GET` e `POST`;
- parser e normalização da requisição;
- roteamento por `action`;
- resposta JSON e padronização de erros;
- login por matrícula;
- primeiro acesso;
- recuperação sem enumeração de usuário;
- bloqueio temporário por tentativas inválidas;
- criação, validação, expiração e revogação de sessão;
- escopo por perfil, área, cargo, tenant e ambiente;
- logout;
- autorização por capacidade;
- acesso interno de manutenção com desafio de uso único.

### 5.2 Administração e cadastros

- resumo administrativo e cache;
- empresa, nome e logomarca;
- usuários, perfis, áreas, cargos e sessões;
- matriz de permissões;
- plantas, setores, linhas, ativos, componentes e materiais;
- validação de vínculos;
- transições de status;
- proteção de exclusão quando houver referências;
- QR Code de ativos e componentes;
- dados de demonstração isolados;
- recálculo de saúde do ativo.

### 5.3 Motor comercial e motor de configuração

- catálogo de planos comerciais;
- recursos liberados por plano;
- autorização de rota no servidor;
- política de negação para recurso não classificado;
- assinatura e integridade do catálogo;
- rascunho, validação, publicação, histórico e rollback;
- assinatura vinculada a tenant e ambiente;
- janela interna de manutenção;
- configuração operacional versionada;
- rascunho por usuário;
- validação de consistência;
- publicação por ponteiro atômico;
- rollback por republicação imutável.

### 5.4 Checklists

- modelos técnicos;
- itens dinâmicos;
- tipos de resposta;
- regras de validação;
- opções, limites, obrigatoriedade e evidências;
- criação rápida;
- ordenação, clonagem e remoção protegida;
- rascunho e envio para validação;
- devolução;
- revisões imutáveis;
- substituição de revisão;
- validação técnica;
- geração da execução a partir do modelo;
- resposta individual e em lote;
- bloqueadores de finalização;
- auditoria de modelo e execução;
- evidências fotográficas.

### 5.5 Planos, intervenções e ordens

- planos programados e não programados;
- gatilhos por tempo, horímetro ou condição;
- controle do próximo disparo;
- geração de OS e ações;
- intervenções administrativas;
- envio para filtro técnico;
- devolução;
- liberação para operação;
- quarentena de ações inconsistentes;
- associação obrigatória de plano/checklist executável;
- modos de parada;
- análise técnica incorporada ao briefing.

### 5.6 Operador

- home e fila viva;
- leitura e resolução de QR Code;
- contexto do ativo e componente;
- histórico;
- início de ação;
- estado da ação;
- checklist de execução;
- respostas compatíveis com todos os tipos do catálogo;
- evidências;
- materiais utilizados;
- parâmetros;
- parada operacional;
- ocorrência;
- finalização com validação;
- tela técnica e auditoria;
- telemetria e bloqueio concorrente.

### 5.7 Gestor

- fila técnica;
- demandas e detalhes;
- assumir, encaminhar, assinar, validar, decidir e devolver;
- política de validação por Qualidade, Segurança, ambos ou responsáveis customizados;
- assinatura permanente vinculada à versão e ao hash do conteúdo;
- análise técnica;
- tratamento de parada;
- envio de recomendação ao Administrador;
- dossiê de ativo e componente;
- parâmetros, limites, leituras e histórico;
- solicitação de ação sobre parâmetro;
- KPIs técnicos;
- notificações e persistência de leitura;
- auditoria de execução concluída;
- colaboração e locks.

### 5.8 Paradas, ocorrências e workflow técnico

- parada do equipamento;
- parada de manutenção;
- espera, execução e retorno operacional;
- tolerância de retorno;
- atualização controlada do estado do ativo;
- ocorrência operacional;
- demanda técnica;
- tramitações;
- assinaturas;
- análise técnica;
- status “em tratamento”;
- SLA de primeira resposta e resolução;
- notificações por usuário, perfil e área.

### 5.9 Indicadores e confiabilidade

- disponibilidade técnica;
- falhas não planejadas;
- MTTR;
- MTBF;
- lead time;
- SLA de resposta e resolução;
- rankings de ativos por impacto;
- execuções concluídas por responsável;
- métricas por ativo e componente;
- diagnóstico e higiene da base.

OEE somente deve existir quando houver dados válidos de produção. O novo modelo não calculará OEE a partir de manutenção isolada.

### 5.10 Governança

- documentos técnicos e revisões;
- arquivos privados no Drive;
- auditoria imutável e redigida;
- monitoramento somente leitura;
- backups gerenciados;
- prévia de restauração;
- confirmação dupla;
- backup de segurança antes da restauração;
- importação governada em duas fases;
- validação de referências;
- confirmação;
- rollback;
- quarentena de legado.

## 6. Estrutura de dados

O esquema atual possui 48 entidades declaradas. O dicionário completo, com todas as colunas, está em [current-data-dictionary.md](./current-data-dictionary.md).

### 6.1 Hierarquia fabril

```text
plantas
  └─ setores
      └─ linhas
          └─ ativos
              └─ componentes
```

### 6.2 Manutenção e execução

```text
planos_manutencao
  ├─ plano_itens
  ├─ plano_controle
  └─ ordens_servico
      └─ os_acoes
          └─ execucoes
              ├─ checklist_execucao
              │   └─ evidencias
              ├─ materiais_uso
              ├─ parametros
              └─ paradas_manutencao
```

### 6.3 Workflow técnico

```text
ocorrencias_operacionais
  ├─ demandas_tecnicas
  │   ├─ demanda_tramitacoes
  │   ├─ assinaturas_tecnicas
  │   └─ analises_tecnicas
  └─ notificacoes
```

### 6.4 Identidade técnica

```text
areas_tecnicas
  └─ cargos_tecnicos
      └─ usuarios
```

Usuários também mantêm perfil macro, escopos e especialidades. A autorização efetiva resulta da combinação de perfil, matriz de capacidades, área, cargo, tenant, ambiente, plano comercial e estado da sessão.

## 7. Parâmetros, limites e alertas

O modelo atual separa:

- definição do parâmetro: `plano_itens.parametro_nome`;
- unidade e faixa: `plano_itens.unidade`, `limite_min`, `limite_max`;
- regra de validação: `plano_itens.validacao_regra`;
- fotografia da regra na execução: mesmos campos em `checklist_execucao`;
- leitura real: `parametros`, vinculada ao ativo e opcionalmente ao componente;
- autor e data: `registrado_por`, `registrado_em`;
- consequência operacional: ocorrência, demanda técnica e notificação.

Não existe uma tabela única denominada “alertas”. O alerta é representado por:

1. leitura fora da faixa;
2. resultado de validação;
3. ocorrência operacional;
4. demanda técnica;
5. notificação direcionada.

Na Fase 2 será necessário decidir se as faixas permanecem versionadas apenas no item do plano ou se também haverá uma entidade própria de especificações técnicas. A segunda opção favorece histórico, vigência e análise de tendências.

## 8. Campos semiestruturados que exigem tratamento

Os seguintes campos armazenam JSON ou listas dentro de células:

- especialidades e escopos de usuário;
- opções de resposta;
- análise e relatório técnico;
- áreas e usuários validadores;
- dias da semana;
- configuração versionada;
- estado bruto e normalizado de importação;
- antes/depois da auditoria;
- payload de quarentena;
- resultados de validação.

No banco novo, itens de consulta frequente devem ser normalizados. Snapshots imutáveis, payloads de auditoria e contratos versionados podem permanecer em JSON tipado.

## 9. Dependências fora das planilhas

### 9.1 Google Drive

- pasta de evidências;
- fotos enviadas pelo Operador;
- pasta de documentos técnicos;
- arquivos e revisões de documentos;
- pasta de backups;
- cópias integrais das planilhas.

Os IDs e URLs precisam ser inventariados. Migrar somente as linhas das planilhas não preserva os arquivos.

### 9.2 Script Properties

As chaves identificadas incluem:

- `FAB_CONTROL_SPREADSHEET_ID`;
- `FAB_CONTROL_APP_ENVIRONMENT`;
- `FAB_AUTH_PASSWORD_PEPPER`;
- `FAB_CONTROL_EVIDENCE_FOLDER_ID`;
- `FAB_DOCUMENTS_FOLDER_ID`;
- `FAB_BACKUP_FOLDER_ID`;
- propriedades temporárias do Administrador inicial;
- assinatura comercial e assinatura de manutenção;
- identidade interna da plataforma;
- catálogo comercial ativo, rascunho, índice e versões;
- guardas transitórios de login e janela de manutenção.

Os valores secretos não devem ser enviados ao chat nem commitados. O backup deve registrar apenas os nomes das chaves em arquivo versionado e guardar os valores em cofre criptografado separado.

### 9.3 Serviços efêmeros

- `CacheService`: desempenho; não é fonte de verdade;
- `LockService`: concorrência; será substituído por transações e locks do novo backend;
- sessão de aplicação: persistida em `sessoes`;
- telemetria de sessão: persistida em `telemetria_sessoes`.

## 10. Segurança atual que precisa ser preservada ou fortalecida

- senha com salt, iterações SHA-256 e pepper em propriedade do script;
- comparação resistente a diferenças de tempo;
- primeiro acesso;
- bloqueio por tentativas;
- recuperação sem informar se a matrícula existe;
- tokens de sessão revogáveis;
- capacidades protegidas no servidor;
- trilha de auditoria;
- segregação criador/aprovador;
- assinatura vinculada ao conteúdo;
- catálogo e configuração assinados;
- janela de manutenção de uso restrito.

Na migração:

- tokens de sessão ativos não devem ser reutilizados pelo Node.js;
- registros de sessões serão preservados para auditoria, mas usuários farão novo login;
- hashes de senha não serão convertidos de maneira irreversível sem estratégia aprovada;
- uma verificação transitória ou redefinição controlada será escolhida na Fase 2/3;
- secrets serão movidos para um gerenciador de segredos;
- o novo backend terá validação de entrada, rate limiting, CORS restrito, cabeçalhos seguros, logs estruturados e auditoria;
- nenhuma chave administrativa ficará no aplicativo mobile.

## 11. Riscos e lacunas encontradas

1. A planilha não oferece chaves estrangeiras reais; vínculos inválidos podem existir.
2. Parte das relações é polimórfica por `entidade_tipo` + `entidade_id`.
3. Há campos JSON sem esquema rígido.
4. Arquivos vivem no Drive e precisam de inventário separado.
5. `sla_politicas.calendario_id` não possui uma aba de calendários declarada; a origem precisa ser confirmada antes da modelagem.
6. Limites técnicos estão acoplados ao item de plano, não a uma especificação técnica independente.
7. Cache e locks do Apps Script não podem ser traduzidos literalmente.
8. Produção 1.3.1 e canário 1.4.0 não devem ser tratados como esquemas idênticos.
9. O Web App aceita acesso anônimo e faz autenticação no nível da aplicação; o novo backend deverá limitar a superfície pública.
10. Script Properties possuem dados essenciais que não aparecem no Git.
11. Evidências e documentos podem ficar órfãos se apenas as planilhas forem exportadas.
12. Datas estão em texto ISO e podem conter células nativas do Sheets; a migração deve preservar fuso e precisão.
13. Exclusões lógicas, status e histórico precisam ser mantidos; não devem virar exclusões físicas acidentais.

## 12. Estratégia de migração sem perda

1. Congelar uma cópia imutável de produção e uma do canário.
2. Exportar planilhas, arquivos do Drive, Apps Script, propriedades, implantações e frontend.
3. Gerar inventário de linhas, IDs, duplicidades, nulos e órfãos.
4. Criar o banco novo isolado.
5. Fazer migração completa de ensaio.
6. Comparar contagens e hashes por entidade.
7. Corrigir o migrador, nunca a base original.
8. Repetir até obter reconciliação integral.
9. Executar testes dos três perfis no novo backend.
10. Manter o sistema antigo operacional durante o ensaio.
11. Fazer carga final mais delta dentro de janela controlada.
12. Trocar a configuração do frontend somente após aprovação.
13. Manter Apps Script e planilhas em modo de retorno por período definido.
14. Só encerrar o legado após aceite formal e novo backup completo.

## 13. Critérios de aceite antes do corte

- 100% das abas esperadas inventariadas;
- 100% das linhas classificadas como migradas, rejeitadas justificadamente ou quarentenadas;
- zero chave primária duplicada no destino;
- zero vínculo obrigatório órfão;
- arquivos do Drive conferidos por ID, tamanho e hash quando disponível;
- assinaturas preservadas com conteúdo e versão;
- histórico e auditoria somente leitura;
- senhas e secrets não expostos;
- login, primeiro acesso, recuperação e logout aprovados;
- Administrador, Gestor e Operador aprovados ponta a ponta;
- QR Code aprovado em ativo e componente;
- parâmetros, limites e alertas aprovados;
- checklist criado, validado, executado e auditado;
- restauração do legado testada;
- plano de retorno aprovado.

## 14. Inclinação inicial de banco

A inclinação técnica inicial é PostgreSQL, sem fechar a decisão nesta fase.

Motivos observados no próprio modelo:

- 48 entidades altamente relacionadas;
- necessidade de integridade referencial;
- transações envolvendo OS, ação, execução, checklist, assinatura e auditoria;
- consultas cruzadas por ativo, componente, responsável, área, status e período;
- versionamento e imutabilidade;
- relatórios e KPIs;
- prevenção de duplicidade e concorrência.

Atualização em tempo real não exige Firestore. Pode ser atendida por WebSocket ou Server-Sent Events no Node.js, mantendo PostgreSQL como fonte de verdade. Push mobile pode usar Firebase Cloud Messaging independentemente do banco.

A comparação de preço, limites gratuitos, operação e escalabilidade será feita na Fase 2 consultando documentação oficial vigente. Nenhum banco está selecionado até a aprovação do Blueprint.

## 15. Próximo ponto de aprovação

Após a validação deste Blueprint:

1. confirmar lacunas do modelo;
2. gerar snapshot autenticado de produção e canário;
3. comparar PostgreSQL e Firebase com dados atuais;
4. escolher o banco;
5. apresentar o esquema novo;
6. aguardar nova aprovação antes de criar o backend.
