# Importação sem teto fixo de linhas

Removido o bloqueio de 250 registros no TI, PCM, API Node e implementação legada Apps Script. O catálogo retorna `max_linhas: null`. As validações de conteúdo, referências, duplicidade, assinatura do lote, auditoria e reversão continuam ativas.

As operações de escrita da importação aguardam a resposta sem prazo automático do cliente (`timeoutMs: 0`). Os demais clientes mantêm seus prazos. O arquivo continua limitado a 8 MB; o corpo JSON das rotas de validação admite 64 MiB para acomodar a expansão do XLSX. Isso não representa capacidade infinita de memória.

A interface exibe tempo decorrido. Na importação mestre, o tempo restante é aproximado a partir das linhas das abas já concluídas; antes da primeira conclusão, a estimativa fica indisponível. O processamento continua síncrono: manter a página aberta. O histórico recebe o lote após a validação, sem percentual fictício por linha durante uma requisição.

Validação: XLSX com 1.201 componentes lido integralmente; teste integrado com planta, setor, linha e equipamento, validação e confirmação de 1.201 componentes, seguida de reversão integral. Executado em banco isolado, sem gravar dados de teste na TOZZI. Passaram também as verificações de tipos da API/frontend, compilação de produção de ambos e diff. API local reiniciada; health ready confirmou banco disponível. Na sessão aberta, a aba Componentes reconheceu 361 linhas sem o bloqueio anterior.

Não requer migração. Não houve publicação no GitHub nesta etapa.
