/**
 * FAB Control — Fase 10.7
 * Catálogo técnico de checklist dinâmico
 * Versão: 1.0.7-cmms-catalogo-checklist
 *
 * Objetivo:
 * - Padronizar tipos de item de checklist.
 * - Validar cadastro técnico antes de ir para aprovação da gestão.
 * - Proteger modelo VALIDADO/OBSOLETO contra edição direta.
 * - Expor helpers para o operador validar respostas por tipo.
 *
 * Como ligar no roteador:
 * - Inserir o bloco de rota do arquivo 03_Http_Auth_PATCH_1.0.7.txt no switch/dispatcher principal.
 */

const CMMS107_VERSION = '1.0.7-cmms-catalogo-checklist';

const CMMS107_SHEETS = {
  PLANOS: 'planos_manutencao',
  PLANO_ITENS: 'plano_itens',
  TIPOS: 'checklist_tipos_item',
  REGRAS: 'checklist_validacao_regras',
  AUDITORIA: 'modelo_checklist_auditoria',
  CHECKLIST_EXECUCAO: 'checklist_execucao',
  EVIDENCIAS: 'evidencias'
};

const CMMS107_ITEM_HEADERS = [
  'id', 'plano_id', 'ordem', 'titulo', 'instrucao', 'tipo_resposta',
  'obrigatorio', 'evidencia_obrigatoria', 'foto_referencia_url',
  'limite_min', 'limite_max', 'unidade', 'criado_em', 'atualizado_em',
  'parametro_nome', 'valor_esperado', 'opcoes_json', 'bloqueia_finalizacao',
  'categoria', 'peso', 'status', 'validacao_regra', 'evidencia_min_fotos'
];

const CMMS107_TIPO_HEADERS = [
  'id', 'tipo', 'nome', 'descricao', 'requer_resposta', 'requer_valor',
  'requer_opcoes', 'suporta_limite', 'suporta_evidencia', 'categoria_padrao',
  'ativo', 'criado_em'
];

const CMMS107_REGRA_HEADERS = [
  'id', 'tipo_item', 'codigo', 'nome', 'descricao', 'regra_json', 'ativo', 'criado_em'
];

const CMMS107_AUDIT_HEADERS = [
  'id', 'plano_id', 'item_id', 'evento', 'antes_json', 'depois_json',
  'usuario_id', 'perfil', 'criado_em'
];

const CMMS107_ITEM_TYPES = [
  {
    tipo: 'CONFIRMACAO',
    nome: 'Confirmação simples',
    descricao: 'Item de confirmação operacional simples. Aceita SIM/NAO ou OK.',
    requer_resposta: 'SIM', requer_valor: 'NAO', requer_opcoes: 'NAO',
    suporta_limite: 'NAO', suporta_evidencia: 'SIM', categoria_padrao: 'OPERACIONAL'
  },
  {
    tipo: 'OK_NOK',
    nome: 'OK / NOK',
    descricao: 'Item binário técnico ou operacional com resposta OK, NOK ou NA.',
    requer_resposta: 'SIM', requer_valor: 'NAO', requer_opcoes: 'NAO',
    suporta_limite: 'NAO', suporta_evidencia: 'SIM', categoria_padrao: 'OPERACIONAL'
  },
  {
    tipo: 'NUMERO',
    nome: 'Número medido',
    descricao: 'Medição numérica com limite mínimo/máximo opcional.',
    requer_resposta: 'SIM', requer_valor: 'SIM', requer_opcoes: 'NAO',
    suporta_limite: 'SIM', suporta_evidencia: 'SIM', categoria_padrao: 'PARAMETRO'
  },
  {
    tipo: 'PARAMETRO',
    nome: 'Parâmetro técnico',
    descricao: 'Registro de parâmetro técnico com nome, unidade e faixa esperada.',
    requer_resposta: 'SIM', requer_valor: 'SIM', requer_opcoes: 'NAO',
    suporta_limite: 'SIM', suporta_evidencia: 'SIM', categoria_padrao: 'TECNICO'
  },
  {
    tipo: 'TEXTO',
    nome: 'Texto / observação',
    descricao: 'Campo livre para descrição, justificativa ou observação operacional.',
    requer_resposta: 'SIM', requer_valor: 'NAO', requer_opcoes: 'NAO',
    suporta_limite: 'NAO', suporta_evidencia: 'SIM', categoria_padrao: 'OPERACIONAL'
  },
  {
    tipo: 'SELECAO',
    nome: 'Seleção',
    descricao: 'Escolha entre opções cadastradas pelo administrador.',
    requer_resposta: 'SIM', requer_valor: 'NAO', requer_opcoes: 'SIM',
    suporta_limite: 'NAO', suporta_evidencia: 'SIM', categoria_padrao: 'OPERACIONAL'
  },
  {
    tipo: 'EVIDENCIA',
    nome: 'Evidência obrigatória',
    descricao: 'Item para anexar foto/documento. Bloqueia finalização sem evidência.',
    requer_resposta: 'NAO', requer_valor: 'NAO', requer_opcoes: 'NAO',
    suporta_limite: 'NAO', suporta_evidencia: 'SIM', categoria_padrao: 'TECNICO'
  },
  {
    tipo: 'LEITURA_OPERACIONAL',
    nome: 'Leitura operacional',
    descricao: 'Leitura de campo operacional, como horímetro, pressão, temperatura, rotação ou corrente.',
    requer_resposta: 'SIM', requer_valor: 'SIM', requer_opcoes: 'NAO',
    suporta_limite: 'SIM', suporta_evidencia: 'SIM', categoria_padrao: 'OPERACIONAL'
  }
];

/**
 * Dispatcher opcional. Retorna null quando a action não pertence à 1.0.7.
 * Use no roteador principal antes do default/erro de action inválida.
 */
function cmms107_dispatch_(action, payload, usuario) {
  const a = String(action || '').trim();
  const p = payload || {};
  if (a === 'admin.listar_tipos_item_checklist' || a === 'catalogo.checklist_tipos') return adminListarTiposItemChecklist107_(p, usuario);
  if (a === 'admin.listar_regras_checklist') return adminListarRegrasChecklist107_(p, usuario);
  if (a === 'admin.validar_catalogo_item_checklist') return adminValidarCatalogoItemChecklist107_(p, usuario);
  if (a === 'admin.salvar_item_modelo_checklist') return adminSalvarItemModeloChecklist107_(p, usuario);
  if (a === 'admin.remover_item_modelo_checklist') return adminRemoverItemModeloChecklist107_(p, usuario);
  if (a === 'admin.reordenar_itens_modelo_checklist') return adminReordenarItensModeloChecklist107_(p, usuario);
  if (a === 'admin.clonar_item_modelo_checklist') return adminClonarItemModeloChecklist107_(p, usuario);
  if (a === 'admin.listar_itens_modelo_checklist') return adminListarItensModeloChecklist107_(p, usuario);
  if (a === 'admin.detalhar_modelo_checklist_catalogo') return adminDetalharModeloChecklistCatalogo107_(p, usuario);
  if (a === 'operador.validar_resposta_checklist_item') return operadorValidarRespostaChecklistItem107_(p, usuario);
  if (a === 'cmms.catalogo_checklist_schema_upgrade') return cmmsCatalogoChecklistSchemaUpgrade107_(p, usuario);
  return null;
}

function cmmsCatalogoChecklistSchemaUpgrade107_(payload, usuario) {
  CMMS107_requirePerfil_(usuario, ['ADMIN']);
  const ss = CMMS107_ss_();
  CMMS107_ensureSheet_(ss, CMMS107_SHEETS.PLANO_ITENS, CMMS107_ITEM_HEADERS);
  CMMS107_ensureSheet_(ss, CMMS107_SHEETS.TIPOS, CMMS107_TIPO_HEADERS);
  CMMS107_ensureSheet_(ss, CMMS107_SHEETS.REGRAS, CMMS107_REGRA_HEADERS);
  CMMS107_ensureSheet_(ss, CMMS107_SHEETS.AUDITORIA, CMMS107_AUDIT_HEADERS);
  CMMS107_seedCatalogo_();
  return {
    upgraded: true,
    version: CMMS107_VERSION,
    sheets: Object.keys(CMMS107_SHEETS).length,
    tipos: CMMS107_ITEM_TYPES.length
  };
}

function adminListarTiposItemChecklist107_(payload, usuario) {
  CMMS107_requirePerfil_(usuario, ['ADMIN', 'GESTOR']);
  CMMS107_seedCatalogo_();
  const rows = CMMS107_readObjects_(CMMS107_SHEETS.TIPOS)
    .filter(r => CMMS107_boolSim_(r.ativo));
  return {
    total: rows.length,
    tipos: rows.map(r => ({
      tipo: r.tipo,
      nome: r.nome,
      descricao: r.descricao,
      requer_resposta: r.requer_resposta,
      requer_valor: r.requer_valor,
      requer_opcoes: r.requer_opcoes,
      suporta_limite: r.suporta_limite,
      suporta_evidencia: r.suporta_evidencia,
      categoria_padrao: r.categoria_padrao
    }))
  };
}

function adminListarRegrasChecklist107_(payload, usuario) {
  CMMS107_requirePerfil_(usuario, ['ADMIN', 'GESTOR']);
  CMMS107_seedCatalogo_();
  const tipo = String((payload || {}).tipo_resposta || (payload || {}).tipo || '').trim().toUpperCase();
  let regras = CMMS107_readObjects_(CMMS107_SHEETS.REGRAS).filter(r => CMMS107_boolSim_(r.ativo));
  if (tipo) regras = regras.filter(r => String(r.tipo_item || '').toUpperCase() === tipo);
  return { total: regras.length, regras: regras };
}

function adminValidarCatalogoItemChecklist107_(payload, usuario) {
  CMMS107_requirePerfil_(usuario, ['ADMIN', 'GESTOR']);
  const item = CMMS107_normalizarItemInput_(payload || {}, null);
  const resultado = CMMS107_validarItemModelo_(item);
  return {
    valido: resultado.valido,
    bloqueante: resultado.bloqueante,
    mensagens: resultado.mensagens,
    item_normalizado: item
  };
}

function adminSalvarItemModeloChecklist107_(payload, usuario) {
  CMMS107_requirePerfil_(usuario, ['ADMIN']);
  const planoId = CMMS107_required_(payload.plano_id, 'plano_id');
  const plano = CMMS107_getById_(CMMS107_SHEETS.PLANOS, planoId);
  if (!plano) CMMS107_throw_('NOT_FOUND', 'Plano/modelo não encontrado: ' + planoId);
  CMMS107_assertModeloEditavel_(plano);

  const itemId = String(payload.item_id || payload.id || '').trim();
  const existing = itemId ? CMMS107_getById_(CMMS107_SHEETS.PLANO_ITENS, itemId) : null;
  const item = CMMS107_normalizarItemInput_(payload, existing);
  item.plano_id = planoId;
  item.id = item.id || CMMS107_makeItemId_(planoId, item.ordem, item.titulo);

  const validacao = CMMS107_validarItemModelo_(item);
  if (!validacao.valido) CMMS107_throw_('INVALID_CHECKLIST_ITEM', validacao.mensagens.join('; '));

  const now = CMMS107_now_();
  item.atualizado_em = now;
  if (!item.criado_em) item.criado_em = now;

  const before = existing ? JSON.stringify(existing) : '';
  CMMS107_upsertObject_(CMMS107_SHEETS.PLANO_ITENS, item, 'id', CMMS107_ITEM_HEADERS);
  CMMS107_audit_(planoId, item.id, existing ? 'ITEM_MODELO_ATUALIZADO' : 'ITEM_MODELO_CRIADO', before, JSON.stringify(item), usuario);

  return {
    saved: true,
    plano_id: planoId,
    item_id: item.id,
    tipo_resposta: item.tipo_resposta,
    item: item,
    validacao: validacao
  };
}

function adminRemoverItemModeloChecklist107_(payload, usuario) {
  CMMS107_requirePerfil_(usuario, ['ADMIN']);
  const itemId = CMMS107_required_(payload.item_id || payload.id, 'item_id');
  const item = CMMS107_getById_(CMMS107_SHEETS.PLANO_ITENS, itemId);
  if (!item) CMMS107_throw_('NOT_FOUND', 'Item de checklist não encontrado: ' + itemId);
  const plano = CMMS107_getById_(CMMS107_SHEETS.PLANOS, item.plano_id);
  if (!plano) CMMS107_throw_('NOT_FOUND', 'Plano/modelo do item não encontrado: ' + item.plano_id);
  CMMS107_assertModeloEditavel_(plano);

  const before = JSON.stringify(item);
  item.status = 'INATIVO';
  item.atualizado_em = CMMS107_now_();
  CMMS107_upsertObject_(CMMS107_SHEETS.PLANO_ITENS, item, 'id', CMMS107_ITEM_HEADERS);
  CMMS107_audit_(item.plano_id, item.id, 'ITEM_MODELO_INATIVADO', before, JSON.stringify(item), usuario);
  return { removed: true, plano_id: item.plano_id, item_id: item.id, status: item.status };
}

function adminReordenarItensModeloChecklist107_(payload, usuario) {
  CMMS107_requirePerfil_(usuario, ['ADMIN']);
  const planoId = CMMS107_required_(payload.plano_id, 'plano_id');
  const plano = CMMS107_getById_(CMMS107_SHEETS.PLANOS, planoId);
  if (!plano) CMMS107_throw_('NOT_FOUND', 'Plano/modelo não encontrado: ' + planoId);
  CMMS107_assertModeloEditavel_(plano);

  const ordenacao = Array.isArray(payload.ordenacao) ? payload.ordenacao : [];
  if (!ordenacao.length) CMMS107_throw_('INVALID_PAYLOAD', 'Informe ordenacao: [{item_id, ordem}].');

  const itens = CMMS107_readObjects_(CMMS107_SHEETS.PLANO_ITENS).filter(i => String(i.plano_id) === planoId);
  const byId = {};
  itens.forEach(i => byId[i.id] = i);

  const alterados = [];
  ordenacao.forEach(o => {
    const id = String(o.item_id || o.id || '').trim();
    const ordem = Number(o.ordem);
    if (!id || !isFinite(ordem) || ordem <= 0) CMMS107_throw_('INVALID_ORDER', 'Cada item precisa ter item_id e ordem numérica positiva.');
    const item = byId[id];
    if (!item) CMMS107_throw_('NOT_FOUND', 'Item não pertence ao plano ou não existe: ' + id);
    const before = JSON.stringify(item);
    item.ordem = ordem;
    item.atualizado_em = CMMS107_now_();
    CMMS107_upsertObject_(CMMS107_SHEETS.PLANO_ITENS, item, 'id', CMMS107_ITEM_HEADERS);
    CMMS107_audit_(planoId, id, 'ITEM_MODELO_REORDENADO', before, JSON.stringify(item), usuario);
    alterados.push({ item_id: id, ordem: ordem });
  });

  return { reordered: true, plano_id: planoId, total: alterados.length, itens: alterados };
}

function adminClonarItemModeloChecklist107_(payload, usuario) {
  CMMS107_requirePerfil_(usuario, ['ADMIN']);
  const itemId = CMMS107_required_(payload.item_id || payload.id, 'item_id');
  const item = CMMS107_getById_(CMMS107_SHEETS.PLANO_ITENS, itemId);
  if (!item) CMMS107_throw_('NOT_FOUND', 'Item de checklist não encontrado: ' + itemId);
  const plano = CMMS107_getById_(CMMS107_SHEETS.PLANOS, item.plano_id);
  if (!plano) CMMS107_throw_('NOT_FOUND', 'Plano/modelo do item não encontrado: ' + item.plano_id);
  CMMS107_assertModeloEditavel_(plano);

  const itens = CMMS107_readObjects_(CMMS107_SHEETS.PLANO_ITENS)
    .filter(i => String(i.plano_id) === String(item.plano_id) && String(i.status || 'ATIVO') !== 'INATIVO');
  const nextOrder = itens.reduce((max, i) => Math.max(max, Number(i.ordem || 0)), 0) + 1;
  const cloned = Object.assign({}, item);
  cloned.id = CMMS107_makeItemId_(item.plano_id, nextOrder, String(item.titulo || 'item') + ' copia');
  cloned.ordem = nextOrder;
  cloned.titulo = String(payload.titulo || (item.titulo + ' — cópia')).trim();
  cloned.criado_em = CMMS107_now_();
  cloned.atualizado_em = cloned.criado_em;
  cloned.status = 'ATIVO';

  CMMS107_upsertObject_(CMMS107_SHEETS.PLANO_ITENS, cloned, 'id', CMMS107_ITEM_HEADERS);
  CMMS107_audit_(item.plano_id, cloned.id, 'ITEM_MODELO_CLONADO', JSON.stringify(item), JSON.stringify(cloned), usuario);
  return { cloned: true, plano_id: item.plano_id, origem_item_id: item.id, item_id: cloned.id, item: cloned };
}

function adminListarItensModeloChecklist107_(payload, usuario) {
  CMMS107_requirePerfil_(usuario, ['ADMIN', 'GESTOR']);
  const planoId = CMMS107_required_(payload.plano_id, 'plano_id');
  const itens = CMMS107_readObjects_(CMMS107_SHEETS.PLANO_ITENS)
    .filter(i => String(i.plano_id) === String(planoId) && String(i.status || 'ATIVO') !== 'INATIVO')
    .sort((a, b) => Number(a.ordem || 0) - Number(b.ordem || 0));
  return { plano_id: planoId, total: itens.length, itens: itens.map(CMMS107_enriquecerItem_) };
}

function adminDetalharModeloChecklistCatalogo107_(payload, usuario) {
  CMMS107_requirePerfil_(usuario, ['ADMIN', 'GESTOR']);
  const planoId = CMMS107_required_(payload.plano_id, 'plano_id');
  const plano = CMMS107_getById_(CMMS107_SHEETS.PLANOS, planoId);
  if (!plano) CMMS107_throw_('NOT_FOUND', 'Plano/modelo não encontrado: ' + planoId);
  const itens = adminListarItensModeloChecklist107_(payload, usuario).itens;
  const validacao = CMMS107_validarModeloCompleto_(plano, itens);
  return {
    plano: plano,
    itens_count: itens.length,
    itens: itens,
    validacao_modelo: validacao,
    pode_editar: CMMS107_modeloEditavel_(plano),
    pode_enviar_validacao: validacao.valido && CMMS107_modeloEditavel_(plano)
  };
}

function operadorValidarRespostaChecklistItem107_(payload, usuario) {
  CMMS107_requirePerfil_(usuario, ['OPERADOR', 'GESTOR', 'ADMIN']);
  const itemId = CMMS107_required_(payload.checklist_execucao_id || payload.item_id || payload.id, 'checklist_execucao_id');
  let item = CMMS107_getById_(CMMS107_SHEETS.CHECKLIST_EXECUCAO, itemId);
  if (!item) item = CMMS107_getById_(CMMS107_SHEETS.PLANO_ITENS, itemId);
  if (!item) CMMS107_throw_('NOT_FOUND', 'Item de checklist/execução não encontrado: ' + itemId);
  const result = CMMS107_validateRespostaChecklist_(item, payload || {});
  return Object.assign({ checklist_execucao_id: itemId }, result);
}

/**
 * Helper público para o arquivo 10_Checklist_Dinamico_Workflow.gs usar dentro de operador.salvar_checklist_item.
 * Entrada esperada: item do checklist_execucao/plano_itens + payload de resposta.
 */
function CMMS107_validateRespostaChecklist_(item, payload) {
  const tipo = String(item.tipo_resposta || payload.tipo_resposta || '').trim().toUpperCase();
  const obrigatorio = CMMS107_boolSim_(item.obrigatorio);
  const evidenciaObrigatoria = CMMS107_boolSim_(item.evidencia_obrigatoria) || tipo === 'EVIDENCIA';
  const resposta = CMMS107_firstNonEmpty_(payload.resposta, payload.valor, payload.valor_numero, payload.texto, payload.opcao);
  const valor = CMMS107_firstNonEmpty_(payload.valor, payload.valor_numero, payload.resposta);
  const hasResposta = !(resposta === null || resposta === undefined || String(resposta).trim() === '');
  const mensagens = [];
  let conforme = true;

  if (obrigatorio && tipo !== 'EVIDENCIA' && !hasResposta) {
    mensagens.push('Resposta obrigatória para item: ' + String(item.titulo || item.id));
    conforme = false;
  }

  if (['NUMERO', 'PARAMETRO', 'LEITURA_OPERACIONAL'].indexOf(tipo) >= 0) {
    const n = Number(String(valor).replace(',', '.'));
    if (!isFinite(n)) {
      mensagens.push('Valor numérico inválido para item: ' + String(item.titulo || item.id));
      conforme = false;
    } else {
      const min = CMMS107_numOrNull_(item.limite_min);
      const max = CMMS107_numOrNull_(item.limite_max);
      if (min !== null && n < min) { mensagens.push('Valor abaixo do limite mínimo: ' + min); conforme = false; }
      if (max !== null && n > max) { mensagens.push('Valor acima do limite máximo: ' + max); conforme = false; }
    }
  }

  if (tipo === 'OK_NOK') {
    const r = String(resposta || '').trim().toUpperCase();
    if (['OK', 'NOK', 'NA', 'N/A'].indexOf(r) < 0) {
      mensagens.push('Resposta OK_NOK deve ser OK, NOK ou NA.');
      conforme = false;
    }
    if (r === 'NOK') conforme = false;
  }

  if (tipo === 'CONFIRMACAO') {
    const r = String(resposta || '').trim().toUpperCase();
    if (['SIM', 'OK', 'CONFIRMADO', 'TRUE'].indexOf(r) < 0) {
      mensagens.push('Confirmação obrigatória não atendida.');
      conforme = false;
    }
  }

  if (tipo === 'SELECAO') {
    const opcoes = CMMS107_parseOptions_(item.opcoes_json);
    const r = String(resposta || '').trim();
    if (opcoes.length && opcoes.indexOf(r) < 0) {
      mensagens.push('Opção inválida. Permitidas: ' + opcoes.join(', '));
      conforme = false;
    }
  }

  if (evidenciaObrigatoria) {
    const evidenciaOk = CMMS107_hasEvidenceReference_(payload) || CMMS107_hasEvidenceInSheet_(item.id || payload.checklist_execucao_id);
    if (!evidenciaOk) {
      mensagens.push('Evidência obrigatória pendente para item: ' + String(item.titulo || item.id));
      conforme = false;
    }
  }

  return {
    valido: conforme,
    conforme: conforme ? 'SIM' : 'NAO',
    tipo_resposta: tipo,
    validacao_msg: mensagens.join('; '),
    mensagens: mensagens
  };
}

function CMMS107_validarModeloCompleto_(plano, itens) {
  const mensagens = [];
  let bloqueante = false;
  if (!itens.length) {
    mensagens.push('Modelo sem itens de checklist.');
    bloqueante = true;
  }
  itens.forEach(item => {
    const v = CMMS107_validarItemModelo_(item);
    if (!v.valido) {
      bloqueante = true;
      mensagens.push('Item ' + item.ordem + ' — ' + item.titulo + ': ' + v.mensagens.join('; '));
    }
  });
  return { valido: !bloqueante, bloqueante: bloqueante, mensagens: mensagens };
}

function CMMS107_validarItemModelo_(item) {
  const mensagens = [];
  let bloqueante = false;
  const tipo = String(item.tipo_resposta || '').trim().toUpperCase();
  const tiposPermitidos = CMMS107_ITEM_TYPES.map(t => t.tipo);

  if (!String(item.plano_id || '').trim()) mensagens.push('plano_id ausente.');
  if (!String(item.titulo || '').trim()) mensagens.push('titulo ausente.');
  if (!String(item.instrucao || '').trim()) mensagens.push('instrucao ausente.');
  if (!tipo) mensagens.push('tipo_resposta ausente.');
  if (tipo && tiposPermitidos.indexOf(tipo) < 0) mensagens.push('tipo_resposta inválido: ' + tipo + '. Permitidos: ' + tiposPermitidos.join(', '));
  if (!Number(item.ordem) || Number(item.ordem) <= 0) mensagens.push('ordem deve ser numérica positiva.');

  if (['NUMERO', 'PARAMETRO', 'LEITURA_OPERACIONAL'].indexOf(tipo) >= 0) {
    const min = CMMS107_numOrNull_(item.limite_min);
    const max = CMMS107_numOrNull_(item.limite_max);
    if (item.limite_min !== '' && min === null) mensagens.push('limite_min inválido.');
    if (item.limite_max !== '' && max === null) mensagens.push('limite_max inválido.');
    if (min !== null && max !== null && min > max) mensagens.push('limite_min não pode ser maior que limite_max.');
    if (!String(item.unidade || '').trim()) mensagens.push('unidade obrigatória para tipo ' + tipo + '.');
  }

  if (['PARAMETRO', 'LEITURA_OPERACIONAL'].indexOf(tipo) >= 0) {
    if (!String(item.parametro_nome || '').trim()) mensagens.push('parametro_nome obrigatório para tipo ' + tipo + '.');
  }

  if (tipo === 'SELECAO') {
    const opcoes = CMMS107_parseOptions_(item.opcoes_json);
    if (opcoes.length < 2) mensagens.push('SELECAO exige opcoes_json com pelo menos duas opções.');
  }

  if (tipo === 'EVIDENCIA') {
    if (!CMMS107_boolSim_(item.evidencia_obrigatoria)) mensagens.push('EVIDENCIA deve ter evidencia_obrigatoria = SIM.');
    if (!CMMS107_boolSim_(item.bloqueia_finalizacao)) mensagens.push('EVIDENCIA deve bloquear finalização.');
  }

  const minimoFotos = Number(item.evidencia_min_fotos || 0);
  if (!Number.isInteger(minimoFotos) || minimoFotos < 0 || minimoFotos > 10) {
    mensagens.push('evidencia_min_fotos deve ser um inteiro entre 0 e 10.');
  }
  if ((CMMS107_boolSim_(item.evidencia_obrigatoria) || tipo === 'EVIDENCIA') && minimoFotos < 1) {
    mensagens.push('Item com evidência obrigatória exige evidencia_min_fotos >= 1.');
  }

  if (mensagens.length) bloqueante = true;
  return { valido: !bloqueante, bloqueante: bloqueante, mensagens: mensagens };
}

function CMMS107_normalizarItemInput_(payload, existing) {
  const base = existing ? Object.assign({}, existing) : {};
  const tipo = String(CMMS107_firstNonEmpty_(payload.tipo_resposta, base.tipo_resposta, 'OK_NOK')).trim().toUpperCase();
  const tipoDef = CMMS107_ITEM_TYPES.filter(t => t.tipo === tipo)[0] || CMMS107_ITEM_TYPES[1];
  const opcoes = payload.opcoes || payload.opcoes_json || base.opcoes_json || '';
  const normalized = Object.assign(base, {
    id: String(CMMS107_firstNonEmpty_(payload.item_id, payload.id, base.id, '')).trim(),
    plano_id: String(CMMS107_firstNonEmpty_(payload.plano_id, base.plano_id, '')).trim(),
    ordem: Number(CMMS107_firstNonEmpty_(payload.ordem, base.ordem, 1)),
    titulo: String(CMMS107_firstNonEmpty_(payload.titulo, base.titulo, '')).trim(),
    instrucao: String(CMMS107_firstNonEmpty_(payload.instrucao, base.instrucao, '')).trim(),
    tipo_resposta: tipo,
    obrigatorio: CMMS107_simNao_(CMMS107_firstNonEmpty_(payload.obrigatorio, base.obrigatorio, 'SIM')),
    evidencia_obrigatoria: tipo === 'EVIDENCIA' ? 'SIM' : CMMS107_simNao_(CMMS107_firstNonEmpty_(payload.evidencia_obrigatoria, base.evidencia_obrigatoria, 'NAO')),
    foto_referencia_url: String(CMMS107_firstNonEmpty_(payload.foto_referencia_url, base.foto_referencia_url, '')).trim(),
    limite_min: CMMS107_firstNonEmpty_(payload.limite_min, base.limite_min, ''),
    limite_max: CMMS107_firstNonEmpty_(payload.limite_max, base.limite_max, ''),
    unidade: String(CMMS107_firstNonEmpty_(payload.unidade, base.unidade, '')).trim(),
    parametro_nome: String(CMMS107_firstNonEmpty_(payload.parametro_nome, base.parametro_nome, '')).trim(),
    valor_esperado: String(CMMS107_firstNonEmpty_(payload.valor_esperado, base.valor_esperado, '')).trim(),
    opcoes_json: CMMS107_stringifyOptions_(opcoes),
    bloqueia_finalizacao: tipo === 'EVIDENCIA' ? 'SIM' : CMMS107_simNao_(CMMS107_firstNonEmpty_(payload.bloqueia_finalizacao, base.bloqueia_finalizacao, 'SIM')),
    categoria: String(CMMS107_firstNonEmpty_(payload.categoria, base.categoria, tipoDef.categoria_padrao || 'OPERACIONAL')).trim().toUpperCase(),
    peso: Number(CMMS107_firstNonEmpty_(payload.peso, base.peso, 1)),
    status: String(CMMS107_firstNonEmpty_(payload.status, base.status, 'ATIVO')).trim().toUpperCase(),
    validacao_regra: String(CMMS107_firstNonEmpty_(payload.validacao_regra, base.validacao_regra, '')).trim(),
    evidencia_min_fotos: Math.max(0, Math.min(10, Math.floor(Number(CMMS107_firstNonEmpty_(payload.evidencia_min_fotos, base.evidencia_min_fotos, (tipo === 'EVIDENCIA' || CMMS107_boolSim_(CMMS107_firstNonEmpty_(payload.evidencia_obrigatoria, base.evidencia_obrigatoria, 'NAO'))) ? 1 : 0))))),
    criado_em: String(CMMS107_firstNonEmpty_(base.criado_em, payload.criado_em, '')).trim()
  });
  return normalized;
}

function CMMS107_enriquecerItem_(item) {
  const tipo = String(item.tipo_resposta || '').toUpperCase();
  const def = CMMS107_ITEM_TYPES.filter(t => t.tipo === tipo)[0] || null;
  const validacao = CMMS107_validarItemModelo_(item);
  const out = Object.assign({}, item);
  out.tipo_nome = def ? def.nome : '';
  out.tipo_descricao = def ? def.descricao : '';
  out.opcoes = CMMS107_parseOptions_(item.opcoes_json);
  out.evidencia_min_fotos = typeof evidenciaMinFotos116_ === 'function' ? evidenciaMinFotos116_(item) : Number(item.evidencia_min_fotos || 0);
  out.valido_modelo = validacao.valido;
  out.validacao_msg = validacao.mensagens.join('; ');
  return out;
}

function CMMS107_seedCatalogo_() {
  const ss = CMMS107_ss_();
  CMMS107_ensureSheet_(ss, CMMS107_SHEETS.TIPOS, CMMS107_TIPO_HEADERS);
  CMMS107_ensureSheet_(ss, CMMS107_SHEETS.REGRAS, CMMS107_REGRA_HEADERS);
  const now = CMMS107_now_();
  const tipos = CMMS107_readObjects_(CMMS107_SHEETS.TIPOS);
  const existentes = {};
  tipos.forEach(t => existentes[String(t.tipo || '').toUpperCase()] = true);
  CMMS107_ITEM_TYPES.forEach(t => {
    if (!existentes[t.tipo]) {
      CMMS107_appendObject_(CMMS107_SHEETS.TIPOS, Object.assign({ id: 'TCHK-' + t.tipo, ativo: 'SIM', criado_em: now }, t), CMMS107_TIPO_HEADERS);
    }
  });

  const regras = CMMS107_readObjects_(CMMS107_SHEETS.REGRAS);
  if (!regras.length) {
    const base = [
      ['REG-OKNOK-01', 'OK_NOK', 'NOK_NAO_CONFORME', 'NOK gera não conformidade', 'Resposta NOK marca item como não conforme.', { nok_conforme: false }],
      ['REG-NUM-01', 'NUMERO', 'LIMITE_MIN_MAX', 'Faixa numérica', 'Valor fora de limite torna item não conforme.', { usar_limites: true }],
      ['REG-EVD-01', 'EVIDENCIA', 'EVIDENCIA_OBRIGATORIA', 'Evidência obrigatória', 'Sem evidência, finalização deve ser bloqueada.', { evidencia_obrigatoria: true }],
      ['REG-SEL-01', 'SELECAO', 'OPCOES_FECHADAS', 'Opções fechadas', 'Resposta deve estar dentro das opções cadastradas.', { opcoes_fechadas: true }]
    ];
    base.forEach(r => {
      CMMS107_appendObject_(CMMS107_SHEETS.REGRAS, {
        id: r[0], tipo_item: r[1], codigo: r[2], nome: r[3], descricao: r[4],
        regra_json: JSON.stringify(r[5]), ativo: 'SIM', criado_em: now
      }, CMMS107_REGRA_HEADERS);
    });
  }
}

function CMMS107_modeloEditavel_(plano) {
  const wf = String(plano.workflow_status || '').trim().toUpperCase();
  return ['RASCUNHO', 'DEVOLVIDO_CORRECAO'].indexOf(wf) >= 0;
}

function CMMS107_assertModeloEditavel_(plano) {
  const wf = String(plano.workflow_status || '').trim().toUpperCase();
  if (!CMMS107_modeloEditavel_(plano)) {
    CMMS107_throw_('INVALID_WORKFLOW_STATUS', 'Modelo não pode ter catálogo alterado neste status: ' + wf);
  }
}

function CMMS107_audit_(planoId, itemId, evento, beforeJson, afterJson, usuario) {
  try {
    CMMS107_ensureSheet_(CMMS107_ss_(), CMMS107_SHEETS.AUDITORIA, CMMS107_AUDIT_HEADERS);
    CMMS107_appendObject_(CMMS107_SHEETS.AUDITORIA, {
      id: 'AUDCHK-' + CMMS107_uuid_(10),
      plano_id: planoId,
      item_id: itemId,
      evento: evento,
      antes_json: beforeJson || '',
      depois_json: afterJson || '',
      usuario_id: CMMS107_userId_(usuario),
      perfil: CMMS107_perfil_(usuario),
      criado_em: CMMS107_now_()
    }, CMMS107_AUDIT_HEADERS);
  } catch (e) {
    // Auditoria não deve derrubar a transação principal em Apps Script.
  }
}

function CMMS107_hasEvidenceReference_(payload) {
  return Boolean(String(payload.evidencia_id || payload.evidencia_url || payload.url || payload.nome_arquivo || '').trim());
}

function CMMS107_hasEvidenceInSheet_(checklistExecucaoId) {
  if (!checklistExecucaoId) return false;
  try {
    const evs = CMMS107_readObjects_(CMMS107_SHEETS.EVIDENCIAS);
    return evs.some(e => String(e.checklist_execucao_id || '').trim() === String(checklistExecucaoId).trim());
  } catch (e) {
    return false;
  }
}

function CMMS107_ss_() {
  if (typeof getSpreadsheet_ === 'function') return getSpreadsheet_();
  const props = PropertiesService.getScriptProperties();
  let key = '';
  try { if (typeof PROP_SPREADSHEET_ID !== 'undefined') key = PROP_SPREADSHEET_ID; } catch (e) {}
  const id = (key && props.getProperty(key)) || props.getProperty('FAB_SPREADSHEET_ID') || props.getProperty('SPREADSHEET_ID') || props.getProperty('spreadsheetId');
  if (!id) throw new Error('SPREADSHEET_ID_NOT_CONFIGURED');
  return SpreadsheetApp.openById(id);
}

function CMMS107_ensureSheet_(ss, name, headers) {
  let sh = ss.getSheetByName(name);
  if (!sh) sh = ss.insertSheet(name);
  const lastCol = Math.max(sh.getLastColumn(), 1);
  const existing = sh.getRange(1, 1, 1, lastCol).getValues()[0].map(String);
  if (!existing[0]) {
    sh.getRange(1, 1, 1, headers.length).setValues([headers]);
    return sh;
  }
  const toAdd = headers.filter(h => existing.indexOf(h) < 0);
  if (toAdd.length) {
    sh.getRange(1, existing.length + 1, 1, toAdd.length).setValues([toAdd]);
  }
  return sh;
}

function CMMS107_headers_(sh) {
  const cols = Math.max(sh.getLastColumn(), 1);
  return sh.getRange(1, 1, 1, cols).getValues()[0].map(String);
}

function CMMS107_readObjects_(sheetName) {
  const ss = CMMS107_ss_();
  const sh = ss.getSheetByName(sheetName);
  if (!sh || sh.getLastRow() < 2) return [];
  const headers = CMMS107_headers_(sh);
  const values = sh.getRange(2, 1, sh.getLastRow() - 1, headers.length).getValues();
  return values.map(row => {
    const o = {};
    headers.forEach((h, idx) => o[h] = row[idx]);
    return o;
  });
}

function CMMS107_getById_(sheetName, id) {
  const target = String(id || '').trim();
  if (!target) return null;
  return CMMS107_readObjects_(sheetName).filter(r => String(r.id || '').trim() === target)[0] || null;
}

function CMMS107_appendObject_(sheetName, obj, requiredHeaders) {
  const ss = CMMS107_ss_();
  const sh = CMMS107_ensureSheet_(ss, sheetName, requiredHeaders || Object.keys(obj));
  const headers = CMMS107_headers_(sh);
  const row = headers.map(h => obj[h] !== undefined ? obj[h] : '');
  sh.appendRow(row);
}

function CMMS107_upsertObject_(sheetName, obj, key, requiredHeaders) {
  const ss = CMMS107_ss_();
  const sh = CMMS107_ensureSheet_(ss, sheetName, requiredHeaders || Object.keys(obj));
  const headers = CMMS107_headers_(sh);
  const keyCol = headers.indexOf(key) + 1;
  if (!keyCol) throw new Error('KEY_NOT_FOUND_' + key);
  const last = sh.getLastRow();
  const target = String(obj[key] || '').trim();
  let rowIndex = 0;
  if (last >= 2) {
    const keys = sh.getRange(2, keyCol, last - 1, 1).getValues().map(r => String(r[0] || '').trim());
    const idx = keys.indexOf(target);
    if (idx >= 0) rowIndex = idx + 2;
  }
  const row = headers.map(h => obj[h] !== undefined ? obj[h] : '');
  if (rowIndex) sh.getRange(rowIndex, 1, 1, headers.length).setValues([row]);
  else sh.appendRow(row);
}

function CMMS107_required_(value, field) {
  const v = String(value === undefined || value === null ? '' : value).trim();
  if (!v) CMMS107_throw_('REQUIRED_FIELD', 'Campo obrigatório: ' + field);
  return v;
}

function CMMS107_requirePerfil_(usuario, perfis) {
  const perfil = CMMS107_perfil_(usuario);
  if (!perfil) {
    // Compatibilidade: se o roteador atual já validou token e não passou usuário, não derruba chamadas administrativas.
    // Para produção SaaS, remover este fallback e exigir usuário autenticado no dispatcher.
    return true;
  }
  if (perfis.map(String).map(s => s.toUpperCase()).indexOf(perfil) < 0) {
    CMMS107_throw_('FORBIDDEN', 'Perfil ' + perfil + ' sem permissão para catálogo checklist.');
  }
  return true;
}

function CMMS107_perfil_(usuario) {
  if (!usuario) return '';
  return String(usuario.perfil || usuario.role || usuario.tipo || '').trim().toUpperCase();
}

function CMMS107_userId_(usuario) {
  if (!usuario) return 'SISTEMA';
  return String(usuario.usuario_id || usuario.user_id || usuario.id || 'SISTEMA').trim();
}

function CMMS107_throw_(code, message) {
  const err = new Error(message || code);
  err.code = code;
  err.status = code === 'FORBIDDEN' ? 403 : 400;
  throw err;
}

function CMMS107_now_() {
  return Utilities.formatDate(new Date(), Session.getScriptTimeZone() || 'America/Sao_Paulo', "yyyy-MM-dd'T'HH:mm:ss");
}

function CMMS107_uuid_(len) {
  return Utilities.getUuid().replace(/-/g, '').toUpperCase().slice(0, len || 10);
}

function CMMS107_slug_(text) {
  return String(text || '')
    .normalize('NFD').replace(/[\u0300-\u036f]/g, '')
    .replace(/[^A-Za-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .toUpperCase()
    .slice(0, 48);
}

function CMMS107_makeItemId_(planoId, ordem, titulo) {
  return ('PIT-' + CMMS107_slug_(planoId) + '-' + String(ordem || 1) + '-' + CMMS107_slug_(titulo || 'ITEM')).slice(0, 96);
}

function CMMS107_simNao_(v) {
  return CMMS107_boolSim_(v) ? 'SIM' : 'NAO';
}

function CMMS107_boolSim_(v) {
  const s = String(v === true ? 'SIM' : (v || '')).trim().toUpperCase();
  return ['SIM', 'S', 'TRUE', '1', 'YES', 'OK'].indexOf(s) >= 0;
}

function CMMS107_numOrNull_(v) {
  if (v === '' || v === null || v === undefined) return null;
  const n = Number(String(v).replace(',', '.'));
  return isFinite(n) ? n : null;
}

function CMMS107_firstNonEmpty_() {
  for (let i = 0; i < arguments.length; i++) {
    const v = arguments[i];
    if (v !== undefined && v !== null && String(v).trim() !== '') return v;
  }
  return '';
}

function CMMS107_parseOptions_(raw) {
  if (Array.isArray(raw)) return raw.map(String).map(s => s.trim()).filter(Boolean);
  const s = String(raw || '').trim();
  if (!s) return [];
  try {
    const parsed = JSON.parse(s);
    if (Array.isArray(parsed)) return parsed.map(String).map(x => x.trim()).filter(Boolean);
  } catch (e) {}
  return s.split(/[;,|]/).map(x => x.trim()).filter(Boolean);
}

function CMMS107_stringifyOptions_(raw) {
  const arr = CMMS107_parseOptions_(raw);
  return arr.length ? JSON.stringify(arr) : '';
}
