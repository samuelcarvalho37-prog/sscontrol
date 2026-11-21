# Preparação do teste no celular — TOZZI

Situação: preparação técnica concluída em loopback. Liberação para a rede aguarda confirmação da mesma rede Wi-Fi e IPv4 atual do celular. Nenhum teste físico foi marcado como aprovado.

Notebook: 192.168.18.66, rede privada SAMUEL, Wi-Fi 2. API e PostgreSQL saudáveis. Portais 5183–5186 ativos apenas em loopback. Frontend compartilhado compilado separadamente, com transporte relativo `/api`, sem apontar o celular para localhost. Gateway HTTPS fixa o tenant `tozzi-alimentos` e encaminha a API internamente; banco e API não são expostos diretamente na rede.

Novo certificado de teste: VORQIX TOZZI teste iPhone 20261120. Servidor válido até 21/11/2026 às 19:57:55 (São Paulo); autoridade até 22/11/2026 às 19:57:55. Nenhuma confiança adicionada ao Windows. Instalação e confiança no iPhone dependem de ação do usuário. O certificado anterior de novembro já expirou.

Conferência local com validação TLS usando a CA pública: `/` 200; `/api/health/ready` 200 e banco pronto; `/api/v1/bootstrap` 200; sessão não autenticada 401, conforme esperado. Nenhuma credencial de usuário foi testada por tentativa ou alterada.

Acesso planejado após liberação: certificado público em `http://192.168.18.66:5444/`; sistema em `https://192.168.18.66:5443/?tenant=tozzi-alimentos`. Gateway limitado ao IP informado, notebook e loopback, com encerramento automático em até quatro horas. Regra de firewall específica para as duas portas e o executável Node. Há scripts separados de início e encerramento na pasta outputs do ambiente de preparação.

## Roteiro físico pendente

1. Instalar e confiar no certificado novo no iPhone, por ação do usuário.
2. Abrir o sistema no Safari e entrar como PCM-01 com sua senha atual. Confirmar TOZZI ALIMENTOS, painel real e ausência de OS.
3. Sair, entrar novamente e conferir mensagem/validade da sessão.
4. Repetir login e navegação de leitura em PROD-01, MECANICO-01, ELETROMECANICO-01, QUALIDADE-01 e SEGURANCA-01, usando as respectivas senhas atuais. Conferir as diferenças de função e os botões de validação nas áreas habilitadas.
5. Testar câmera e leitura de QR de equipamento existente, sem registrar ocorrência, parada ou OS.
6. Conferir layout, teclado, orientação e rolagem no telefone/tablet, incluindo o novo PCM.
7. Conferir perda/retorno da rede e mensagem de indisponibilidade, sem repetir senhas incorretas.
8. Captura, envio e reabertura de foto vinculada à execução ficam pendentes de uma OS de teste expressamente autorizada. Não há OS criada para esse fim nesta etapa.

O centro de comando TI mantém largura mínima de 901 px; sua interface completa exige notebook ou tablet com largura adequada. O teste físico do telefone começa pelos perfis operacionais e PCM.

Ao concluir, encerrar o gateway, remover somente a regra temporária desta sessão e remover no iPhone o certificado de teste. Não remover outros certificados ou regras.
