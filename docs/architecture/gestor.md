# Aplicação do gestor

## Responsabilidade

O administrador governa cadastros, versões e publicação. O gestor é o filtro técnico responsivo entre a administração e a execução do operador. O perfil de acesso continua sendo `GESTOR`; área, cargo, especialidades e escopo definem qual trabalho cada gestor recebe.

Exemplos:

- perfil `GESTOR`, área `QUALIDADE`, cargo `INSPETOR DE QUALIDADE`;
- perfil `GESTOR`, área `MANUTENCAO`, cargo `TECNICO DE MANUTENCAO`;
- perfil `GESTOR`, área `SEGURANCA`, cargo `TECNICO DE SEGURANCA`;
- perfil `GESTOR`, área `SUPERVISAO`, cargo `SUPERVISOR`;
- perfil `GESTOR`, área `LIDERANCA_SETOR`, cargo `LIDER DE SETOR`.

## Fluxo ponta a ponta

1. O administrador cria o checklist, plano, OS ou outra entidade versionada.
2. O administrador envia uma demanda para uma área, cargo ou usuário técnico e define assinatura, segregação e SLA.
3. O gestor assume, analisa, assina, aprova, devolve ou encaminha para outra área.
4. Cada transição registra origem, destino, parecer, motivo, usuário, data e hash do payload.
5. Uma demanda com assinatura obrigatória não pode ser aprovada enquanto a quantidade exigida não for atingida.
6. Quando há segregação, o autor não pode assinar ou aprovar a própria demanda.
7. A aprovação ativa a versão do checklist/plano. A liberação operacional torna a decisão disponível ao fluxo do operador.
8. O operador executa somente modelos formalmente validados.

Ocorrências seguem o caminho inverso: operador registra, gestor produz análise técnica e recomenda checklist ou OS, administrador converte a recomendação em artefato formal e inicia nova validação.

## Persistência

- `areas_tecnicas` e `cargos_tecnicos`: catálogo configurável;
- `demandas_tecnicas`: estado, destino, SLA, versão e hash;
- `demanda_tramitacoes`: histórico imutável de encaminhamentos e decisões;
- `assinaturas_tecnicas`: assinatura eletrônica interna autenticada;
- `analises_tecnicas`: diagnóstico e recomendação sobre ocorrências;
- `notificacoes`: caixa de entrada por usuário;
- `turnos`, `apontamentos_producao` e `sla_politicas`: base de OEE e SLA.

A assinatura implementada é uma assinatura eletrônica interna: identidade autenticada, instante, significado, versão da entidade e SHA-256 do payload. Ela não deve ser apresentada como assinatura qualificada ICP-Brasil.

## Indicadores

- disponibilidade: tempo operacional dividido pelo tempo observado;
- MTTR: tempo total de reparo de falhas não planejadas dividido pela quantidade de falhas;
- MTBF: tempo operacional dividido pela quantidade de falhas não planejadas;
- lead time de OS: média entre abertura e finalização;
- lead time técnico: média entre criação e conclusão da demanda;
- SLA: percentual atendido entre demandas elegíveis, usando prazos de primeira resposta e resolução;
- OEE: disponibilidade × performance × qualidade, calculado somente quando existem apontamentos de produção válidos.

Ausência de amostra retorna `null` e `oee_disponivel: false`; ausência de dados nunca é exibida como desempenho zero.

## Segurança administrativa

- endpoints de cadastro de área, cargo, identidade e envio administrativo são exclusivos de `ADMIN`;
- hashes de PIN e senha nunca são serializados;
- alteração de perfil ou inativação revoga sessões ativas;
- o último administrador ativo não pode ser removido;
- decisões, assinaturas, conversões e alterações geram auditoria.

## Interface

O gestor mantém navegação e densidade adequadas a celular, tablet e computador. O Command Workspace do administrador será desktop-only e consumirá o mesmo contrato de identidades, análises, roteamento, notificações, SLA e indicadores.
