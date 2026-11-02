# Etapa 3 — preparação de acesso ao iPhone — 01/11/2026

Status: acesso temporário preparado e verificado no computador; testes físicos no iPhone ainda pendentes.

Usuário autorizou explicitamente a configuração após conferir o IP do aparelho. PC 192.168.18.66, iPhone 192.168.18.3, interface Wi-Fi 2, rede Privada.

HTTPS do portal: https://192.168.18.66:5443/. Página de download do certificado público: http://192.168.18.66:5444/. A porta HTTP não serve login, API ou chave privada. A regra de firewall VORQIX-HML-iPhone-20261101 foi confirmada como limitada ao IP do iPhone, IP do PC, portas TCP 5443/5444, interface Wi-Fi 2, perfil Privado e executável Node deste workspace. O gateway também restringe endereços de origem e encaminha chamadas autenticadas somente à API de homologação em loopback 3334, no tenant de homologação.

Não houve túnel público, configuração do roteador ou exposição de PostgreSQL. PostgreSQL 5432 e API 3334 permaneceram em 127.0.0.1. Não foi instalada confiança no Windows.

Foi gerado certificado temporário para o teste. A chave privada da autoridade não foi exportada ou salva; somente o certificado público e o certificado/chave do servidor em PFX criptografado foram gravados. A senha do PFX está protegida por DPAPI. O certificado do servidor vence em 02/11/2026 às 19:59:55 UTC. A instalação/confiança do certificado no iPhone será feita manualmente pelo usuário e ainda não ocorreu.

O gateway encerra suas conexões de escuta após no máximo quatro horas por execução ou antes se o certificado vencer. A regra de firewall não é removida automaticamente; ao terminar, execute Encerrar-teste-iPhone-VORQIX.ps1 e confirme sua remoção. Remova também o certificado do teste no iPhone. O script de encerramento verifica o PID e a linha de comando antes de parar exclusivamente o gateway.

A câmera usava somente BarcodeDetector, indisponível em alguns navegadores. Foi acrescentada alternativa com @zxing/browser 0.2.1, carregada sob demanda, mantendo captura local, consulta manual e liberação das trilhas da câmera ao sair. Os três testes passaram: leitor nativo; decodificação de QR gerado sem API nativa; quadro vazio/API nativa sem QR. TypeScript e build isolado do portal aprovados. Isso não aprova a câmera física do iPhone, que ainda deve ser testada.

Validações do gateway: TLS verificado usando a CA explícita, sem ignorar a verificação; portal acessível; API saudável; login do operador por HTTPS; porta HTTP limitada ao certificado; tentativa de leitura fora da pasta pública recusada. Senhas e tokens não foram exibidos.

Arquivos privados em work/mobile/private não devem ser compartilhados. O arquivo vorqix-teste.cer é público e serve somente ao certificado desta homologação. Os artefatos mobile e a regra de firewall são locais e não tornam o pacote de fonte um instalador portátil.

Próxima ação acompanhada: no Safari do iPhone, abrir http://192.168.18.66:5444/ e enviar a tela antes da instalação do certificado. Não avançar a impressão.
