/**
 * Siddarth Main Side Panel Controller
 * Handles tab navigation, language switching, and sub-view initialization.
 */

import { SettingsTab } from './tabs/settings.js';
import { ChatTab } from './tabs/chat.js';
import { AgentTab } from './tabs/agent.js';
import { ProfileTab } from './tabs/profile.js';
import { getSettings, saveSettings } from '../utils/storage-manager.js';

class SiddarthApp {
  constructor() {
    this.currentTab = 'settings'; // Default to settings on first launch
    this.currentLanguage = 'en';
    this.init();
  }

  async init() {
    this.initElements();
    this.bindEvents();

    // Initialize sub-modules
    this.settingsTab = new SettingsTab({
      onStatusChange: (status) => this.updateStatusPill(status)
    });

    this.chatTab = new ChatTab({
      onNavigateTab: (tabId) => this.switchTab(tabId)
    });

    this.agentTab = new AgentTab({
      onNavigateTab: (tabId) => this.switchTab(tabId)
    });

    this.profileTab = new ProfileTab({
      onNavigateTab: (tabId) => this.switchTab(tabId),
      onFillFormFromProfile: () => {
        this.switchTab('agent');
        this.agentTab.handleStartTask('Fill out this form using my local profile memory');
      },
      onRunSkill: (skill) => {
        if (skill.targetTab === 'agent') {
          this.switchTab('agent');
          this.agentTab.handleStartTask(skill.promptTemplate);
        } else {
          this.switchTab('chat');
          this.chatTab.handleRunSkill(skill.promptTemplate, skill.name);
        }
      }
    });

    await this.loadPreferences();

    // Check if API key is already configured; if so, switch to chat
    const settings = await getSettings();
    if (settings.geminiApiKey) {
      this.switchTab('chat');
    } else {
      this.switchTab('settings');
    }

    // Check for any pending context menu action (Slice 7)
    await this.checkPendingContextMenuAction();

    // Listen for runtime messages from background service worker
    chrome.runtime.onMessage.addListener((message) => {
      this.handleRuntimeMessage(message);
    });
  }

  initElements() {
    this.tabButtons = document.querySelectorAll('.tab-nav-btn');
    this.tabPanels = document.querySelectorAll('.tab-panel');
    this.langEnBtn = document.getElementById('lang-en-btn');
    this.langHiBtn = document.getElementById('lang-hien-btn');
    this.statusPill = document.getElementById('header-status-pill');
    this.statusDot = this.statusPill?.querySelector('.status-dot');
    this.statusText = document.getElementById('header-status-text');
  }

  bindEvents() {
    // Tab switching
    this.tabButtons.forEach(btn => {
      btn.addEventListener('click', () => {
        const targetTab = btn.getAttribute('data-tab');
        this.switchTab(targetTab);
      });
    });

    // Language Toggle
    this.langEnBtn?.addEventListener('click', () => this.setLanguage('en'));
    this.langHiBtn?.addEventListener('click', () => this.setLanguage('hi-en'));
  }

  async loadPreferences() {
    const settings = await getSettings();
    this.setLanguage(settings.defaultLanguage || 'en', false);
  }

  switchTab(tabId) {
    this.currentTab = tabId;

    // Update buttons
    this.tabButtons.forEach(btn => {
      const match = btn.getAttribute('data-tab') === tabId;
      btn.classList.toggle('active', match);
    });

    // Update panels
    this.tabPanels.forEach(panel => {
      const match = panel.id === `tab-${tabId}`;
      panel.classList.toggle('active', match);
    });
  }

  async setLanguage(lang, persist = true) {
    this.currentLanguage = lang;
    
    if (this.langEnBtn && this.langHiBtn) {
      this.langEnBtn.classList.toggle('active', lang === 'en');
      this.langHiBtn.classList.toggle('active', lang === 'hi-en');
    }

    if (persist) {
      await saveSettings({ defaultLanguage: lang });
    }

    this.chatTab?.onLanguageChange?.(lang);
  }

  updateStatusPill({ connected, label }) {
    if (!this.statusPill || !this.statusText) return;

    let statusClass = 'status-unconfigured';
    if (connected) {
      statusClass = 'status-connected';
    } else if (label && label.toLowerCase().includes('error')) {
      statusClass = 'status-error';
    }

    this.statusPill.className = `status-pill ${statusClass}`;
    this.statusText.textContent = label;
  }

  handleRuntimeMessage(message) {
    if (message.type === 'CONTEXT_MENU_ACTION' && message.payload) {
      // Clear pending action from storage
      chrome.storage?.local?.remove(['siddarth_pending_context_action']).catch(() => {});

      // Switch to Chat tab and execute quick action (Slice 7)
      this.switchTab('chat');
      this.chatTab?.handleContextMenuAction?.(message.payload);
    }
  }

  async checkPendingContextMenuAction() {
    try {
      if (typeof chrome === 'undefined' || !chrome.storage?.local) return;
      const stored = await chrome.storage.local.get(['siddarth_pending_context_action']);
      const pending = stored?.siddarth_pending_context_action;
      if (pending && pending.action && pending.selectionText) {
        // Clear from storage so it does not re-trigger on subsequent launches
        await chrome.storage.local.remove(['siddarth_pending_context_action']);

        // Only process if recent (within 60 seconds)
        if (Date.now() - (pending.timestamp || 0) < 60000) {
          this.switchTab('chat');
          this.chatTab?.handleContextMenuAction?.(pending);
        }
      }
    } catch (err) {
      console.warn('[Siddarth] Could not retrieve pending context action:', err);
    }
  }
}

// Bootstrap application on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.siddarth = new SiddarthApp();
});

