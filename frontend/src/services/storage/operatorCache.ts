import type { OperatorActionDetailData, OperatorQrContextData } from '../../types/api'
import type { OperatorAction } from '../../types/operator'

type CacheRecord<T> = {
  key: string
  value: T
  savedAt: number
}

const DB_NAME = 'fab-control-operator-cache'
const DB_VERSION = 1
const STORE = 'records'
const ACTIONS_KEY = 'operator-actions'
const MAX_AGE_MS = 24 * 60 * 60 * 1000

const memoryCache = new Map<string, CacheRecord<unknown>>()
let databasePromise: Promise<IDBDatabase> | null = null

function openDatabase(): Promise<IDBDatabase> {
  if (databasePromise) return databasePromise

  databasePromise = new Promise((resolve, reject) => {
    const request = window.indexedDB.open(DB_NAME, DB_VERSION)
    request.onerror = () => {
      databasePromise = null
      reject(request.error)
    }
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORE)) {
        database.createObjectStore(STORE, { keyPath: 'key' })
      }
    }
    request.onsuccess = () => {
      const database = request.result
      database.onversionchange = () => {
        database.close()
        databasePromise = null
      }
      resolve(database)
    }
  })

  return databasePromise
}

async function writeRecord<T>(key: string, value: T): Promise<void> {
  const record: CacheRecord<T> = { key, value, savedAt: Date.now() }
  memoryCache.set(key, record as CacheRecord<unknown>)
  if (!('indexedDB' in window)) return

  try {
    const database = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).put(record)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } catch {
    // Cache é uma otimização.
  }
}

async function readRecord<T>(key: string): Promise<T | null> {
  const memory = memoryCache.get(key) as CacheRecord<T> | undefined
  if (memory) {
    if (Date.now() - memory.savedAt <= MAX_AGE_MS) return memory.value
    memoryCache.delete(key)
  }

  if (!('indexedDB' in window)) return null
  try {
    const database = await openDatabase()
    const record = await new Promise<CacheRecord<T> | undefined>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readonly')
      const request = transaction.objectStore(STORE).get(key)
      request.onsuccess = () => resolve(request.result as CacheRecord<T> | undefined)
      request.onerror = () => reject(request.error)
    })

    if (!record || Date.now() - record.savedAt > MAX_AGE_MS) return null
    memoryCache.set(key, record as CacheRecord<unknown>)
    return record.value
  } catch {
    return null
  }
}

async function deleteRecord(key: string): Promise<void> {
  memoryCache.delete(key)
  if (!('indexedDB' in window)) return
  try {
    const database = await openDatabase()
    await new Promise<void>((resolve, reject) => {
      const transaction = database.transaction(STORE, 'readwrite')
      transaction.objectStore(STORE).delete(key)
      transaction.oncomplete = () => resolve()
      transaction.onerror = () => reject(transaction.error)
      transaction.onabort = () => reject(transaction.error)
    })
  } catch {
    // Sem impacto operacional.
  }
}

export function readActionsCache(): Promise<OperatorAction[] | null> {
  return readRecord<OperatorAction[]>(ACTIONS_KEY)
}

export function writeActionsCache(actions: OperatorAction[]): Promise<void> {
  return writeRecord(ACTIONS_KEY, actions)
}

export function readActionDetailCache(actionId: string): Promise<OperatorActionDetailData | null> {
  return readRecord<OperatorActionDetailData>(`action-detail:${actionId}`)
}

export function writeActionDetailCache(actionId: string, detail: OperatorActionDetailData): Promise<void> {
  return writeRecord(`action-detail:${actionId}`, detail)
}

export function removeActionDetailCache(actionId: string): Promise<void> {
  return deleteRecord(`action-detail:${actionId}`)
}

export function readQrContextCache(qrPayload: string): Promise<OperatorQrContextData | null> {
  return readRecord<OperatorQrContextData>(`qr-context:${qrPayload.trim().toUpperCase()}`)
}

export function writeQrContextCache(qrPayload: string, context: OperatorQrContextData): Promise<void> {
  const compactContext: OperatorQrContextData = {
    ...context,
    historico_recente: (context.historico_recente ?? []).slice(0, 4),
    historico_paginacao: context.historico_paginacao
      ? { ...context.historico_paginacao, limit: 4 }
      : { next_cursor: '', has_more: false, limit: 4 },
  }
  return writeRecord(`qr-context:${qrPayload.trim().toUpperCase()}`, compactContext)
}

export async function clearOperatorCache(): Promise<void> {
  memoryCache.clear()
  if (!('indexedDB' in window)) return

  if (databasePromise) {
    try {
      const database = await databasePromise
      database.close()
    } catch {
      // O banco pode já estar indisponível.
    }
    databasePromise = null
  }

  await new Promise<void>((resolve) => {
    const request = window.indexedDB.deleteDatabase(DB_NAME)
    request.onsuccess = () => resolve()
    request.onerror = () => resolve()
    request.onblocked = () => resolve()
  })
}
