# Validações locais — 01/11/2026

Situação: candidato ao aceite operacional local; não representa homologação global nem liberação de produção.

## Verificado
- Fluxos de OS corretiva, preventiva, externa, consumo de estoque e lubrificação exercitados na homologação. Cenários de devolução, falta de peça, transferência e dupla assinatura registrados nos relatórios locais.
- iPhone/Safari: login, navegação, abertura de câmera e leitura real do QR EQ-ENV-01 confirmados por capturas do usuário.
- Relatório PCM: PDF real em duas páginas A4 paisagem conferido visualmente. Códigos, técnicos, datas e valores sem cortes. Cabeçalhos/rodapés automáticos do Chrome desabilitados na versão final.
- Última rodada: gestor 44, QR 3, contratos de autenticação/inicialização 2 e API 24 testes aprovados; zero falhas. Os 17 testes de API dependentes de banco foram ignorados nessa rodada. A rodada integrada anterior teve 41 testes de API aprovados; não foi repetida integralmente.
- TypeScript e builds de API e dos dois frontends aprovados.
- Backup local restaurado em banco novo e comparado à origem: 9 usuários, 13 ordens, 7 execuções, 13 evidências/arquivos, 4 ocorrências e 16 assinaturas. Banco original preservado.

## Pendente
- Capturar, enviar e reabrir uma foto real no iPhone, adiado pelo usuário até retornar para casa.
- Decisões formais de aceite dos responsáveis.
- Impressão em papel não testada; saída PDF validada.
- Servidor, domínio e implantação de produção.

Credenciais, backups, certificados privados, banco de dados e sessões não integram esta publicação. O pacote local é fonte, não instalador portátil. As correções e os registros são publicados na branch de homologação para revisão; não houve merge na main.
