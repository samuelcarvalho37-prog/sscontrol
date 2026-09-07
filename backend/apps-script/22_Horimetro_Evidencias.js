/**
 * FAB Control 1.1.7
 * Horímetro acumulado, contador de serviço e evidências fotográficas.
 *
 * Regras centrais:
 * - horímetro total é acumulativo e não pode diminuir;
 * - o contador "desde o último serviço" é reiniciado movendo uma linha-base,
 *   sem zerar o horímetro total;
 * - evidência é validada pela quantidade exata configurada no item;
 * - fotos são armazenadas em pasta privada do Google Drive.
 */

function ensureHorimetroEvidenciasSchema116_(){
  var ss = getSpreadsheet_();
  ensureSheet_(ss, "ativos", SH.ativos);
  ensureSheet_(ss, "plano_itens", SH.plano_itens);
  ensureSheet_(ss, "checklist_execucao", SH.checklist_execucao);
  ensureSheet_(ss, "evidencias", SH.evidencias);

  rows_("ativos", true).forEach(function(ativo){
    var patch = {};
    if(!clean_(ativo.horimetro_modo)) patch.horimetro_modo = "MANUAL";
    if(!clean_(ativo.horimetro_atualizado_em) && clean_(ativo.horimetro_atual) !== ""){
      patch.horimetro_atualizado_em = ativo.atualizado_em || now_();
    }
    if(Object.keys(patch).length){
      patch.atualizado_em = now_();
      update_("ativos", ativo.__rowIndex, patch);
    }
  });

  rows_("plano_itens", true).forEach(function(item){
    if(clean_(item.evidencia_min_fotos) !== "") return;
    update_("plano_itens", item.__rowIndex, {
      evidencia_min_fotos:evidenciaMinFotos116_(item),
      atualizado_em:now_()
    });
  });

  rows_("checklist_execucao", true).forEach(function(item){
    if(clean_(item.evidencia_min_fotos) !== "") return;
    update_("checklist_execucao", item.__rowIndex, {
      evidencia_min_fotos:evidenciaMinFotos116_(item),
      atualizado_em:now_()
    });
  });

  upsert_("config", "chave", {
    chave:"evidencia.foto.max_bytes",
    valor:2500000,
    descricao:"Tamanho máximo de cada foto comprimida enviada pelo aplicativo.",
    atualizado_em:now_()
  });

  upsert_("config", "chave", {
    chave:"horimetro.regra",
    valor:"TOTAL_ACUMULATIVO",
    descricao:"O horímetro total não é reiniciado. Reinicia-se apenas a linha-base do contador de serviço.",
    atualizado_em:now_()
  });
}

function cmmsHorimetroEvidenciasSchemaUpgrade116_(p, auth){
  auth = auth || p.__auth || {};
  if(upper_(auth.perfil) !== ROLE.ADMIN){
    err_("FORBIDDEN_ADMIN_REQUIRED", "Upgrade de horímetro e evidências exige perfil ADMIN.", 403);
  }

  ensureHorimetroEvidenciasSchema116_();
  invalidateRuntimeCache_();

  return {
    upgraded:true,
    version:FAB.VERSION,
    total_sheets:Object.keys(SH).length,
    updated_sheets:["ativos", "plano_itens", "checklist_execucao", "evidencias"],
    horimeter:{
      total_counter:"ACUMULATIVO_NAO_REINICIAVEL",
      service_counter:"REINICIAVEL_POR_LINHA_BASE",
      modes:["MANUAL", "TELEMETRIA"]
    },
    evidence:{
      minimum_photos_per_item:true,
      direct_photo_upload:true,
      storage:"GOOGLE_DRIVE_PRIVADO",
      max_photo_bytes:evidenciaFotoMaxBytes116_()
    }
  };
}

function normalizaTextoTecnico116_(value){
  return upper_(value || "")
    .replace(/[ÁÀÂÃÄ]/g, "A")
    .replace(/[ÉÈÊË]/g, "E")
    .replace(/[ÍÌÎÏ]/g, "I")
    .replace(/[ÓÒÔÕÖ]/g, "O")
    .replace(/[ÚÙÛÜ]/g, "U")
    .replace(/Ç/g, "C");
}

function itemEhHorimetro116_(item){
  var parametro = normalizaTextoTecnico116_(item && item.parametro_nome);
  var titulo = normalizaTextoTecnico116_(item && item.titulo);
  return parametro === "HORIMETRO" || titulo.indexOf("HORIMETRO") >= 0;
}

function horimetroModo116_(ativo){
  var mode = upper_(ativo && ativo.horimetro_modo || "MANUAL");
  return mode === "TELEMETRIA" ? "TELEMETRIA" : "MANUAL";
}

function horimetroResumo116_(ativo){
  if(!ativo) return null;
  var total = Math.max(0, num_(ativo.horimetro_atual, 0));
  var hasBase = clean_(ativo.horimetro_base_servico) !== "";
  var base = hasBase ? Math.max(0, num_(ativo.horimetro_base_servico, 0)) : null;
  var sinceService = hasBase ? Math.max(0, total - base) : null;

  return {
    ativo_id:ativo.id,
    total_horas:total,
    modo:horimetroModo116_(ativo),
    automatico:horimetroModo116_(ativo) === "TELEMETRIA",
    atualizado_em:ativo.horimetro_atualizado_em || ativo.atualizado_em || "",
    contador_servico_horas:sinceService,
    contador_servico_base:base,
    contador_servico_reiniciado_em:ativo.horimetro_base_servico_em || "",
    total_reiniciavel:false,
    contador_servico_reiniciavel:true
  };
}

function validarValorHorimetro116_(ativo, valor){
  var next = Number(String(valor).replace(",", "."));
  if(!isFinite(next) || next < 0){
    err_("HORIMETER_INVALID", "Horímetro deve ser um número maior ou igual a zero.", 400);
  }

  var current = Math.max(0, num_(ativo && ativo.horimetro_atual, 0));
  if(next + 0.0001 < current){
    err_(
      "HORIMETER_CANNOT_DECREASE",
      "Horímetro total não pode diminuir. Valor atual: "+current+" h; valor informado: "+next+" h. Para reiniciar a contagem de manutenção, use o contador de serviço.",
      400
    );
  }
  return next;
}

function atualizarHorimetroAtivo116_(ativo, valor, origem, auth){
  if(!ativo) err_("ASSET_NOT_FOUND", "Equipamento não encontrado para atualizar horímetro.", 404);
  var next = validarValorHorimetro116_(ativo, valor);
  var current = Math.max(0, num_(ativo.horimetro_atual, 0));
  var changed = Math.abs(next - current) > 0.0001;

  update_("ativos", ativo.__rowIndex, {
    horimetro_atual:next,
    horimetro_modo:horimetroModo116_(ativo),
    horimetro_atualizado_em:now_(),
    atualizado_em:now_()
  });

  if(changed){
    hist_({
      ativo_id:ativo.id,
      evento:"HORIMETRO_ATUALIZADO",
      descricao:"Horímetro atualizado de "+current+" h para "+next+" h. Origem: "+upper_(origem || "MANUAL")+".",
      usuario_id:auth && auth.usuario_id || "",
      perfil:auth && auth.perfil || ROLE.SISTEMA
    });
  }

  return horimetroResumo116_(find_("ativos", "id", ativo.id));
}

function registrarParametroHorimetro116_(ativo, valor, origem, auth, componenteId){
  var source = upper_(origem || "MANUAL");
  if(
    horimetroModo116_(ativo) === "TELEMETRIA" &&
    source.indexOf("TELEMETRIA") < 0 &&
    upper_(auth && auth.perfil) === ROLE.OPERADOR
  ){
    err_(
      "HORIMETER_TELEMETRY_MANAGED",
      "Este horímetro é atualizado automaticamente pela telemetria e não aceita lançamento manual do operador.",
      400
    );
  }
  var next = validarValorHorimetro116_(ativo, valor);
  var row = fit_("parametros", {
    id:uuid_("PAR"),
    ativo_id:ativo.id,
    componente_id:componenteId || "",
    parametro:"HORIMETRO",
    valor:next,
    unidade:"h",
    origem:upper_(origem || "MANUAL"),
    registrado_por:auth && auth.usuario_id || "",
    registrado_em:now_(),
    criado_em:now_()
  });
  append_("parametros", row);
  var summary = atualizarHorimetroAtivo116_(ativo, next, origem, auth);
  return {parametro:row, horimetro:summary};
}


function adminRegistrarHorimetroTelemetria116_(p, auth){
  auth = auth || p.__auth || {};
  if(upper_(auth.perfil) !== ROLE.ADMIN){
    err_("FORBIDDEN_ADMIN_REQUIRED", "Registro de telemetria exige perfil ADMIN.", 403);
  }
  req_(p, ["ativo_id", "valor"]);

  var ativo = find_("ativos", "id", p.ativo_id);
  if(!ativo) err_("ASSET_NOT_FOUND", "Equipamento não encontrado.", 404);

  if(horimetroModo116_(ativo) !== "TELEMETRIA"){
    update_("ativos", ativo.__rowIndex, {
      horimetro_modo:"TELEMETRIA",
      atualizado_em:now_()
    });
    ativo = find_("ativos", "id", ativo.id);
  }

  var result = registrarParametroHorimetro116_(
    ativo,
    p.valor,
    "TELEMETRIA",
    auth,
    ""
  );

  return {
    saved:true,
    source:"TELEMETRIA",
    parametro:result.parametro,
    horimetro:result.horimetro
  };
}

function adminReiniciarContadorServico116_(p, auth){
  auth = auth || p.__auth || {};
  if(upper_(auth.perfil) !== ROLE.ADMIN){
    err_("FORBIDDEN_ADMIN_REQUIRED", "Somente ADMIN pode reiniciar o contador de serviço.", 403);
  }
  req_(p, ["ativo_id"]);

  var ativo = find_("ativos", "id", p.ativo_id);
  if(!ativo) err_("ASSET_NOT_FOUND", "Equipamento não encontrado.", 404);
  var total = Math.max(0, num_(ativo.horimetro_atual, 0));
  var base = clean_(p.horimetro_base) === "" ? total : Number(String(p.horimetro_base).replace(",", "."));
  if(!isFinite(base) || base < 0 || base > total){
    err_("HORIMETER_SERVICE_BASE_INVALID", "A linha-base deve estar entre 0 e o horímetro total atual ("+total+" h).", 400);
  }

  update_("ativos", ativo.__rowIndex, {
    horimetro_base_servico:base,
    horimetro_base_servico_em:now_(),
    atualizado_em:now_()
  });

  hist_({
    ativo_id:ativo.id,
    evento:"CONTADOR_SERVICO_REINICIADO",
    descricao:"Contador desde o último serviço reiniciado na linha-base "+base+" h. O horímetro total permaneceu em "+total+" h.",
    usuario_id:auth.usuario_id || "",
    perfil:auth.perfil || ROLE.ADMIN
  });

  return {
    reset:true,
    horimetro:horimetroResumo116_(find_("ativos", "id", ativo.id))
  };
}

function sincronizarHorimetroChecklist116_(ex, auth){
  if(!ex) return null;
  var ativo = find_("ativos", "id", ex.ativo_id);
  if(!ativo) return null;

  var candidates = rows_("checklist_execucao", true).filter(function(item){
    return String(item.execucao_id) === String(ex.id) &&
      itemEhHorimetro116_(item) &&
      clean_(item.valor_numero !== "" ? item.valor_numero : item.resposta) !== "";
  }).sort(function(a,b){ return num_(a.ordem,0)-num_(b.ordem,0); });

  if(!candidates.length) return horimetroResumo116_(ativo);
  var item = candidates[candidates.length - 1];
  var raw = clean_(item.valor_numero) !== "" ? item.valor_numero : item.resposta;
  var next = validarValorHorimetro116_(ativo, raw);
  var current = Math.max(0, num_(ativo.horimetro_atual, 0));

  if(next > current + 0.0001){
    return registrarParametroHorimetro116_(
      ativo,
      next,
      "CHECKLIST_EXECUCAO",
      auth,
      ""
    ).horimetro;
  }
  return horimetroResumo116_(ativo);
}

function evidenciaMinFotos116_(item){
  item = item || {};
  var raw = clean_(item.evidencia_min_fotos);
  var exige = upper_(item.tipo_resposta) === "EVIDENCIA" || bool_(item.evidencia_obrigatoria);
  var value = raw === "" ? (exige ? 1 : 0) : Math.floor(num_(raw, 0));
  if(exige && value < 1) value = 1;
  return Math.max(0, Math.min(10, value));
}

function evidenciaFotoMaxBytes116_(){
  return Math.max(250000, Math.min(5000000, num_(configurationRuntimeValue_("evidencia.foto.max_bytes", 2500000), 2500000)));
}

function pastaEvidencias116_(){
  var props = PropertiesService.getScriptProperties();
  var key = "FAB_CONTROL_EVIDENCE_FOLDER_ID";
  var folderId = props.getProperty(key);
  if(folderId){
    try { return DriveApp.getFolderById(folderId); } catch(ignore){}
  }

  var folder = DriveApp.createFolder("FAB Control - Evidencias");
  props.setProperty(key, folder.getId());
  return folder;
}

function nomeArquivoSeguro116_(name){
  var safe = clean_(name || "evidencia.jpg")
    .replace(/[\\/:*?"<>|]+/g, "-")
    .replace(/\s+/g, " ")
    .trim();
  return safe || "evidencia.jpg";
}

function autorizarDriveEvidencias117_(){
  var root = DriveApp.getRootFolder();
  var folder = pastaEvidencias116_();
  return {
    authorized:true,
    root_id:root.getId(),
    folder_id:folder.getId(),
    folder_name:folder.getName()
  };
}

function testarAutorizacaoDrive117() {
  const resultado = autorizarDriveEvidencias117_();
  console.log(JSON.stringify(resultado));
  return resultado;
}

function adminVerificarDriveEvidencias117_(p, auth){
  auth = auth || p.__auth || {};
  if(upper_(auth.perfil) !== ROLE.ADMIN){
    err_("FORBIDDEN_ADMIN_REQUIRED", "Verificação do Drive exige perfil ADMIN.", 403);
  }

  try{
    return autorizarDriveEvidencias117_();
  } catch(e){
    err_(
      "DRIVE_AUTHORIZATION_REQUIRED",
      "O projeto ainda não foi autorizado para usar o Google Drive. No editor do Apps Script, execute manualmente autorizarDriveEvidencias117_ e aprove a permissão solicitada.",
      403
    );
  }
}

function quantidadeEvidenciasRegistradas117_(checklistExecucaoId){
  return rows_("evidencias").filter(function(evidencia){
    return String(evidencia.checklist_execucao_id) === String(checklistExecucaoId) &&
      upper_(evidencia.tipo || "FOTO") === "FOTO";
  }).length;
}

function operadorUploadEvidenciaFoto116_(p, auth){
  auth = requireOperadorAuth1081_(auth || p.__auth || {}, "operador.upload_evidencia_foto");
  req_(p, ["acao_id", "checklist_execucao_id", "nome_arquivo", "mime_type", "base64_data"]);

  var mime = clean_(p.mime_type).toLowerCase();
  if(mime.indexOf("image/") !== 0){
    err_("EVIDENCE_IMAGE_REQUIRED", "A evidência enviada deve ser uma imagem.", 400);
  }

  var encoded = clean_(p.base64_data).replace(/^data:[^;]+;base64,/, "");
  var bytes;
  try { bytes = Utilities.base64Decode(encoded); }
  catch(e){ err_("EVIDENCE_BASE64_INVALID", "Conteúdo da foto inválido.", 400); }

  var maxBytes = evidenciaFotoMaxBytes116_();
  if(!bytes || !bytes.length) err_("EVIDENCE_EMPTY", "A foto está vazia.", 400);
  if(bytes.length > maxBytes){
    err_("EVIDENCE_TOO_LARGE", "Foto excede o limite de "+maxBytes+" bytes após compressão.", 400);
  }

  var item = find_("checklist_execucao", "id", p.checklist_execucao_id);
  if(!item) err_("CHECKLIST_NOT_FOUND", "Item de checklist não encontrado para evidência.", 404);
  var acao = find_("os_acoes", "id", p.acao_id);
  if(!acao || String(item.acao_id) !== String(acao.id)){
    err_("CHECKLIST_ACTION_MISMATCH", "Item de checklist não pertence à ação informada.", 400);
  }
  var ex = find_("execucoes", "id", item.execucao_id);
  requireExecucaoDoOperador1081_(ex, auth);

  var quantidadeConfigurada = evidenciaMinFotos116_(item);
  var quantidadeRegistrada = clean_(item.evidencias_count) !== ""
    ? Math.max(0, num_(item.evidencias_count, 0))
    : quantidadeEvidenciasRegistradas117_(item.id);
  if(quantidadeConfigurada > 0 && quantidadeRegistrada >= quantidadeConfigurada){
    err_(
      "EVIDENCE_QUANTITY_REACHED",
      "A quantidade de "+quantidadeConfigurada+" foto(s) configurada para este item já foi atendida.",
      409
    );
  }

  var filename = nomeArquivoSeguro116_(p.nome_arquivo);
  var blob = Utilities.newBlob(bytes, mime, filename);
  var file;
  try{
    file = pastaEvidencias116_().createFile(blob);
  } catch(e){
    var driveMessage = String(e && e.message || e || "");
    if(driveMessage.indexOf("DriveApp") >= 0 || driveMessage.indexOf("auth/drive") >= 0 || driveMessage.indexOf("permiss") >= 0){
      err_(
        "DRIVE_AUTHORIZATION_REQUIRED",
        "Autorize o Google Drive no Apps Script executando manualmente autorizarDriveEvidencias117_ antes de enviar fotos.",
        403
      );
    }
    throw e;
  }
  var fileId = file.getId();
  var fileUrl = file.getUrl();
  var thumbnail = "https://drive.google.com/thumbnail?id="+encodeURIComponent(fileId)+"&sz=w800";
  var saved = operadorRegistrarEvidencia_({
    __auth:auth,
    acao_id:acao.id,
    execucao_id:item.execucao_id,
    checklist_execucao_id:item.id,
    tipo:"FOTO",
    nome_arquivo:filename,
    url:fileUrl,
    observacao:clean_(p.observacao),
    arquivo_id:fileId,
    mime_type:mime,
    tamanho_bytes:bytes.length,
    thumbnail_url:thumbnail,
    __quantidade_anterior:quantidadeRegistrada
  });

  saved.uploaded = true;
  saved.arquivo_id = fileId;
  saved.url = fileUrl;
  saved.thumbnail_url = thumbnail;
  saved.mime_type = mime;
  saved.tamanho_bytes = bytes.length;
  saved.quantidade_configurada = quantidadeConfigurada;
  saved.fotos_registradas = quantidadeRegistrada + 1;
  saved.fotos_restantes = Math.max(0, quantidadeConfigurada - saved.fotos_registradas);
  return saved;
}
