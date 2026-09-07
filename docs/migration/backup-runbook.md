# Roteiro de backup pré-migração

Objetivo: criar uma cópia verificável e restaurável de todo o sistema antes de qualquer construção do backend Node.js.

## Regra operacional

- Não apagar arquivos.
- Não renomear abas.
- Não alterar cabeçalhos.
- Não executar schema upgrade em produção durante o backup.
- Não trocar a planilha configurada no Apps Script.
- Não publicar uma nova versão de produção.
- Não copiar secrets para o repositório ou para o chat.

## Estrutura local recomendada

Criar fora da pasta sincronizada de trabalho e em uma segunda mídia:

```text
FAB-CONTROL-BACKUP-AAAA-MM-DD-HHMM/
  01-planilhas/
    producao/
    canario/
  02-apps-script/
    producao/
    canario/
  03-frontends/
  04-drive/
    evidencias/
    documentos/
    backups/
  05-configuracao/
  06-manifestos/
  07-validacao/
```

Recomendação: manter uma cópia em disco local e outra em armazenamento externo com criptografia.

## 1. Registrar o estado antes do backup

Preencher um manifesto simples:

- data e hora;
- responsável;
- fuso `America/Sao_Paulo`;
- release de produção;
- release de canário;
- ID da planilha de produção;
- ID da planilha de canário;
- ID do projeto Apps Script de produção;
- ID do projeto Apps Script de canário;
- IDs das implantações;
- versões imutáveis;
- commit Git atual;
- branch atual;
- observação sobre usuários ativos.

Não registrar senhas, peppers, tokens ou segredos no manifesto comum.

## 2. Backup manual das planilhas

Executar para produção e canário separadamente.

### 2.1 Cópia nativa no Google Drive

1. Abra a planilha.
2. Acesse `Arquivo > Fazer uma cópia`.
3. Nomeie como `FAB Control - SNAPSHOT - AMBIENTE - AAAA-MM-DD-HHMM`.
4. Salve em pasta de backup privada.
5. Não compartilhe publicamente.
6. Copie o link e o ID para o manifesto.

Essa cópia preserva melhor fórmulas e estrutura do Google Sheets.

### 2.2 Exportação XLSX

1. Acesse `Arquivo > Fazer download > Microsoft Excel (.xlsx)`.
2. Salve na pasta do ambiente correspondente.
3. Não abra e salve novamente antes de calcular o hash.

### 2.3 Exportação CSV por aba

O download CSV do Google Sheets exporta apenas a aba atual. Para cada uma das 48 abas existentes:

1. selecione a aba;
2. acesse `Arquivo > Fazer download > Valores separados por vírgula (.csv)`;
3. nomeie o arquivo com número e nome da aba;
4. registre abas ausentes no manifesto, sem criá-las na planilha original.

O CSV facilita reconciliação linha a linha e evita depender apenas do XLSX.

### 2.4 PDF opcional de conferência

Para abas críticas e relatórios visuais, exporte PDF somente como evidência visual. PDF não substitui XLSX ou CSV.

## 3. Inventário da planilha

Para cada aba, registrar:

- nome exato;
- quantidade de colunas;
- cabeçalhos na ordem;
- quantidade de linhas preenchidas;
- quantidade de IDs vazios;
- quantidade de IDs duplicados;
- primeira e última data;
- fórmulas existentes;
- filtros, proteções e validações de dados;
- observações sobre células mescladas ou tipos mistos.

Gerar também:

- lista de vínculos órfãos;
- lista de JSON inválido;
- lista de datas inválidas;
- lista de status não reconhecidos;
- lista de arquivos do Drive não encontrados.

Essa coleta será automatizada somente após aprovação, em modo de leitura.

## 4. Backup do Apps Script

Executar para os dois projetos.

### 4.1 Pelo editor do Apps Script

1. Abra o projeto.
2. Acesse `Configurações do projeto`.
3. Registre o ID do script.
4. Registre fuso, runtime e serviços.
5. Acesse `Implantações > Gerenciar implantações`.
6. Registre ID, versão, descrição, data, responsável, execução como e nível de acesso.
7. Registre as versões imutáveis existentes.

### 4.2 Código local

O repositório já contém uma cópia dos arquivos em `backend/apps-script`. Antes da migração:

1. sincronizar cada projeto para uma pasta exclusiva;
2. não sincronizar produção dentro da pasta de canário;
3. copiar `appsscript.json`;
4. copiar os arquivos `.js`;
5. copiar os arquivos de configuração do `clasp` para a área protegida;
6. compactar as pastas;
7. calcular hashes.

Os arquivos `.clasp.json` contêm IDs de projeto e devem ser tratados como configuração de ambiente.

## 5. Backup das Script Properties

As Script Properties não são exportadas junto com o código.

1. Abra `Configurações do projeto > Propriedades do script`.
2. Registre a lista de nomes de propriedades.
3. Exporte os valores para um cofre criptografado separado.
4. Não inclua valores no Git.
5. Não inclua valores em screenshots compartilhados.
6. Confirme que cada secret possui proprietário e finalidade.

Separar:

- configuração não secreta;
- IDs de recursos;
- credenciais;
- peppers;
- segredos de assinatura;
- estado comercial assinado;
- propriedades transitórias, que não precisam ser restauradas como sessão ativa.

## 6. Backup do Google Drive

### 6.1 Evidências

1. Localize a pasta indicada por `FAB_CONTROL_EVIDENCE_FOLDER_ID`.
2. Faça download da pasta.
3. Registre ID, nome, tipo MIME, tamanho e data dos arquivos.
4. Relacione cada `evidencias.arquivo_id` ao arquivo baixado.

### 6.2 Documentos técnicos

1. Localize `FAB_DOCUMENTS_FOLDER_ID`.
2. Faça download.
3. Relacione `documentos_tecnicos.arquivo_id` e `documento_revisoes.arquivo_id`.
4. Preserve todas as revisões.

### 6.3 Backups gerenciados

1. Localize `FAB_BACKUP_FOLDER_ID`.
2. Registre as cópias existentes.
3. Faça download das cópias relevantes.
4. Não use uma cópia antiga como única fonte da migração.

## 7. Backup dos frontends

Copiar integralmente:

- `frontend`;
- `frontend-gestor`;
- arquivos do Operador;
- mockups;
- assets;
- `.env.example`;
- manifestos de release;
- scripts de build e validação.

Não copiar arquivos `.env` com segredos para o Git ou para compartilhamento aberto.

## 8. Backup Git

O repositório já está ativo. Antes da Fase 3:

1. confirmar que o diretório de trabalho está limpo;
2. criar commit da documentação aprovada;
3. publicar a branch;
4. registrar o commit no manifesto;
5. gerar também um bundle ou arquivo compactado do repositório;
6. guardar fora da máquina.

Git protege código e documentação, mas não substitui backup de planilhas, Drive, propriedades e implantações.

## 9. Hashes

Calcular SHA-256 para:

- XLSX;
- todos os CSV;
- ZIP do Apps Script;
- ZIP dos frontends;
- arquivos de evidência;
- documentos técnicos;
- bundle Git;
- manifestos.

Guardar um arquivo `SHA256SUMS.txt` na pasta `07-validacao`.

Depois de copiar para a segunda mídia, recalcular e comparar.

## 10. Teste de restauração

O backup só é válido depois de um teste.

1. Criar uma nova planilha isolada.
2. Importar o XLSX ou os CSV.
3. Criar um novo projeto Apps Script isolado.
4. Restaurar o código.
5. Configurar novas propriedades próprias do teste.
6. Apontar somente para a planilha de restauração.
7. Nunca usar os IDs de produção no teste.
8. Validar bootstrap, login e leitura das entidades.
9. Validar acesso a uma amostra de evidências e documentos.
10. Registrar resultado, responsável e data.

## 11. Checklist de aprovação do backup

- [ ] Cópia nativa da produção criada.
- [ ] Cópia nativa do canário criada.
- [ ] XLSX de produção salvo.
- [ ] XLSX de canário salvo.
- [ ] CSV das abas salvo.
- [ ] Código Apps Script de produção salvo.
- [ ] Código Apps Script de canário salvo.
- [ ] Implantações e versões registradas.
- [ ] Propriedades guardadas em cofre.
- [ ] Evidências baixadas e reconciliadas.
- [ ] Documentos e revisões baixados.
- [ ] Frontends copiados.
- [ ] Git publicado e bundle externo criado.
- [ ] Hashes conferidos.
- [ ] Restauração isolada testada.
- [ ] Manifesto assinado pelo responsável.

## 12. Condição para avançar

A Fase 2 pode modelar o destino após a aprovação do Blueprint. A Fase 4 não poderá ler ou migrar dados reais até que este checklist de backup esteja concluído.
