# Visão geral do PCM

Frontend adaptado à arte aprovada: fundo azul-petróleo, seis indicadores, custos empilhados por linha, anéis de cumprimento de prazo, mão de obra externa, evolução mensal das preventivas/corretivas e atenção do PCM.

O novo painel é a entrada inicial. “Personalizar lousa” abre a lousa configurável existente, preservando seus layouts salvos e ferramentas. A fila, detalhes de OS e formulários anteriores permanecem disponíveis. O painel financeiro completo fica recolhido abaixo da visão geral.

Não foram criadas OS, custos, orçamentos ou metas fictícias na TOZZI. Ausência de amostra mantém traços e estados vazios. Não há alvo de 95% fixado a partir da imagem: os anéis usam os percentuais e denominadores reais. Valores financeiros preservam centavos. Disponibilidade segue o cálculo da API, que atualmente retorna 100% para os 17 ativos sem paradas.

Período e equipamento filtram a consulta existente do resumo técnico. O gráfico de preventivas/corretivas consulta os últimos seis meses por meio desse mesmo endpoint GET, com duas requisições simultâneas no máximo e cancelamento ao desmontar ou mudar equipamento. Falhas na consulta não são convertidas em zeros. Esse gráfico usa a classificação por mês do relatório existente (data de conclusão/programação/abertura, conforme as regras da API). Os custos e a confiabilidade usam o intervalo selecionado; prazos e orçamento externo mantêm a base corrente explicitada na tela.

Verificação: 13 testes passaram, incluindo ausência de dados, centavos, zero versus ausência de amostra, virada de ano e navegação da OS. Compilação de produção aprovada. Revisão no Chrome: filtro de equipamento reduziu os ativos considerados de 17 para 1, retorno à lousa e à visão geral funcionou. Em largura de 390 px, a página e o painel mantiveram 390 px sem estouro horizontal; viewport restaurado. A conexão de controle do Chrome foi interrompida no fim da revisão, após essas verificações; o gráfico mensal final foi conferido por testes e compilação.

Não houve alteração de backend ou migração nesta etapa. Não houve commit/push automático.
