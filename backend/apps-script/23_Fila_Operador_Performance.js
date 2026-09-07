/**
 * FAB Control 1.1.7
 * Sincronização da fila do operador sem depender da leitura de QR Code.
 */

function operadorMinhasAcoes117_(p, auth){
  p = p || {};
  auth = auth || p.__auth || {};

  var sync = sincronizarMotorFilaOperador117_(auth, bool_(p.forcar_motor));
  var queueRequest = Object.assign({}, p, {
    status:"PENDENTE,EM_EXECUCAO",
    incluir_concluidas:false
  });
  var result = operadorMinhasAcoes112_(queueRequest, auth);
  result.queue_sync = sync;
  result.version = FAB.VERSION;
  return result;
}

function sincronizarMotorFilaOperador117_(auth, force){
  var cache = CacheService.getScriptCache();
  var key = "FAB_CONTROL_OPERATOR_QUEUE_MOTOR_" + FAB.VERSION;
  var cachedAt = cache.get(key);

  if(!force && cachedAt){
    return {
      motor_executado:false,
      origem:"CACHE",
      sincronizado_em:cachedAt
    };
  }

  var lock = LockService.getScriptLock();
  if(!lock.tryLock(1200)){
    return {
      motor_executado:false,
      origem:"OUTRA_REQUISICAO",
      sincronizado_em:cachedAt || ""
    };
  }

  try{
    cachedAt = cache.get(key);
    if(!force && cachedAt){
      return {
        motor_executado:false,
        origem:"CACHE_APOS_LOCK",
        sincronizado_em:cachedAt
      };
    }

    var motor = cmmsMotorRecalcular_({__auth:auth});
    DB_CACHE["os_acoes"] = null;
    if(typeof tableCacheKey_ === "function" && typeof safeCacheRemove_ === "function"){
      safeCacheRemove_(tableCacheKey_("os_acoes"));
    }

    var synchronizedAt = now_();
    cache.put(key, synchronizedAt, 45);

    return {
      motor_executado:true,
      origem:"MOTOR_CMMS",
      sincronizado_em:synchronizedAt,
      acoes_criadas:num_(motor && motor.acoes_criadas, 0)
    };
  } finally {
    lock.releaseLock();
  }
}
