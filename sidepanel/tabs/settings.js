/**
 * Settings Tab Controller
 * Handles API key configuration, model selection, connectivity testing,
 * token usage metrics, and local storage synchronization.
 */

import { aiClient } from '../../utils/ai-client.js';
import { getSettings, saveSettings, getTokenUsage, resetTokenUsage } from '../../utils/storage-manager.js';

export class SettingsTab {
  constructor(options = {}) {
    this.onStatusChange = options.onStatusChange || (() => {});
    this.initElements();
    this.bindEvents();
    this.loadSettings();
  }

  initElements() {
    this.geminiKeyInput = document.getElementById('setting-gemini-key');
    this.toggleGeminiBtn = document.getElementById('toggle-gemini-visibility');
    this.groqKeyInput = document.getElementById('setting-groq-key');
    this.toggleGroqBtn = document.getElementById('toggle-groq-visibility');
    this.modelSelect = document.getElementById('setting-model-select');
    this.fallbackToggle = document.getElementById('setting-fallback-toggle');
    this.groqModelSelect = document.getElementById('setting-groq-model-select');
    this.fallbackStatusBadge = document.getElementById('fallback-status-badge');
    this.maxStepsInput = document.getElementById('setting-max-steps');
    this.dryRunToggle = document.getElementById('setting-dry-run-toggle');
    
    this.saveBtn = document.getElementById('btn-save-settings');
    this.testGeminiBtn = document.getElementById('btn-test-gemini');
    this.testResultBox = document.getElementById('test-result-box');
    this.testGroqBtn = document.getElementById('btn-test-groq');
    this.testGroqResultBox = document.getElementById('test-groq-result-box');

    // Token usage elements
    this.statTotalTokens = document.getElementById('stat-total-tokens');
    this.statPromptTokens = document.getElementById('stat-prompt-tokens');
    this.statCandidatesTokens = document.getElementById('stat-candidates-tokens');
    this.statRequestCount = document.getElementById('stat-request-count');
    this.btnResetTokenStats = document.getElementById('btn-reset-token-stats');
  }

  bindEvents() {
    // Show/Hide Gemini Key
    this.toggleGeminiBtn?.addEventListener('click', () => {
      const isPassword = this.geminiKeyInput.type === 'password';
      this.geminiKeyInput.type = isPassword ? 'text' : 'password';
      this.toggleGeminiBtn.textContent = isPassword ? 'Hide' : 'Show';
    });

    // Show/Hide Groq Key
    this.toggleGroqBtn?.addEventListener('click', () => {
      const isPassword = this.groqKeyInput.type === 'password';
      this.groqKeyInput.type = isPassword ? 'text' : 'password';
      this.toggleGroqBtn.textContent = isPassword ? 'Hide' : 'Show';
    });

    // Save Settings
    this.saveBtn?.addEventListener('click', () => this.handleSave());

    // Test Gemini Connection
    this.testGeminiBtn?.addEventListener('click', () => this.handleTestGemini());

    // Test Groq Connection
    this.testGroqBtn?.addEventListener('click', () => this.handleTestGroq());

    // Dynamic Fallback status badge updates
    this.fallbackToggle?.addEventListener('change', () => this.updateFallbackStatusBadge());
    this.groqKeyInput?.addEventListener('input', () => this.updateFallbackStatusBadge());
    this.groqModelSelect?.addEventListener('change', () => this.updateFallbackStatusBadge());

    // Reset Token Statistics
    this.btnResetTokenStats?.addEventListener('click', () => this.handleResetTokenStats());
  }

  async loadSettings() {
    const settings = await getSettings();

    if (this.geminiKeyInput) this.geminiKeyInput.value = settings.geminiApiKey || '';
    if (this.groqKeyInput) this.groqKeyInput.value = settings.groqApiKey || '';
    if (this.modelSelect) this.modelSelect.value = settings.preferredModel || 'gemini-flash-lite-latest';
    if (this.groqModelSelect) this.groqModelSelect.value = settings.groqModel || 'llama-3.3-70b-versatile';
    if (this.fallbackToggle) this.fallbackToggle.checked = !!settings.enableFallback;
    if (this.maxStepsInput) this.maxStepsInput.value = settings.maxAgentSteps || 10;
    if (this.dryRunToggle) this.dryRunToggle.checked = !!settings.dryRunMode;

    // Check configuration status
    if (settings.geminiApiKey?.trim()) {
      this.onStatusChange({ connected: true, label: 'Configured' });
    } else {
      this.onStatusChange({ connected: false, label: 'Key Required' });
    }

    // Update fallback engine status badge
    this.updateFallbackStatusBadge();

    // Render token statistics
    await this.renderTokenUsage();
  }

  /**
   * Renders cumulative token usage from storage
   */
  async renderTokenUsage() {
    try {
      const usage = await getTokenUsage();

      if (this.statTotalTokens) {
        this.statTotalTokens.textContent = (usage.totalTokens || 0).toLocaleString();
      }
      if (this.statPromptTokens) {
        this.statPromptTokens.textContent = (usage.promptTokens || 0).toLocaleString();
      }
      if (this.statCandidatesTokens) {
        this.statCandidatesTokens.textContent = (usage.candidatesTokens || 0).toLocaleString();
      }
      if (this.statRequestCount) {
        this.statRequestCount.textContent = (usage.requestCount || 0).toLocaleString();
      }
    } catch (err) {
      console.warn('[Siddarth] Failed to render token usage:', err);
    }
  }

  /**
   * Clears accumulated token metrics
   */
  async handleResetTokenStats() {
    await resetTokenUsage();
    await this.renderTokenUsage();
    this.showToast('Token statistics reset to 0.');
  }

  async handleSave() {
    const geminiApiKey = this.geminiKeyInput.value.trim();
    const groqApiKey = this.groqKeyInput.value.trim();
    const preferredModel = this.modelSelect.value;
    const groqModel = this.groqModelSelect?.value || 'llama-3.3-70b-versatile';
    const enableFallback = this.fallbackToggle.checked;
    const maxAgentSteps = parseInt(this.maxStepsInput.value, 10) || 10;
    const dryRunMode = this.dryRunToggle.checked;

    await saveSettings({
      geminiApiKey,
      groqApiKey,
      preferredModel,
      groqModel,
      enableFallback,
      maxAgentSteps,
      dryRunMode
    });

    this.updateFallbackStatusBadge();
    this.showToast('Settings saved successfully!');

    if (geminiApiKey) {
      this.onStatusChange({ connected: true, label: 'Configured' });
    } else {
      this.onStatusChange({ connected: false, label: 'Key Required' });
    }
  }

  /**
   * Verifies Gemini API connectivity using a sample prompt ("Ping")
   */
  async handleTestGemini() {
    const apiKey = this.geminiKeyInput.value.trim();
    if (!apiKey) {
      this.showTestResult('Please enter a Gemini API Key first.', 'danger');
      this.onStatusChange({ connected: false, label: 'Key Required' });
      return;
    }

    const targetModel = this.modelSelect?.value || 'gemini-flash-lite-latest';
    this.setTestingState(true);
    this.showTestResult(`Sending test prompt ("Ping") to ${targetModel}...`, 'info');

    try {
      // Direct call via AIClient sending "Ping" sample prompt to Gemini 2.0 Flash-Lite
      const result = await aiClient.testConnection(apiKey, targetModel);

      if (result.success) {
        // Auto-persist verified key to storage so user doesn't have to click save separately
        await saveSettings({ geminiApiKey: apiKey, preferredModel: targetModel });
        this.showTestResult(
          `Connected successfully! Model ${result.model} replied: "${result.reply}" in ${result.latencyMs}ms (${result.tokens.totalTokens} tokens). Key saved!`,
          'success'
        );
        this.onStatusChange({ connected: true, label: 'Connected' });
        await this.renderTokenUsage();
      } else {
        this.showTestResult('Verification failed: Unexpected API response.', 'danger');
        this.onStatusChange({ connected: false, label: 'Auth Error' });
      }
    } catch (err) {
      this.showTestResult(`Verification failed: ${err.message}`, 'danger');
      this.onStatusChange({ connected: false, label: 'Auth Error' });
    } finally {
      this.setTestingState(false);
    }
  }

  setTestingState(isTesting) {
    if (this.testGeminiBtn) {
      this.testGeminiBtn.disabled = isTesting;
      this.testGeminiBtn.textContent = isTesting ? 'Testing...' : 'Test Gemini Connection';
    }
  }

  /**
   * Verifies Groq API connectivity using sample prompt ("Ping")
   */
  async handleTestGroq() {
    const apiKey = this.groqKeyInput.value.trim();
    if (!apiKey) {
      this.showGroqTestResult('Please enter a Groq API Key first.', 'danger');
      return;
    }

    this.setGroqTestingState(true);
    this.showGroqTestResult('Sending test prompt ("Ping") to Groq Llama 3.3...', 'info');

    try {
      const result = await aiClient.testGroqConnection(apiKey);

      if (result.success) {
        // Auto-persist verified key to storage
        const groqModel = this.groqModelSelect?.value || 'llama-3.3-70b-versatile';
        await saveSettings({ groqApiKey: apiKey, groqModel });
        this.updateFallbackStatusBadge();
        this.showGroqTestResult(
          `Connected successfully! Model ${result.model} replied: "${result.reply}" in ${result.latencyMs}ms (${result.tokens.totalTokens} tokens). Key saved!`,
          'success'
        );
        await this.renderTokenUsage();
      } else {
        this.showGroqTestResult('Verification failed: Unexpected API response.', 'danger');
      }
    } catch (err) {
      this.showGroqTestResult(`Verification failed: ${err.message}`, 'danger');
    } finally {
      this.setGroqTestingState(false);
    }
  }

  /**
   * Updates visual badge indicating fallback engine availability
   */
  updateFallbackStatusBadge() {
    if (!this.fallbackStatusBadge) return;
    const isEnabled = this.fallbackToggle ? this.fallbackToggle.checked : true;
    const hasKey = !!this.groqKeyInput?.value?.trim();
    const model = this.groqModelSelect?.value || 'llama-3.3-70b-versatile';

    if (isEnabled && hasKey) {
      this.fallbackStatusBadge.className = 'badge badge-accent';
      this.fallbackStatusBadge.textContent = `⚡ Fallback Active (${model})`;
    } else if (isEnabled && !hasKey) {
      this.fallbackStatusBadge.className = 'badge badge-warning';
      this.fallbackStatusBadge.textContent = 'Fallback Enabled (Groq Key Required)';
    } else {
      this.fallbackStatusBadge.className = 'badge badge-neutral';
      this.fallbackStatusBadge.textContent = 'Fallback Disabled';
    }
  }

  setGroqTestingState(isTesting) {
    if (this.testGroqBtn) {
      this.testGroqBtn.disabled = isTesting;
      this.testGroqBtn.textContent = isTesting ? 'Testing...' : 'Test Groq Connection';
    }
  }

  showTestResult(message, type = 'info') {
    if (!this.testResultBox) return;

    this.testResultBox.style.display = 'block';
    this.testResultBox.className = `alert-box alert-${type}`;
    this.testResultBox.textContent = message;
  }

  showGroqTestResult(message, type = 'info') {
    if (!this.testGroqResultBox) return;

    this.testGroqResultBox.style.display = 'block';
    this.testGroqResultBox.className = `alert-box alert-${type}`;
    this.testGroqResultBox.textContent = message;
  }

  showToast(message) {
    const toast = document.getElementById('app-toast');
    if (!toast) return;

    toast.textContent = message;
    toast.classList.add('show');
    setTimeout(() => {
      toast.classList.remove('show');
    }, 2500);
  }
}
