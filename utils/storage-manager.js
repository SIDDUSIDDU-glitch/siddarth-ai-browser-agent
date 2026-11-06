/**
 * Storage Manager for Siddarth
 * Provides strongly-typed and promise-based interactions with chrome.storage.local
 */

export const STORAGE_KEYS = {
  SETTINGS: 'siddarth_settings',
  PROFILE: 'siddarth_profile',
  SKILLS: 'siddarth_skills',
  SESSION: 'siddarth_active_session',
  LOGS: 'siddarth_action_logs',
  TOKEN_USAGE: 'siddarth_token_usage'
};

export const DEFAULT_SETTINGS = {
  geminiApiKey: '',
  groqApiKey: '',
  preferredModel: 'gemini-flash-lite-latest',
  groqModel: 'openai/gpt-oss-120b',
  enableFallback: true,
  defaultLanguage: 'en', // 'en' (English) or 'hi-en' (Hinglish)
  maxAgentSteps: 10,
  dryRunMode: false
};

export const DEFAULT_TOKEN_USAGE = {
  promptTokens: 0,
  candidatesTokens: 0,
  totalTokens: 0,
  requestCount: 0,
  lastRequestTokens: 0,
  lastUpdated: null
};

export const DEFAULT_PROFILE = {
  name: '',
  college: '',
  skills: '',
  links: '',
  preferredTone: 'Professional and concise'
};

/**
 * Get item from chrome.storage.local
 * @param {string} key
 * @param {any} defaultValue
 * @returns {Promise<any>}
 */
export async function getStorageItem(key, defaultValue = null) {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome?.storage?.local) {
      resolve(defaultValue);
      return;
    }

    chrome.storage.local.get([key], (result) => {
      if (chrome.runtime?.lastError) {
        console.error(`Error reading ${key}:`, chrome.runtime.lastError);
        resolve(defaultValue);
      } else {
        resolve(result[key] !== undefined ? result[key] : defaultValue);
      }
    });
  });
}

/**
 * Set item into chrome.storage.local
 * @param {string} key
 * @param {any} value
 * @returns {Promise<boolean>}
 */
export async function setStorageItem(key, value) {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome?.storage?.local) {
      resolve(false);
      return;
    }

    chrome.storage.local.set({ [key]: value }, () => {
      if (chrome.runtime?.lastError) {
        console.error(`Error saving ${key}:`, chrome.runtime.lastError);
        resolve(false);
      } else {
        resolve(true);
      }
    });
  });
}

/**
 * Settings helpers
 */
export async function getSettings() {
  const stored = await getStorageItem(STORAGE_KEYS.SETTINGS, {});
  return { ...DEFAULT_SETTINGS, ...stored };
}

export async function saveSettings(partialSettings) {
  const current = await getSettings();
  const updated = { ...current, ...partialSettings };
  await setStorageItem(STORAGE_KEYS.SETTINGS, updated);
  return updated;
}

/**
 * Profile helpers
 */
export async function getProfile() {
  const stored = await getStorageItem(STORAGE_KEYS.PROFILE, {});
  return { ...DEFAULT_PROFILE, ...stored };
}

export async function saveProfile(partialProfile) {
  const current = await getProfile();
  const updated = { ...current, ...partialProfile };
  await setStorageItem(STORAGE_KEYS.PROFILE, updated);
  return updated;
}

/**
 * Saved Skills helpers
 */
export async function getSkills() {
  return await getStorageItem(STORAGE_KEYS.SKILLS, []);
}

export async function saveSkills(skillsArray) {
  return await setStorageItem(STORAGE_KEYS.SKILLS, skillsArray);
}

/**
 * Active Agent Session helpers (survives service worker suspension)
 */
export async function getActiveSession() {
  return await getStorageItem(STORAGE_KEYS.SESSION, null);
}

export async function saveActiveSession(sessionData) {
  return await setStorageItem(STORAGE_KEYS.SESSION, sessionData);
}

export async function clearActiveSession() {
  return new Promise((resolve) => {
    if (typeof chrome === 'undefined' || !chrome?.storage?.local) {
      resolve(true);
      return;
    }
    chrome.storage.local.remove([STORAGE_KEYS.SESSION], () => {
      resolve(true);
    });
  });
}

/**
 * Action Log helpers
 */
export async function getActionLogs() {
  return await getStorageItem(STORAGE_KEYS.LOGS, []);
}

export async function appendActionLog(logEntry) {
  const currentLogs = await getActionLogs();
  const updated = [
    ...currentLogs,
    {
      ...logEntry,
      timestamp: Date.now()
    }
  ];
  await setStorageItem(STORAGE_KEYS.LOGS, updated);
  return updated;
}

export async function clearActionLogs() {
  return await setStorageItem(STORAGE_KEYS.LOGS, []);
}

/**
 * Token Usage helpers
 */
export async function getTokenUsage() {
  const stored = await getStorageItem(STORAGE_KEYS.TOKEN_USAGE, {});
  return { ...DEFAULT_TOKEN_USAGE, ...stored };
}

export async function recordTokenUsage({ promptTokens = 0, candidatesTokens = 0, totalTokens = 0 }) {
  const current = await getTokenUsage();
  const calculatedTotal = totalTokens || (promptTokens + candidatesTokens);
  const updated = {
    promptTokens: (current.promptTokens || 0) + promptTokens,
    candidatesTokens: (current.candidatesTokens || 0) + candidatesTokens,
    totalTokens: (current.totalTokens || 0) + calculatedTotal,
    requestCount: (current.requestCount || 0) + 1,
    lastRequestTokens: calculatedTotal,
    lastUpdated: Date.now()
  };
  await setStorageItem(STORAGE_KEYS.TOKEN_USAGE, updated);
  return updated;
}

export async function resetTokenUsage() {
  const reset = {
    ...DEFAULT_TOKEN_USAGE,
    lastUpdated: Date.now()
  };
  await setStorageItem(STORAGE_KEYS.TOKEN_USAGE, reset);
  return reset;
}

