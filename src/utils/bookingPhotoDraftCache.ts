import {
  collectDraftPhotoFilesFromBookingData,
  restoreDraftPhotoFilesInBookingData,
} from './bookingDraftPhotoState'

const DRAFT_PHOTO_DB_NAME = 'garser-booking-draft-photos'
const DRAFT_PHOTO_DB_VERSION = 1
const DRAFT_PHOTO_FILES_STORE = 'draft_photo_files'
const DRAFT_PHOTO_MANIFEST_STORE = 'draft_photo_manifests'

type DraftPhotoFileRecord = {
  id: string
  ownerKey: string
  photoId: string
  file: File
  updatedAt: string
}

type DraftPhotoManifestRecord = {
  ownerKey: string
  photoIds: string[]
  updatedAt: string
}

function canUseIndexedDb() {
  return typeof indexedDB !== 'undefined'
}

export function buildBookingDraftPhotoOwnerKeys(userId?: string | null) {
  const primary = userId ? `user:${userId}` : 'anon'
  const fallbacks = userId ? ['anon'] : []
  return [primary, ...fallbacks]
}

function buildDraftPhotoCacheKey(ownerKey: string, photoId: string) {
  return `${ownerKey}:${photoId}`
}

function openDraftPhotoDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DRAFT_PHOTO_DB_NAME, DRAFT_PHOTO_DB_VERSION)

    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(DRAFT_PHOTO_FILES_STORE)) {
        db.createObjectStore(DRAFT_PHOTO_FILES_STORE, { keyPath: 'id' })
      }
      if (!db.objectStoreNames.contains(DRAFT_PHOTO_MANIFEST_STORE)) {
        db.createObjectStore(DRAFT_PHOTO_MANIFEST_STORE, { keyPath: 'ownerKey' })
      }
    }

    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error('INDEXED_DB_OPEN_FAILED'))
  })
}

function readStoreValue<T>(store: IDBObjectStore, key: IDBValidKey) {
  return new Promise<T | undefined>((resolve, reject) => {
    const request = store.get(key)
    request.onsuccess = () => resolve(request.result as T | undefined)
    request.onerror = () => reject(request.error || new Error('INDEXED_DB_READ_FAILED'))
  })
}

function putStoreValue(store: IDBObjectStore, value: unknown) {
  return new Promise<void>((resolve, reject) => {
    const request = store.put(value)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error || new Error('INDEXED_DB_WRITE_FAILED'))
  })
}

function deleteStoreValue(store: IDBObjectStore, key: IDBValidKey) {
  return new Promise<void>((resolve, reject) => {
    const request = store.delete(key)
    request.onsuccess = () => resolve()
    request.onerror = () => reject(request.error || new Error('INDEXED_DB_DELETE_FAILED'))
  })
}

function arraysAreEqual(a: string[], b: string[]) {
  if (a.length !== b.length) return false
  return a.every((value, index) => value === b[index])
}

export async function syncBookingDraftPhotoCache(data: unknown, userId?: string | null) {
  if (!canUseIndexedDb()) return

  const ownerKey = buildBookingDraftPhotoOwnerKeys(userId)[0]
  const photoFiles = collectDraftPhotoFilesFromBookingData(data)
  const currentPhotoIds = Array.from(photoFiles.keys()).sort()
  const db = await openDraftPhotoDatabase()

  try {
    const manifestTx = db.transaction([DRAFT_PHOTO_MANIFEST_STORE], 'readonly')
    const previousManifest = await readStoreValue<DraftPhotoManifestRecord>(
      manifestTx.objectStore(DRAFT_PHOTO_MANIFEST_STORE),
      ownerKey,
    )
    await new Promise<void>((resolve, reject) => {
      manifestTx.oncomplete = () => resolve()
      manifestTx.onerror = () => reject(manifestTx.error || new Error('INDEXED_DB_MANIFEST_READ_FAILED'))
      manifestTx.onabort = () => reject(manifestTx.error || new Error('INDEXED_DB_MANIFEST_READ_ABORTED'))
    })

    const previousPhotoIds = [...(previousManifest?.photoIds || [])].sort()
    if (arraysAreEqual(previousPhotoIds, currentPhotoIds)) {
      return
    }

    const writeTx = db.transaction([DRAFT_PHOTO_FILES_STORE, DRAFT_PHOTO_MANIFEST_STORE], 'readwrite')
    const filesStore = writeTx.objectStore(DRAFT_PHOTO_FILES_STORE)
    const manifestStore = writeTx.objectStore(DRAFT_PHOTO_MANIFEST_STORE)
    const stalePhotoIds = previousPhotoIds.filter((photoId) => !currentPhotoIds.includes(photoId))

    await Promise.all(stalePhotoIds.map((photoId) => deleteStoreValue(filesStore, buildDraftPhotoCacheKey(ownerKey, photoId))))
    await Promise.all(
      Array.from(photoFiles.entries()).map(([photoId, file]) =>
        putStoreValue(filesStore, {
          id: buildDraftPhotoCacheKey(ownerKey, photoId),
          ownerKey,
          photoId,
          file,
          updatedAt: new Date().toISOString(),
        } satisfies DraftPhotoFileRecord),
      ),
    )
    await putStoreValue(manifestStore, {
      ownerKey,
      photoIds: currentPhotoIds,
      updatedAt: new Date().toISOString(),
    } satisfies DraftPhotoManifestRecord)

    await new Promise<void>((resolve, reject) => {
      writeTx.oncomplete = () => resolve()
      writeTx.onerror = () => reject(writeTx.error || new Error('INDEXED_DB_SYNC_FAILED'))
      writeTx.onabort = () => reject(writeTx.error || new Error('INDEXED_DB_SYNC_ABORTED'))
    })
  } finally {
    db.close()
  }
}

async function readCachedDraftPhotoFile(ownerKeys: string[], photoId: string) {
  if (!canUseIndexedDb()) return null

  const db = await openDraftPhotoDatabase()
  try {
    const tx = db.transaction([DRAFT_PHOTO_FILES_STORE], 'readonly')
    const store = tx.objectStore(DRAFT_PHOTO_FILES_STORE)

    for (const ownerKey of ownerKeys) {
      const record = await readStoreValue<DraftPhotoFileRecord>(
        store,
        buildDraftPhotoCacheKey(ownerKey, photoId),
      )
      if (record?.file instanceof File) {
        return record.file
      }
    }

    return null
  } finally {
    db.close()
  }
}

export async function restoreBookingDraftPhotoCache<T>(data: T, userId?: string | null) {
  const ownerKeys = buildBookingDraftPhotoOwnerKeys(userId)
  return restoreDraftPhotoFilesInBookingData(data, (photoId) => readCachedDraftPhotoFile(ownerKeys, photoId))
}

export async function clearBookingDraftPhotoCache(userId?: string | null) {
  if (!canUseIndexedDb()) return

  const ownerKey = buildBookingDraftPhotoOwnerKeys(userId)[0]
  const db = await openDraftPhotoDatabase()

  try {
    const manifestTx = db.transaction([DRAFT_PHOTO_MANIFEST_STORE], 'readonly')
    const manifest = await readStoreValue<DraftPhotoManifestRecord>(
      manifestTx.objectStore(DRAFT_PHOTO_MANIFEST_STORE),
      ownerKey,
    )
    await new Promise<void>((resolve, reject) => {
      manifestTx.oncomplete = () => resolve()
      manifestTx.onerror = () => reject(manifestTx.error || new Error('INDEXED_DB_MANIFEST_READ_FAILED'))
      manifestTx.onabort = () => reject(manifestTx.error || new Error('INDEXED_DB_MANIFEST_READ_ABORTED'))
    })

    const writeTx = db.transaction([DRAFT_PHOTO_FILES_STORE, DRAFT_PHOTO_MANIFEST_STORE], 'readwrite')
    const filesStore = writeTx.objectStore(DRAFT_PHOTO_FILES_STORE)
    const manifestStore = writeTx.objectStore(DRAFT_PHOTO_MANIFEST_STORE)

    await Promise.all(
      (manifest?.photoIds || []).map((photoId) => deleteStoreValue(filesStore, buildDraftPhotoCacheKey(ownerKey, photoId))),
    )
    await deleteStoreValue(manifestStore, ownerKey)

    await new Promise<void>((resolve, reject) => {
      writeTx.oncomplete = () => resolve()
      writeTx.onerror = () => reject(writeTx.error || new Error('INDEXED_DB_CLEAR_FAILED'))
      writeTx.onabort = () => reject(writeTx.error || new Error('INDEXED_DB_CLEAR_ABORTED'))
    })
  } finally {
    db.close()
  }
}
