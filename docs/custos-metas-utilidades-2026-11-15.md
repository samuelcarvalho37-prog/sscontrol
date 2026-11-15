# Custos, metas e utilidades

## Uso no PCM

Na lousa, abra **Gestão de custos, metas e recorrência**. O quadro oferece:

- Custos por linha/sistema: peças de estoque, mão de obra interna, terceiros, total conhecido e quantidade de lançamentos pendentes. Clicar na linha abre seus lançamentos e os links das OS.
- Mão de obra externa do mês atual, comparação em reais com o mês anterior, acumulado anual, evolução mensal e separação de peças, outros custos e valores não classificados.
- Orçamento mensal opcional de mão de obra externa, saldo e aviso de estouro. Não existe orçamento financeiro presumido. Valores pendentes ou não classificados podem aumentar o gasto identificado posteriormente.
- Cumprimento mensal e anual acumulado, pendências por criticidade, assinaturas finais, paradas por equipamento/linha, motivos de espera, horas de preventivas e ranking de até 20 equipamentos por custo conhecido.
- Alertas a partir de duas corretivas no mesmo equipamento ou na mesma linha no período. Repetição não prova igualdade de causa.

Cinco indicadores adicionais ficam disponíveis em **Adicionar indicador**: cumprimento mensal, cumprimento anual, mão de obra externa mensal, custo de manutenção por linha e equipamentos com corretivas repetidas. A entrega não salva nem substitui o layout pessoal da lousa. O quadro de gestão usa o período geral dos indicadores, não os filtros visuais de segmentação da lousa. Mês e ano atuais usam America/Sao_Paulo e estão identificados separadamente.

## Custo por técnico

Em **Custo por hora da equipe — vigências**, selecione um técnico ativo e informe o custo-hora aprovado pelo financeiro. O sistema não armazena salário nem calcula encargos trabalhistas. O financeiro deve entregar o custo-hora e a base de custeio acordada pela empresa.

Vigência vazia significa agora. Datas passadas não são aceitas. Uma nova vigência é um registro novo, com auditoria; não sobrescreve registros anteriores. Cada intervalo individual de trabalho recebe uma fotografia da taxa vigente quando começa. Reajustes não mudam essa fotografia. Uma vigência iniciada durante um intervalo será utilizada no próximo intervalo que começar. Pausas não são cobradas como trabalho: o cálculo usa os intervalos individuais encerrados. A soma da equipe não deve ser confundida com o tempo de parada do equipamento.

Intervalos antigos sem taxa e execuções legadas sem intervalos continuam com custo pendente. Não foram preenchidos com valores atuais nem considerados gratuitos. Intervalos abertos também ficam pendentes até o encerramento. Totais monetários são os valores conhecidos; a pendência permanece visível.

## Serviços externos e execução mista

Nos detalhes da OS, o PCM pode incluir participação externa numa ordem interna, informando justificativa de pelo menos dez caracteres. A operação muda a classificação para mista, com auditoria, e não altera plano, escopo técnico, assinaturas ou resultado. OS canceladas não aceitam a operação. As permissões de gerenciamento financeiro existentes continuam sendo exigidas no backend.

Ao registrar um serviço externo, selecione mão de obra, peças fornecidas pelo prestador, outros custos ou não classificado/fatura mista. Em fatura discriminada, registre parcelas sem repetir o total da nota. Peças já apropriadas pelo consumo do estoque não devem ser novamente somadas como custo externo da mesma peça. Lançamentos antigos permanecem não classificados: não é possível inferir a composição de uma fatura pelo valor.

O indicador é por competência, não pagamento: data do serviço, ou data de registro quando não informada. Peças são apropriadas na data do consumo; mão de obra interna, no término de cada intervalo de trabalho. Um intervalo que cruza a virada do mês é apropriado integralmente no mês em que termina. A lista detalhada limita-se aos 500 lançamentos mais recentes; totais por linha e ranking usam todos os lançamentos elegíveis do período.

O agrupamento por linha usa o vínculo cadastral atual do ativo. Não reconstitui movimentações históricas de equipamentos entre linhas.

## Cumprimento de prazo

Base: OS com vencimento no mês/ano corrente, excluindo rascunhos e cancelamentos. Percentual acumulado = encerradas no prazo com vencimento até hoje / OS com vencimento até hoje. OS vencidas abertas e encerradas com atraso continuam no denominador. Futuras são mostradas à parte. Sem vencimentos, mostra “Sem vencimentos”, não 100%. OS sem data não são classificadas como no prazo. Considera encerramento da OS, incluindo a conclusão do fluxo de assinaturas exigidas, e a programação atualmente registrada.

Paradas são medidas dentro da interseção com o período consultado. Somar horas de equipamentos parados simultaneamente não produz o tempo real de parada de uma linha. Horas de preventivas não são um indicador automático de manutenção planejada: corretivas também podem ser planejadas.

## Utilidades

Cadastro reaproveitado: Planta → Setor Utilidades → Linha/sistema → Equipamento/instalação → Componentes. Acrescentados os tipos Tubulação/trecho, Rede de distribuição, Reservatório e Tanque nos cadastros do PCM e TI. Não foram criados ativos fictícios, nem um controle de volume/conteúdo de tanques.

## Segurança e atualização

- Migrations forward-only 0068 e 0069, com FORCE RLS e chaves por empresa. Backup local de homologação gerado antes da alteração.
- Cadastro de custo-hora e orçamento reutiliza a permissão financeira de editar custos; inclusão de participação externa reutiliza registrar serviço externo. Nenhum perfil recebeu novas concessões.
- Novos endpoints: GET/POST `/v1/maintenance/labor-rates`, POST `/v1/maintenance/external-labor-budget`, POST `/v1/maintenance/work-orders/:workOrderId/enable-external`. A categoria opcional `categoria_custo` foi adicionada ao lançamento externo, preservando clientes antigos.
- Outros ambientes precisam aplicar as migrations antes de iniciar a API atualizada. O inicializador local informa schema 0069. Credenciais e configurações locais não integram o commit.

## Verificação

Teste transacional real no banco de homologação, com rollback: classificação de serviço externo, fatura não discriminada fora do subtotal de mão de obra, orçamento e sua revisão, mudança interna→mista, taxas com vigência, fotografia imutável, cálculo de uma hora a 60 mais uma hora a 90 e isolamento entre empresas. Nenhum valor fictício de taxa ou orçamento foi persistido.

Conferidos por HTTP: relatório real, leitura financeira do PCM e bloqueio 403 ao operador. No Chrome: painel escuro, catálogo dos cinco novos indicadores, técnicos elegíveis, campos de orçamento, filtro por linha e abertura da OS de origem. Conferência responsiva a 390 px sem transbordamento horizontal da página; tabelas largas têm rolagem própria. Compilações, testes de frontend/backend e orçamento do JavaScript inicial registrados nos logs privados da revisão.

Resultado: 72 testes de frontend aprovados; 44 testes de backend aprovados, com 29 integrações condicionais não executadas nessa suíte. O teste transacional financeiro foi executado separadamente no banco real e passou, assim como os sete testes direcionados de permissões. Typecheck, build da API e builds de produção dos dois frontends aprovados. JavaScript inicial do gestor: 348.620 bytes / 104.966 bytes gzip, dentro dos limites existentes. As builds de frontend foram conferidas com NODE_ENV=production, sem herdar o modo de desenvolvimento da API local.

A próxima homologação deve acompanhar uma OS nova, cadastrar um custo-hora real aprovado e conferir a saída de estoque, os intervalos de cada participante, o serviço externo discriminado e o fechamento financeiro. O teste físico no iPhone continua separado desta entrega.
