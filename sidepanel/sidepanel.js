/**
 * Siddarth Main Side Panel Controller
 * Handles tab navigation, language switching, and sub-view initialization.
 */

import { SettingsTab } from './tabs/settings.js';
import { ChatTab } from './tabs/chat.js';
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
    await this.loadPreferences();

    // Initialize sub-modules
    this.settingsTab = new SettingsTab({
      onStatusChange: (status) => this.updateStatusPill(status)
    });

    this.chatTab = new ChatTab({
      onNavigateTab: (tabId) => this.switchTab(tabId)
    });

    // Check if API key is already configured; if so, switch to chat
    const settings = await getSettings();
    if (settings.geminiApiKey) {
      this.switchTab('chat');
    } else {
      this.switchTab('settings');
    }

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
    if (message.type === 'CONTEXT_MENU_ACTION') {
      // Switch to Chat tab when right-click menu item is clicked
      this.switchTab('chat');
    }
  }
}

// Bootstrap application on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  window.siddarth = new SiddarthApp();
});

