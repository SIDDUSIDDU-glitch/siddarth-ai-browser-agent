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
  email: '',
  phone: '',
  college: '',
  degree: '',
  skills: '',
  links: '',
  bio: '',
  preferredTone: 'Professional and concise'
};

export const DEFAULT_SKILLS = [
  {
    id: 'skill_exam_notes',
    name: 'Exam notes',
    description: 'Extract high-yield exam notes, core definitions, formulas, and 5 likely exam questions.',
    promptTemplate: 'Analyze this page and generate comprehensive exam revision notes: 1. Core Concepts & Definitions, 2. Important Formulas / Key Takeaways, 3. Top 5 Likely Exam Questions with Detailed Answers.',
    targetTab: 'chat',
    isBuiltIn: true,
    createdAt: 1700000000000
  },
  {
    id: 'skill_explain_hinglish',
    name: 'Explain in Hinglish',
    description: 'Explain the page content simply in conversational Roman Hinglish with relatable everyday examples.',
    promptTemplate: 'Is page ke content ko simple aur easy-to-understand conversational Roman Hinglish mein explain karo. Complex technical terms ko everyday life examples ke saath samjhao.',
    targetTab: 'chat',
    isBuiltIn: true,
    createdAt: 1700000000001
  },
  {
    id: 'skill_reply_email',
    name: 'Reply to this email politely',
    description: 'Draft a polite, professional, and well-structured email reply addressing all key points.',
    promptTemplate: 'Based on the email or message content on this page, draft a polite, professional, and well-structured reply. Address each question or point clearly, keeping a warm yet professional tone.',
    targetTab: 'chat',
    isBuiltIn: true,
    createdAt: 1700000000002
  },
  {
    id: 'skill_fill_form',
    name: 'Fill form from profile',
    description: 'Automatically fill out the web form on this page using local profile memory.',
    promptTemplate: 'Fill out this form using my local profile memory',
    targetTab: 'agent',
    isBuiltIn: true,
    createdAt: 1700000000003
  }
];

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

export async function clearProfile() {
  await setStorageItem(STORAGE_KEYS.PROFILE, { ...DEFAULT_PROFILE });
  return { ...DEFAULT_PROFILE };
}

/**
 * Saved Skills helpers (Slice 15: One-Click Skills Import & Export)
 */
export async function getSkills() {
  const stored = await getStorageItem(STORAGE_KEYS.SKILLS, null);
  if (!stored || !Array.isArray(stored) || stored.length === 0) {
    await setStorageItem(STORAGE_KEYS.SKILLS, DEFAULT_SKILLS);
    return DEFAULT_SKILLS.map(s => ({ ...s }));
  }
  return stored;
}

export async function saveSkills(skillsArray) {
  await setStorageItem(STORAGE_KEYS.SKILLS, skillsArray);
  return skillsArray;
}

export async function addOrUpdateSkill(skillData) {
  if (!skillData || !skillData.name || !skillData.name.trim()) {
    throw new Error('Skill name is required.');
  }
  if (!skillData.promptTemplate || !skillData.promptTemplate.trim()) {
    throw new Error('Skill prompt template is required.');
  }

  const currentSkills = await getSkills();
  const id = skillData.id || `skill_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;
  const skillToSave = {
    id,
    name: skillData.name.trim(),
    description: (skillData.description || '').trim(),
    promptTemplate: skillData.promptTemplate.trim(),
    targetTab: skillData.targetTab === 'agent' ? 'agent' : 'chat',
    isBuiltIn: Boolean(skillData.isBuiltIn),
    createdAt: skillData.createdAt || Date.now(),
    updatedAt: Date.now()
  };

  const existingIndex = currentSkills.findIndex(s => s.id === id);
  let updatedSkills;
  if (existingIndex >= 0) {
    updatedSkills = [...currentSkills];
    updatedSkills[existingIndex] = { ...currentSkills[existingIndex], ...skillToSave };
  } else {
    updatedSkills = [...currentSkills, skillToSave];
  }

  await saveSkills(updatedSkills);
  return { skill: skillToSave, skills: updatedSkills };
}

export async function deleteSkill(skillId) {
  const currentSkills = await getSkills();
  const updatedSkills = currentSkills.filter(s => s.id !== skillId);
  await saveSkills(updatedSkills);
  return updatedSkills;
}

export async function resetSkillsToDefault() {
  const cloned = DEFAULT_SKILLS.map(s => ({ ...s }));
  await saveSkills(cloned);
  return cloned;
}

export async function exportSkillsAsJson() {
  const skills = await getSkills();
  const payload = {
    version: '1.0',
    exportedAt: new Date().toISOString(),
    source: 'Siddarth AI Browser Agent',
    skillsCount: skills.length,
    skills
  };
  return JSON.stringify(payload, null, 2);
}

export async function importSkillsFromJson(jsonString, options = { merge: true }) {
  if (!jsonString || typeof jsonString !== 'string') {
    throw new Error('Invalid JSON input: text content required.');
  }

  let parsed;
  try {
    parsed = JSON.parse(jsonString.trim());
  } catch (err) {
    throw new Error(`Invalid JSON syntax: ${err.message}`);
  }

  const skillsToImport = Array.isArray(parsed) ? parsed : (Array.isArray(parsed?.skills) ? parsed.skills : null);
  if (!skillsToImport || !Array.isArray(skillsToImport)) {
    throw new Error('Invalid skills schema: expected an array or an object containing a "skills" array.');
  }

  if (skillsToImport.length === 0) {
    throw new Error('Skills file is empty. No skills found to import.');
  }

  const sanitized = [];
  for (let i = 0; i < skillsToImport.length; i++) {
    const item = skillsToImport[i];
    if (!item || typeof item !== 'object') continue;
    const name = String(item.name || '').trim();
    const promptTemplate = String(item.promptTemplate || '').trim();
    if (!name || !promptTemplate) {
      throw new Error(`Skill at index ${i} is missing required "name" or "promptTemplate".`);
    }

    sanitized.push({
      id: item.id || `skill_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      name,
      description: String(item.description || '').trim(),
      promptTemplate,
      targetTab: item.targetTab === 'agent' ? 'agent' : 'chat',
      isBuiltIn: Boolean(item.isBuiltIn),
      createdAt: item.createdAt || Date.now(),
      updatedAt: Date.now()
    });
  }

  const currentSkills = await getSkills();
  let finalSkills;

  if (options.merge) {
    const skillMap = new Map();
    currentSkills.forEach(s => skillMap.set(s.id, s));
    sanitized.forEach(s => skillMap.set(s.id, s));
    finalSkills = Array.from(skillMap.values());
  } else {
    finalSkills = sanitized;
  }

  await saveSkills(finalSkills);
  return {
    success: true,
    importedCount: sanitized.length,
    totalCount: finalSkills.length,
    skills: finalSkills
  };
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

export async function exportActionLogsAsJson() {
  const logs = await getActionLogs();
  return JSON.stringify(logs, null, 2);
}

export async function getDryRunMode() {
  const settings = await getSettings();
  return Boolean(settings.dryRunMode);
}

export async function setDryRunMode(enabled) {
  return await saveSettings({ dryRunMode: Boolean(enabled) });
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

