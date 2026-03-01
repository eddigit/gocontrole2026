import { PrismaClient } from '@prisma/client';
import {
  type AuthenticationCreds,
  type AuthenticationState,
  type SignalDataTypeMap,
  initAuthCreds,
  proto,
  BufferJSON,
} from '@whiskeysockets/baileys';
import NodeCache from 'node-cache';
import { createChildLogger } from '../utils/logger.js';

const log = createChildLogger('auth-state-postgres');

/**
 * Custom Baileys auth state adapter backed by PostgreSQL.
 * Replaces useMultiFileAuthState for production reliability.
 * Uses NodeCache to reduce DB reads for signal key operations.
 */
export async function usePostgresAuthState(
  prisma: PrismaClient,
  sessionId: string,
): Promise<{ state: AuthenticationState; saveCreds: () => Promise<void> }> {
  const cache = new NodeCache({ stdTTL: 300, checkperiod: 60 });

  const CREDS_KEY = 'creds';
  const CREDS_TYPE = 'creds';

  // Load or initialize credentials
  async function loadCreds(): Promise<AuthenticationCreds> {
    try {
      const record = await prisma.authKey.findUnique({
        where: { sessionId_type_keyId: { sessionId, type: CREDS_TYPE, keyId: CREDS_KEY } },
      });
      if (record) {
        return JSON.parse(JSON.stringify(record.value), BufferJSON.reviver) as AuthenticationCreds;
      }
    } catch (err) {
      log.error({ err, sessionId }, 'Failed to load creds, initializing new ones');
    }
    return initAuthCreds();
  }

  let creds = await loadCreds();

  const saveCreds = async () => {
    try {
      const value = JSON.parse(JSON.stringify(creds, BufferJSON.replacer));
      await prisma.authKey.upsert({
        where: { sessionId_type_keyId: { sessionId, type: CREDS_TYPE, keyId: CREDS_KEY } },
        create: { sessionId, type: CREDS_TYPE, keyId: CREDS_KEY, value },
        update: { value },
      });
    } catch (err) {
      log.error({ err, sessionId }, 'Failed to save creds');
    }
  };

  // Signal key store with caching
  async function readKeys<T extends keyof SignalDataTypeMap>(
    type: T,
    ids: string[],
  ): Promise<{ [id: string]: SignalDataTypeMap[T] }> {
    const result: { [id: string]: SignalDataTypeMap[T] } = {};

    const uncachedIds: string[] = [];
    for (const id of ids) {
      const cacheKey = `${type}:${id}`;
      const cached = cache.get<SignalDataTypeMap[T]>(cacheKey);
      if (cached !== undefined) {
        result[id] = cached;
      } else {
        uncachedIds.push(id);
      }
    }

    if (uncachedIds.length > 0) {
      try {
        const records = await prisma.authKey.findMany({
          where: {
            sessionId,
            type,
            keyId: { in: uncachedIds },
          },
        });

        for (const record of records) {
          const parsed = JSON.parse(JSON.stringify(record.value), BufferJSON.reviver);
          const value = (type === 'app-state-sync-key'
            ? proto.Message.AppStateSyncKeyData.fromObject(parsed)
            : parsed) as unknown as SignalDataTypeMap[T];

          result[record.keyId] = value;
          cache.set(`${type}:${record.keyId}`, value);
        }
      } catch (err) {
        log.error({ err, type, ids: uncachedIds }, 'Failed to read keys from DB');
      }
    }

    return result;
  }

  async function writeKeys(data: { [category: string]: { [id: string]: unknown } }): Promise<void> {
    const operations: Promise<unknown>[] = [];

    for (const [type, entries] of Object.entries(data)) {
      for (const [keyId, value] of Object.entries(entries)) {
        const cacheKey = `${type}:${keyId}`;

        if (value === null || value === undefined) {
          // Delete key
          cache.del(cacheKey);
          operations.push(
            prisma.authKey.deleteMany({
              where: { sessionId, type, keyId },
            }).catch(err => log.error({ err, type, keyId }, 'Failed to delete key')),
          );
        } else {
          // Upsert key
          const serialized = JSON.parse(JSON.stringify(value, BufferJSON.replacer));
          cache.set(cacheKey, value);
          operations.push(
            prisma.authKey.upsert({
              where: { sessionId_type_keyId: { sessionId, type, keyId } },
              create: { sessionId, type, keyId, value: serialized },
              update: { value: serialized },
            }).catch(err => log.error({ err, type, keyId }, 'Failed to upsert key')),
          );
        }
      }
    }

    await Promise.all(operations);
  }

  return {
    state: {
      creds,
      keys: {
        get: readKeys,
        set: writeKeys,
      },
    },
    saveCreds,
  };
}
