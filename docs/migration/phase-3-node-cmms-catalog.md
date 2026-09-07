# Fase 3 — Catálogo CMMS e parâmetros técnicos

Status: bloco 3.2 concluído tecnicamente

Data: 29/07/2026

## Escopo concluído

O backend Node.js passou a fornecer, em paralelo ao sistema atual:

- autorização por capacidade;
- plantas, setores e linhas;
- ativos com TAG e QR Code canônico;
- componentes vinculados;
- materiais e estoque mínimo;
- parâmetros de ativo ou componente;
- políticas versionadas de limites;
- leituras idempotentes;
- classificação automática de leituras;
- alerta operacional para condição anormal;
- ficha integral do ativo;
- histórico técnico e auditoria.

Não existe rota de exclusão física. Plantas, setores, linhas, ativos, componentes, materiais e parâmetros são inativados ou arquivados. Recursos pais ativos não podem ser desativados enquanto mantiverem filhos ativos.

## Contratos de segurança

As capacidades são separadas por finalidade:

- `cmms.structure.read`;
- `cmms.structure.manage`;
- `cmms.assets.read`;
- `cmms.assets.manage`;
- `cmms.materials.read`;
- `cmms.materials.manage`;
- `cmms.parameters.read`;
- `cmms.parameters.manage`;
- `cmms.readings.create`.

Cada requisição:

1. autentica o token opaco;
2. calcula as capacidades efetivas;
3. abre transação;
4. define tenant e usuário para RLS;
5. executa a regra de negócio;
6. registra auditoria quando altera estado;
7. confirma ou desfaz integralmente.

## Regras técnicas implementadas

- componente deve pertencer ao ativo informado;
- parâmetro de componente deve usar o mesmo ativo do componente;
- unidade e tipo de uma leitura devem corresponder à definição;
- uma política só pode classificar o próprio parâmetro;
- limites respeitam a ordem crítico mínimo, alerta mínimo, alerta máximo e crítico máximo;
- leitura aceita apenas o campo compatível com seu tipo;
- `chave_idempotencia` impede duplicidade por repetição de rede;
- leitura persistida é imutável;
- política publicada recebe versão e hash SHA-256;
- leitura crítica ou de alerta abre ou atualiza um alerta operacional deduplicado;
- ficha do ativo agrega componentes, parâmetros, última leitura, limites, alertas e histórico;
- materiais informam automaticamente quando o estoque está igual ou abaixo do mínimo;
- TAG e QR Code resolvem o mesmo ativo.

## Massa de homologação

A massa não depende das planilhas existentes. Ela foi criada para testar comportamentos controlados e será ampliada nos próximos blocos.

| Grupo             | Cenários                                                   |
| ----------------- | ---------------------------------------------------------- |
| Identidades       | Administrador, Qualidade, Segurança, Manutenção e Operador |
| Assinatura futura | Qualidade e Segurança marcados como cargos autorizados     |
| Estrutura         | uma planta, dois setores e duas linhas                     |
| Ativos            | operando, parado, manutenção programada e inspeção         |
| Componentes       | rolamentos e filtro de compressor                          |
| Materiais         | estoque normal e estoque abaixo do mínimo                  |
| Parâmetros        | temperatura, vibração, pressão e confirmação booleana      |
| Leituras          | normal, alerta, crítica e confirmação de checklist         |
| Alertas           | vibração crítica com deduplicação                          |

O seed:

- recusa ambiente de produção;
- exige senhas externas;
- usa Argon2id;
- não grava senhas no repositório;
- usa IDs estáveis;
- pode ser executado repetidamente;
- preserva relações entre todos os registros.

## Validação executada

Ambiente:

- Node.js 24 LTS;
- PostgreSQL 18.4;
- banco isolado `fab_control_node_test_20260729_174643`;
- migrações `0001` a `0009`;
- usuário de runtime sem `SUPERUSER`, `CREATEDB`, `CREATEROLE` ou `BYPASSRLS`.

Resultado:

```text
8 testes
8 aprovados
0 falhas
2 execuções idênticas do seed aprovadas
```

O fluxo integrado comprovou criação, consulta e alteração de estrutura, ativo, componente, material, parâmetro, política e leitura; classificação normal e crítica; alerta; QR Code; paginação; auditoria; idempotência; e negação por ausência de capacidade.

## Limite do bloco

Apps Script, planilhas, frontends e dados atuais permanecem intactos. O Node.js ainda não é a fonte operacional. A massa cobre integralmente o bloco 3.2 e será estendida com checklists, planos, intervenções, validações, assinaturas e execução nos próximos blocos.
