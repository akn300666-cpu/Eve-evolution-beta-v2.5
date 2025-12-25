
import { Message, ModelTier, ApiKeyDef, GenerationSettings } from './types';

const DB_NAME = 'EveVaultDB';
const DB_VERSION = 1;
const STORE_NAME = 'sessions';
const GLOBAL_SESSION_KEY = 'global_session'; // Fixed key for the single session

const KEYS_STORAGE_KEY = 'eve_api_keys';
const ACTIVE_KEY_ID_STORAGE_KEY = 'eve_active_key_id';
const GRADIO_URL_STORAGE_KEY = 'eve_gradio_url';
const GEN_SETTINGS_STORAGE_KEY = 'eve_gen_settings';

interface StoredSession {
  messages: Message[];
  tier: ModelTier;
  lastUpdated: number;
}

// --- INDEXEDDB HELPERS ---

const initDB = (): Promise<IDBDatabase> => {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onerror = (event: Event) => {
      const req = event.target as IDBRequest;
      reject(req.error);
    };
    request.onsuccess = () => {
      resolve(request.result);
    };
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id' });
      }
    };
  });
};

export const saveSession = async (messages: Message[], tier: ModelTier = 'free') => {
  let db: IDBDatabase | null = null;
  try {
    db = await initDB();
    const data = { id: GLOBAL_SESSION_KEY, messages, tier, lastUpdated: Date.now() };
    
    return new Promise<void>((resolve, reject) => {
      const transaction = db!.transaction([STORE_NAME], 'readwrite');
      
      transaction.oncomplete = () => {
        if (db) db.close();
        resolve();
      };
      
      transaction.onerror = (event: Event) => {
        const tx = event.target as IDBTransaction;
        if (db) db.close();
        reject(tx.error);
      };

      const store = transaction.objectStore(STORE_NAME);
      store.put(data);
    });
  } catch (e) {
    if (db) db.close();
    throw e;
  }
};

export const loadSession = async (): Promise<StoredSession | null> => {
  let db: IDBDatabase | null = null;
  try {
    db = await initDB();
    return new Promise((resolve, reject) => {
      const transaction = db!.transaction([STORE_NAME], 'readonly');
      
      transaction.oncomplete = () => {
        if (db) db.close();
      };

      transaction.onerror = (event: Event) => {
        const tx = event.target as IDBTransaction;
        if (db) db.close();
        reject(tx.error);
      };

      const store = transaction.objectStore(STORE_NAME);
      const request = store.get(GLOBAL_SESSION_KEY);
      
      request.onsuccess = () => {
        const result = request.result;
        resolve(result as StoredSession);
      };
      
      request.onerror = (event: Event) => {
          resolve(null);
      };
    });
  } catch (e) {
    if (db) db.close();
    return null;
  }
};

export const clearSession = async () => {
  let db: IDBDatabase | null = null;
  try {
    db = await initDB();
    const transaction = db.transaction([STORE_NAME], 'readwrite');
    
    transaction.oncomplete = () => {
        if (db) db.close();
    };
    
    transaction.onerror = (event: Event) => {
      if (db) db.close();
    };

    const store = transaction.objectStore(STORE_NAME);
    store.delete(GLOBAL_SESSION_KEY);
    
  } catch (e) {
    if (db) db.close();
    throw e;
  }
};

// --- API KEY MANAGEMENT ---

export const saveApiKeys = (keys: ApiKeyDef[]) => {
  localStorage.setItem(KEYS_STORAGE_KEY, JSON.stringify(keys));
};

export const loadApiKeys = (): ApiKeyDef[] => {
  try {
    const raw = localStorage.getItem(KEYS_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch (e) {
    return [];
  }
};

export const saveActiveKeyId = (id: string | null) => {
  if (id) {
    localStorage.setItem(ACTIVE_KEY_ID_STORAGE_KEY, id);
  } else {
    localStorage.removeItem(ACTIVE_KEY_ID_STORAGE_KEY);
  }
};

export const loadActiveKeyId = (): string | null => {
  return localStorage.getItem(ACTIVE_KEY_ID_STORAGE_KEY);
};

// --- GRADIO ENDPOINT STORAGE ---

export const saveGradioEndpoint = (url: string) => {
  localStorage.setItem(GRADIO_URL_STORAGE_KEY, url.trim()); 
};

export const loadGradioEndpoint = (): string | null => {
  const url = localStorage.getItem(GRADIO_URL_STORAGE_KEY);
  return url === '' ? null : url;
};

// --- GENERATION SETTINGS STORAGE ---

export const saveGenerationSettings = (settings: GenerationSettings) => {
    localStorage.setItem(GEN_SETTINGS_STORAGE_KEY, JSON.stringify(settings));
};

export const loadGenerationSettings = (): GenerationSettings => {
    const defaults: GenerationSettings = {
        guidance: 7.4,
        steps: 40,
        ipAdapterStrength: 0.1,
        loraStrength: 0.45,
        seed: -1,
        randomizeSeed: true,
        temperature: 1.0,
        topP: 0.95,
        topK: 40,
        language: 'en'
    };
    try {
        const raw = localStorage.getItem(GEN_SETTINGS_STORAGE_KEY);
        if (raw) {
            const parsed = JSON.parse(raw);
            return {
                guidance: typeof parsed.guidance === 'number' ? parsed.guidance : defaults.guidance,
                steps: typeof parsed.steps === 'number' ? parsed.steps : defaults.steps,
                ipAdapterStrength: typeof parsed.ipAdapterStrength === 'number' ? parsed.ipAdapterStrength : defaults.ipAdapterStrength,
                loraStrength: typeof parsed.loraStrength === 'number' ? parsed.loraStrength : defaults.loraStrength,
                seed: typeof parsed.seed === 'number' ? parsed.seed : defaults.seed,
                randomizeSeed: typeof parsed.randomizeSeed === 'boolean' ? parsed.randomizeSeed : defaults.randomizeSeed,
                temperature: typeof parsed.temperature === 'number' ? parsed.temperature : defaults.temperature,
                topP: typeof parsed.topP === 'number' ? parsed.topP : defaults.topP,
                topK: typeof parsed.topK === 'number' ? parsed.topK : defaults.topK,
                language: (parsed.language === 'en' || parsed.language === 'ml' || parsed.language === 'manglish') ? parsed.language : defaults.language
            };
        }
    } catch (e) {}
    return defaults;
};
