# Contrato do operador

A versão inicial deve preservar compatibilidade com o contrato 1.1.2.

## Resultado operacional da finalização — Operador 8.8

O endpoint `operador.finalizar_acao` aceita o resultado operacional selecionado na revisão final:

```json
{
  "acao_id": "ACT-...",
  "resultado": "OK | NOK",
  "resultado_operacional": "CONFORME | DIFERENCAS_JUSTIFICADAS | PARCIAL | NAO_EXECUTADO | OUTRO",
  "observacao": "Resumo e justificativas da execução.",
  "duracao_segundos": 600
}
```

Regras:

- `CONFORME`: exige checklist completo, evidências obrigatórias atendidas e ausência de bloqueio técnico.
- `DIFERENCAS_JUSTIFICADAS`: exige itens e evidências obrigatórios concluídos; itens não conformes, NOK e N/A precisam de justificativa técnica.
- `PARCIAL`, `NAO_EXECUTADO` e `OUTRO`: permitem pendências documentadas, mas exigem observação final com pelo menos cinco caracteres.
- Resultados diferentes de `CONFORME` permanecem tecnicamente como `NOK`.
- As conclusões do novo contrato seguem para `AGUARDANDO_VALIDACAO`.
- O resultado operacional é preservado na observação da execução sem criar coluna ou aba na planilha.
- Clientes antigos sem `resultado_operacional` mantêm a regra anterior.
