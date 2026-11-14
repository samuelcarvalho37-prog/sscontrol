# Melhorias da entrega local — 14/11/2026

## Implementado e verificado

- Áreas do gestor carregadas sob demanda, com mensagem de carregamento e recuperação manual de falhas. JavaScript inicial: 1.668.142 → 335.356 bytes; gzip: 422.438 → 100.644 bytes. Os módulos adiados ainda incluem arquivos grandes; a mudança reduz a carga inicial, não todo o código entregue.
- Tradução de eventos conhecidos e documentos operacionais no histórico e na validação. Eventos desconhecidos preservam a apresentação anterior.
- Inicialização local com espera de prontidão, proteção contra partidas simultâneas e preservação dos processos existentes. Banco, API e quatro interfaces verificados.
- Atalho reversível na pasta Inicializar do usuário atual. Executado com o PowerShell instalado que permite os scripts; nenhuma política de execução foi alterada. Inicia ao entrar no Windows, não antes do login.
- Backup diário quando o ambiente é iniciado, sem exclusão automática. Snapshot consistente do PostgreSQL, cópia das evidências, manifesto SHA-256 e marcador de conclusão.
- Restauração verificada em banco novo isolado: contagens de oito tabelas conferidas e 13 arquivos de evidência íntegros. O banco de origem não é substituído.
- Diagnóstico inclui prontidão das interfaces/API, backup com até 36 horas e verificação de restauração com até sete dias.

## Operação

Execute no PowerShell autorizado do ambiente, passando a pasta que contém `work/homologacao/runtime-environment.xml` como `EnvironmentRoot`:

```powershell
& ./tools/windows/Start-VorqixLocal.ps1 -EnvironmentRoot '<pasta-do-ambiente>'
& ./tools/windows/Test-VorqixLocal.ps1 -EnvironmentRoot '<pasta-do-ambiente>'
& ./tools/windows/Backup-VorqixLocal.ps1 -EnvironmentRoot '<pasta-do-ambiente>' -VerifyRestore
```

Os comandos usam credenciais locais protegidas pelo Windows. Não coloque essas credenciais no Git. Os backups contêm dados e devem permanecer em local protegido. O início automático depende dos caminhos locais atuais; reconfigure o atalho se mover o ambiente. Para desativá-lo, remova apenas `VORQIX Homologacao.lnk` da pasta Inicializar do usuário.

Esta entrega mantém o acesso em loopback e o runtime local de homologação. Não configura hospedagem pública, domínio nem serviço de produção.

## Aceites restantes

1. No iPhone/tablet, conferir leitura real de QR, fotografia, envio e abertura da evidência na OS. A câmera e a consulta já foram demonstradas anteriormente, mas isso não substitui o aceite completo de anexos.
2. Após mudanças de rede, preparar novamente o endereço HTTPS apropriado antes do teste móvel.
3. Executar um piloto acompanhado com operadores reais: solicitar, avaliar no PCM, executar, consumir material e colher as assinaturas exigidas. Registrar resultado, responsável e divergências.
4. Conferir visualmente as áreas carregadas sob demanda na sessão do usuário, inclusive temas e navegação móvel.
5. Definir servidor/domínio e validar implantação, recuperação e monitoramento antes da produção.

Os testes automáticos e o backup verificado não equivalem à homologação formal do processo real.
