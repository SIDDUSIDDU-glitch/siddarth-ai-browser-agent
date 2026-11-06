/**
 * Siddarth Agent Tab Controller
 * Slice 10: Interactive Element Scanner & Visual Badge Overlay
 * Slice 11: Structured Element Selection ("Find It for Me")
 * 
 * Manages the Agent tab in the side panel:
 * - Scans visible interactive elements on the active webpage via content/scanner.js.
 * - Displays detected elements breakdown (inputs, buttons, links, selects, consequential actions).
 * - Allows searching and filtering interactive elements by role and label.
 * - Natural Language Target Search ("Find It for Me"): interprets user requests (e.g. "Where do I upload CV?")
 *   via Gemini LLM and visually highlights the matching element with a floating pointer tooltip.
 * - Triggers visual pulsing highlights on page elements from the side panel.
 * - Provides one-click badge overlay clearing.
 */

import { aiClient } from '../../utils/ai-client.js';
import { SafetyGuard } from '../../utils/safety-guard.js';
import {
  getSettings,
  getProfile,
  getActiveSession,
  saveActiveSession,
  clearActiveSession,
  getActionLogs,
  appendActionLog,
  clearActionLogs,
  exportActionLogsAsJson,
  getDryRunMode,
  setDryRunMode
} from '../../utils/storage-manager.js';

export class AgentTab {
  constructor(options = {}) {
    this.onNavigateTab = options.onNavigateTab || (() => {});
    this.scannedElements = [];
    this.activeFilter = 'all';
    this.searchQuery = '';
    this.isScanning = false;
    this.isFinding = false;
    this.activeMatchedTargetId = null;

    // Slice 12 & 13: Action Loop, Dry-Run & Audit State
    this.taskQuery = '';
    this.loopStatus = 'IDLE'; // 'IDLE' | 'PLANNING' | 'AWAITING_APPROVAL' | 'EXECUTING' | 'DONE' | 'STOPPED'
    this.currentStepNumber = 1;
    this.maxSteps = 10;
    this.currentProposal = null;
    this.stepHistory = [];
    this.userProfile = null;
    this.dryRunMode = false;
    this.auditLogs = [];
    this.auditSearchQuery = '';

    this.initElements();
    this.bindEvents();
    this.restoreSessionIfExists();
  }

  initElements() {
    // Scan & Clear control buttons
    this.btnScanElements = document.getElementById('btn-scan-elements');
    this.btnClearBadges = document.getElementById('btn-clear-badges');
    this.btnRefreshScan = document.getElementById('btn-refresh-scan');

    // Slice 12: Action Loop & Three-Button Gate UI Elements
    this.taskInput = document.getElementById('agent-task-input');
    this.btnStartTask = document.getElementById('btn-start-task');
    this.taskChips = document.querySelectorAll('.agent-task-chip');
    this.statusCard = document.getElementById('agent-loop-status-card');
    this.statusTitle = document.getElementById('agent-loop-status-title');
    this.statusSub = document.getElementById('agent-loop-status-sub');
    this.proposalCard = document.getElementById('agent-step-proposal-card');
    this.stepCounter = document.getElementById('agent-step-counter');
    this.proposalStatePill = document.getElementById('agent-proposal-state-pill');
    this.propActionType = document.getElementById('prop-action-type');
    this.propTargetBadge = document.getElementById('prop-target-badge');
    this.propTargetLabel = document.getElementById('prop-target-label');
    this.propValueRow = document.getElementById('prop-value-row');
    this.propValueText = document.getElementById('prop-value-text');
    this.propReasonText = document.getElementById('prop-reason-text');
    this.propConsequentialAlert = document.getElementById('prop-consequential-alert');
    this.btnApproveStep = document.getElementById('btn-approve-step');
    this.btnSkipStep = document.getElementById('btn-skip-step');
    this.btnStopLoop = document.getElementById('btn-stop-loop');
    this.taskDoneBox = document.getElementById('agent-task-done-box');
    this.taskDoneMessage = document.getElementById('agent-task-done-message');
    this.historyCard = document.getElementById('agent-history-card');
    this.historyCount = document.getElementById('agent-history-count');
    this.historyList = document.getElementById('agent-step-history-list');
    this.btnClearHistory = document.getElementById('btn-clear-history');

    // Slice 13: Dry-Run Mode & Audit Action Log UI Elements
    this.toggleDryRun = document.getElementById('toggle-dry-run');
    this.badgeDryRunStatus = document.getElementById('badge-dry-run-status');
    this.propDryRunBanner = document.getElementById('prop-dryrun-banner');
    this.auditCard = document.getElementById('agent-audit-card');
    this.auditCountBadge = document.getElementById('agent-audit-count-badge');
    this.auditSearchInput = document.getElementById('agent-audit-search-input');
    this.btnExportAuditLogs = document.getElementById('btn-export-audit-logs');
    this.btnClearAuditLogs = document.getElementById('btn-clear-audit-logs');
    this.auditListContainer = document.getElementById('agent-audit-list');
    this.auditEmptyText = document.getElementById('agent-audit-empty');

    // Slice 11: "Find It for Me" Elements
    this.findInput = document.getElementById('agent-find-input');
    this.btnFindElement = document.getElementById('btn-find-element');
    this.findChips = document.querySelectorAll('.agent-find-chip');
    this.findResultBox = document.getElementById('agent-find-result-box');
    this.findResultBadge = document.getElementById('find-result-badge');
    this.findResultLabel = document.getElementById('find-result-label');
    this.findResultReason = document.getElementById('find-result-reason');
    this.btnRehighlightTarget = document.getElementById('btn-rehighlight-target');
    this.btnDismissFind = document.getElementById('btn-dismiss-find');

    // Summary Card & Badges
    this.summaryCard = document.getElementById('agent-scanner-summary-card');
    this.scannedCountBadge = document.getElementById('agent-scanned-count-badge');
    this.breakdownInputs = document.getElementById('badge-count-inputs');
    this.breakdownButtons = document.getElementById('badge-count-buttons');
    this.breakdownLinks = document.getElementById('badge-count-links');
    this.breakdownSelects = document.getElementById('badge-count-selects');
    this.breakdownConsequential = document.getElementById('badge-count-consequential');

    // Filter and Search elements
    this.filterChips = document.querySelectorAll('.agent-filter-chip');
    this.searchInput = document.getElementById('agent-element-search-input');
    this.elementsListContainer = document.getElementById('agent-elements-list');
    this.emptyElementsState = document.getElementById('agent-empty-elements-state');

    // Toast / Error containers
    this.agentToast = document.getElementById('agent-toast');
    this.agentError = document.getElementById('agent-error-box');

    // Slice 16: Consequential Action Secondary Confirmation Modal
    this.consequentialModal = document.getElementById('consequential-confirm-modal');
    this.conseqModalActionName = document.getElementById('conseq-modal-action-name');
    this.conseqModalTargetLabel = document.getElementById('conseq-modal-target-label');
    this.conseqModalValueRow = document.getElementById('conseq-modal-value-row');
    this.conseqModalValue = document.getElementById('conseq-modal-value');
    this.conseqModalReason = document.getElementById('conseq-modal-reason');
    this.btnConfirmConsequential = document.getElementById('btn-confirm-consequential');
    this.btnCancelConsequential = document.getElementById('btn-cancel-consequential');
  }

  bindEvents() {
    this.btnScanElements?.addEventListener('click', () => this.handleScanElements());
    this.btnRefreshScan?.addEventListener('click', () => this.handleScanElements());
    this.btnClearBadges?.addEventListener('click', () => this.handleClearBadges());

    // Slice 16: Consequential confirmation modal events
    this.btnConfirmConsequential?.addEventListener('click', () => this.handleConfirmConsequential());
    this.btnCancelConsequential?.addEventListener('click', () => this.handleCancelConsequential());

    // Slice 12: Action Loop events
    this.btnStartTask?.addEventListener('click', () => this.handleStartTask());
    this.taskInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.handleStartTask();
      }
    });

    this.taskChips?.forEach(chip => {
      chip.addEventListener('click', () => {
        const query = chip.getAttribute('data-task');
        if (query && this.taskInput) {
          this.taskInput.value = query;
          this.handleStartTask();
        }
      });
    });

    this.btnApproveStep?.addEventListener('click', () => this.handleApproveStep());
    this.btnSkipStep?.addEventListener('click', () => this.handleSkipStep());
    this.btnStopLoop?.addEventListener('click', () => this.handleStopLoop());
    this.btnClearHistory?.addEventListener('click', () => this.clearHistory());

    // Slice 13: Dry-Run Mode & Audit Log events
    this.toggleDryRun?.addEventListener('change', (e) => this.handleToggleDryRun(e.target.checked));
    this.auditSearchInput?.addEventListener('input', (e) => {
      this.auditSearchQuery = (e.target.value || '').toLowerCase().trim();
      this.renderAuditLogs();
    });
    this.btnExportAuditLogs?.addEventListener('click', () => this.handleExportAuditLogs());
    this.btnClearAuditLogs?.addEventListener('click', () => this.handleClearAuditLogs());

    // Slice 11: Find It for Me events
    this.btnFindElement?.addEventListener('click', () => this.handleFindElement());
    this.findInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        this.handleFindElement();
      }
    });

    this.findChips?.forEach(chip => {
      chip.addEventListener('click', () => {
        const query = chip.getAttribute('data-query');
        if (query && this.findInput) {
          this.findInput.value = query;
          this.handleFindElement();
        }
      });
    });

    this.btnRehighlightTarget?.addEventListener('click', () => {
      if (this.activeMatchedTargetId) {
        const reason = this.findResultReason?.textContent || '';
        const label = this.findResultLabel?.textContent || '';
        this.highlightElement(this.activeMatchedTargetId, { reason, label });
      }
    });

    this.btnDismissFind?.addEventListener('click', () => this.dismissFindResult());

    // Search input
    this.searchInput?.addEventListener('input', (e) => {
      this.searchQuery = (e.target.value || '').toLowerCase().trim();
      this.renderFilteredList();
    });

    // Role filter chips
    this.filterChips?.forEach(chip => {
      chip.addEventListener('click', () => {
        this.filterChips.forEach(c => c.classList.remove('active'));
        chip.classList.add('active');
        this.activeFilter = chip.getAttribute('data-filter') || 'all';
        this.renderFilteredList();
      });
    });
  }

  /**
   * Identifies the active browser tab in the current or last focused window
   * @returns {Promise<chrome.tabs.Tab|null>}
   */
  async getActiveTab() {
    if (typeof chrome === 'undefined' || !chrome.tabs?.query) {
      return null;
    }

    try {
      const tabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
      return tabs?.[0] || null;
    } catch (err) {
      console.warn('[Siddarth Agent] Could not query active tab:', err);
      return null;
    }
  }

  /**
   * Checks if URL is restricted from extension script injection
   * @param {string} url
   * @returns {boolean}
   */
  isRestrictedUrl(url = '') {
    if (!url) return true;
    const lower = url.toLowerCase();
    return (
      lower.startsWith('chrome://') ||
      lower.startsWith('chrome-extension://') ||
      lower.startsWith('devtools://') ||
      lower.startsWith('edge://') ||
      lower.startsWith('about:') ||
      lower.startsWith('view-source:')
    );
  }

  /**
   * Ensures content scripts (content.css, scanner.js, highlighter.js) are injected into the tab
   * @param {number} tabId
   */
  async ensureContentScriptInjected(tabId) {
    if (typeof chrome === 'undefined' || !chrome.scripting?.executeScript) {
      return;
    }

    try {
      // First try inserting CSS
      if (chrome.scripting.insertCSS) {
        await chrome.scripting.insertCSS({
          target: { tabId },
          files: ['content/content.css']
        }).catch(() => {});
      }

      // Then inject scanner, highlighter & executor scripts
      await chrome.scripting.executeScript({
        target: { tabId },
        files: ['content/scanner.js', 'content/highlighter.js', 'content/executor.js']
      }).catch(() => {});
    } catch (err) {
      console.warn('[Siddarth Agent] Programmatic script injection note:', err);
    }
  }

  /**
   * Scans interactive elements on the current tab and displays visual badges
   */
  async handleScanElements() {
    this.hideError();
    if (this.isScanning) return;

    const tab = await this.getActiveTab();
    if (!tab || !tab.id) {
      this.showError('No active browser tab detected. Please focus a webpage and try again.');
      return;
    }

    if (this.isRestrictedUrl(tab.url)) {
      const displayUrl = (tab.url || '').split('?')[0];
      this.showError(`Cannot scan internal browser page (${displayUrl}). Please switch to a regular website or open sample-form.html.`);
      return;
    }

    this.setScanningState(true);
    this.showToast('Scanning page for interactive elements...');

    try {
      // Ensure scripts are loaded on tab
      await this.ensureContentScriptInjected(tab.id);

      // Send scan message to tab
      const response = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, { type: 'SCAN_PAGE_ELEMENTS' }, (res) => {
          if (chrome.runtime?.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(res || { success: false, error: 'No response from page scanner' });
          }
        });
      });

      if (!response || !response.success) {
        throw new Error(response?.error || 'Failed to scan elements on active page.');
      }

      this.scannedElements = response.elements || [];
      this.updateSummaryCard(this.scannedElements);
      this.renderFilteredList();

      if (this.btnClearBadges) {
        this.btnClearBadges.disabled = false;
        this.btnClearBadges.style.display = 'inline-flex';
      }

      this.showToast(`Badged ${this.scannedElements.length} interactive elements on page!`);
    } catch (err) {
      console.error('[Siddarth Agent] Scan error:', err);
      this.showError(`Scanner failed: ${err.message}`);
    } finally {
      this.setScanningState(false);
    }
  }

  /**
   * Structured Element Selection ("Find It for Me") - Slice 11
   * Translates natural language queries into an exact matching element and visually highlights it
   */
  async handleFindElement() {
    this.hideError();
    if (this.isFinding) return;

    const query = (this.findInput?.value || '').trim();
    if (!query) {
      this.showToast('Please enter what you are looking for (e.g. "Where do I upload CV?").');
      this.findInput?.focus();
      return;
    }

    const tab = await this.getActiveTab();
    if (!tab || !tab.id) {
      this.showError('No active browser tab detected. Please switch to a webpage.');
      return;
    }

    if (this.isRestrictedUrl(tab.url)) {
      const displayUrl = (tab.url || '').split('?')[0];
      this.showError(`Cannot search internal browser page (${displayUrl}). Please open a regular website or sample-form.html.`);
      return;
    }

    const settings = await getSettings();
    if (!settings.geminiApiKey?.trim() && !settings.groqApiKey?.trim()) {
      this.showError('Gemini API key is required for element selection. Please configure your key in Settings.');
      this.onNavigateTab('settings');
      return;
    }

    this.setFindingState(true);
    this.showToast(`Searching for "${query}"...`);

    try {
      // If page elements have not been scanned yet, auto-scan now
      if (!this.scannedElements || this.scannedElements.length === 0) {
        await this.ensureContentScriptInjected(tab.id);
        const scanRes = await new Promise((resolve) => {
          chrome.tabs.sendMessage(tab.id, { type: 'SCAN_PAGE_ELEMENTS' }, (res) => resolve(res));
        });
        if (scanRes?.success && Array.isArray(scanRes.elements)) {
          this.scannedElements = scanRes.elements;
          this.updateSummaryCard(this.scannedElements);
          this.renderFilteredList();
          if (this.btnClearBadges) {
            this.btnClearBadges.disabled = false;
            this.btnClearBadges.style.display = 'inline-flex';
          }
        }
      }

      if (!this.scannedElements || this.scannedElements.length === 0) {
        throw new Error('No interactive elements detected on the page to search.');
      }

      // Query AI Client for structured element selection
      const lang = settings.defaultLanguage || 'en';
      const selectionResult = await aiClient.findElementForMe({
        query,
        elements: this.scannedElements,
        language: lang
      });

      if (selectionResult.targetId) {
        this.activeMatchedTargetId = selectionResult.targetId;
        const matchedEl = this.scannedElements.find(el => el.id === selectionResult.targetId);
        const displayLabel = selectionResult.label || matchedEl?.label || `Element #${selectionResult.targetId}`;

        // Render result card
        this.renderFindResultBox({
          targetId: selectionResult.targetId,
          label: displayLabel,
          reason: selectionResult.reason,
          role: matchedEl?.role || 'element',
          isConsequential: matchedEl?.isConsequential || false
        });

        // Visually highlight element on webpage with floating pointer callout
        await this.highlightElement(selectionResult.targetId, {
          reason: selectionResult.reason,
          label: displayLabel
        });

        this.showToast(`Found element #${selectionResult.targetId}! Highlighted on page.`);
      } else {
        this.activeMatchedTargetId = null;
        this.renderFindResultBox({
          targetId: null,
          label: 'No Match Found',
          reason: selectionResult.reason || 'No matching element found for this request on the current page.',
          role: 'none',
          isConsequential: false
        });
        this.showToast('No matching element found on page.');
      }
    } catch (err) {
      console.error('[Siddarth Agent] Find element error:', err);
      this.showError(`Element search failed: ${err.message}`);
    } finally {
      this.setFindingState(false);
    }
  }

  /**
   * Renders the structured selection result card in the Agent tab
   * @param {object} param0
   */
  renderFindResultBox({ targetId, label, reason, role = '', isConsequential = false }) {
    if (!this.findResultBox) return;

    this.findResultBox.style.display = 'block';

    if (this.findResultBadge) {
      if (targetId) {
        this.findResultBadge.textContent = `#${targetId}`;
        this.findResultBadge.className = `agent-id-pill agent-pill-${role}`;
        if (isConsequential) this.findResultBadge.classList.add('agent-pill-consequential');
      } else {
        this.findResultBadge.textContent = 'None';
        this.findResultBadge.className = 'agent-id-pill';
        this.findResultBadge.style.background = '#64748b';
      }
    }

    if (this.findResultLabel) {
      this.findResultLabel.textContent = label;
    }

    if (this.findResultReason) {
      this.findResultReason.textContent = reason;
    }

    if (this.btnRehighlightTarget) {
      this.btnRehighlightTarget.style.display = targetId ? 'inline-flex' : 'none';
    }
  }

  /**
   * Dismisses find result card and clears highlight on page
   */
  async dismissFindResult() {
    if (this.findResultBox) {
      this.findResultBox.style.display = 'none';
    }
    this.activeMatchedTargetId = null;

    const tab = await this.getActiveTab();
    if (tab && tab.id) {
      try {
        chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_HIGHLIGHT' }, () => {});
      } catch {}
    }
  }

  /**
   * Clears badges and overlay from active page
   */
  async handleClearBadges() {
    this.hideError();
    this.dismissFindResult();

    const tab = await this.getActiveTab();
    if (tab && tab.id) {
      try {
        await new Promise((resolve) => {
          chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_PAGE_BADGES' }, () => resolve());
        });
        chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_HIGHLIGHT' }, () => {});
      } catch (err) {
        console.warn('[Siddarth Agent] Clear badges message failed:', err);
      }
    }

    this.scannedElements = [];
    if (this.summaryCard) {
      this.summaryCard.style.display = 'none';
    }
    if (this.elementsListContainer) {
      this.elementsListContainer.innerHTML = '';
    }
    if (this.emptyElementsState) {
      this.emptyElementsState.style.display = 'block';
    }
    if (this.btnClearBadges) {
      this.btnClearBadges.disabled = true;
      this.btnClearBadges.style.display = 'none';
    }

    this.showToast('Badges cleared from webpage');
  }

  /**
   * Highlights a single element on the webpage with optional reason callout
   * @param {number} id
   * @param {object} options
   */
  async highlightElement(id, options = {}) {
    const tab = await this.getActiveTab();
    if (!tab || !tab.id) return;

    try {
      chrome.tabs.sendMessage(tab.id, {
        type: 'HIGHLIGHT_ELEMENT',
        targetId: id,
        id,
        reason: options.reason || '',
        label: options.label || ''
      }, (res) => {
        if (res?.success) {
          this.showToast(`Focused element #${id} on page`);
        }
      });
    } catch (err) {
      console.warn('[Siddarth Agent] Highlight message failed:', err);
    }
  }

  /**
   * Updates element count and category breakdown in summary card
   * @param {Array<object>} elements
   */
  updateSummaryCard(elements) {
    if (!this.summaryCard) return;

    this.summaryCard.style.display = 'block';
    if (this.emptyElementsState) {
      this.emptyElementsState.style.display = 'none';
    }

    if (this.scannedCountBadge) {
      this.scannedCountBadge.textContent = `${elements.length} Elements Badged`;
    }

    // Compute category counts
    let inputCount = 0;
    let buttonCount = 0;
    let linkCount = 0;
    let selectCount = 0;
    let consequentialCount = 0;

    elements.forEach(item => {
      if (item.role.startsWith('input_') || item.role === 'textarea') inputCount++;
      else if (item.role.includes('button')) buttonCount++;
      else if (item.role === 'link') linkCount++;
      else if (item.role === 'select' || item.role.includes('combobox')) selectCount++;

      if (item.isConsequential) consequentialCount++;
    });

    if (this.breakdownInputs) this.breakdownInputs.textContent = String(inputCount);
    if (this.breakdownButtons) this.breakdownButtons.textContent = String(buttonCount);
    if (this.breakdownLinks) this.breakdownLinks.textContent = String(linkCount);
    if (this.breakdownSelects) this.breakdownSelects.textContent = String(selectCount);
    if (this.breakdownConsequential) this.breakdownConsequential.textContent = String(consequentialCount);
  }

  /**
   * Filters scanned elements based on active role chip and search text
   */
  renderFilteredList() {
    if (!this.elementsListContainer) return;

    let filtered = this.scannedElements;

    // Filter by category
    if (this.activeFilter === 'inputs') {
      filtered = filtered.filter(item => item.role.startsWith('input_') || item.role === 'textarea');
    } else if (this.activeFilter === 'buttons') {
      filtered = filtered.filter(item => item.role.includes('button'));
    } else if (this.activeFilter === 'links') {
      filtered = filtered.filter(item => item.role === 'link');
    } else if (this.activeFilter === 'selects') {
      filtered = filtered.filter(item => item.role === 'select' || item.role.includes('combobox'));
    } else if (this.activeFilter === 'consequential') {
      filtered = filtered.filter(item => item.isConsequential);
    }

    // Filter by search text
    if (this.searchQuery) {
      filtered = filtered.filter(item => {
        const idMatch = String(item.id) === this.searchQuery.replace(/^#/, '');
        const labelMatch = (item.label || '').toLowerCase().includes(this.searchQuery);
        const nameMatch = (item.name || '').toLowerCase().includes(this.searchQuery);
        const tagMatch = (item.tag || '').toLowerCase().includes(this.searchQuery);
        const selectorMatch = (item.selector || '').toLowerCase().includes(this.searchQuery);
        return idMatch || labelMatch || nameMatch || tagMatch || selectorMatch;
      });
    }

    this.elementsListContainer.innerHTML = '';

    if (filtered.length === 0) {
      const emptyDiv = document.createElement('div');
      emptyDiv.className = 'agent-no-match-text';
      emptyDiv.textContent = 'No matching elements found.';
      this.elementsListContainer.appendChild(emptyDiv);
      return;
    }

    // Render list items
    filtered.forEach(item => {
      const card = document.createElement('div');
      card.className = 'agent-element-row';
      if (item.isConsequential) {
        card.classList.add('agent-element-consequential');
      }

      // Badge ID chip
      const badgeIdSpan = document.createElement('span');
      badgeIdSpan.className = `agent-id-pill agent-pill-${item.role}`;
      if (item.isConsequential) badgeIdSpan.classList.add('agent-pill-consequential');
      badgeIdSpan.textContent = `#${item.id}`;

      // Element Info column
      const infoDiv = document.createElement('div');
      infoDiv.className = 'agent-element-info';

      const labelDiv = document.createElement('div');
      labelDiv.className = 'agent-element-label';
      labelDiv.textContent = item.label || `[${item.role}]`;

      const metaDiv = document.createElement('div');
      metaDiv.className = 'agent-element-meta';
      metaDiv.innerHTML = `
        <span class="agent-tag-role">${this.formatRole(item.role)}</span>
        <span class="agent-tag-selector">${this.escapeHtml(item.selector)}</span>
        ${item.isConsequential ? '<span class="agent-tag-alert">Action Warning</span>' : ''}
      `;

      infoDiv.appendChild(labelDiv);
      infoDiv.appendChild(metaDiv);

      // Highlight button
      const highlightBtn = document.createElement('button');
      highlightBtn.type = 'button';
      highlightBtn.className = 'btn btn-secondary btn-sm agent-btn-highlight';
      highlightBtn.title = `Scroll to element #${item.id} on webpage`;
      highlightBtn.innerHTML = `
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <line x1="21" y1="21" x2="16.65" y2="16.65"></line>
        </svg>
        Highlight
      `;
      highlightBtn.addEventListener('click', (e) => {
        e.stopPropagation();
        this.highlightElement(item.id, { label: item.label });
      });

      card.appendChild(badgeIdSpan);
      card.appendChild(infoDiv);
      card.appendChild(highlightBtn);

      // Clicking row also highlights
      card.addEventListener('click', () => {
        this.highlightElement(item.id, { label: item.label });
      });

      this.elementsListContainer.appendChild(card);
    });
  }

  formatRole(role = '') {
    if (role.startsWith('input_')) {
      return `Input (${role.replace('input_', '')})`;
    }
    if (role === 'submit_button') return 'Submit Button';
    if (role === 'button') return 'Button';
    if (role === 'link') return 'Link';
    if (role === 'select') return 'Dropdown';
    if (role === 'textarea') return 'Multiline Text';
    return role;
  }

  setScanningState(isScanning) {
    this.isScanning = isScanning;
    if (this.btnScanElements) {
      this.btnScanElements.disabled = isScanning;
      if (isScanning) {
        this.btnScanElements.innerHTML = `
          <span class="icon">⏳</span>
          Scanning Page Elements...
        `;
      } else {
        this.btnScanElements.innerHTML = `
          <span class="icon">🔍</span>
          Scan & Show Numbered Badges
        `;
      }
    }
  }

  setFindingState(isFinding) {
    this.isFinding = isFinding;
    if (this.btnFindElement) {
      this.btnFindElement.disabled = isFinding;
      if (isFinding) {
        this.btnFindElement.innerHTML = `
          <span class="icon">⏳</span>
          Searching...
        `;
      } else {
        this.btnFindElement.innerHTML = `
          <span class="icon">🎯</span>
          Find & Highlight
        `;
      }
    }
  }

  showToast(message) {
    if (!this.agentToast) return;
    this.agentToast.textContent = message;
    this.agentToast.classList.add('visible');
    clearTimeout(this.toastTimeout);
    this.toastTimeout = setTimeout(() => {
      this.agentToast.classList.remove('visible');
    }, 3200);
  }

  showError(message) {
    if (!this.agentError) return;
    this.agentError.textContent = `⚠️ ${message}`;
    this.agentError.style.display = 'block';
  }

  hideError() {
    if (this.agentError) {
      this.agentError.style.display = 'none';
      this.agentError.textContent = '';
    }
  }

  escapeHtml(str = '') {
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  // =========================================================================
  // Slice 12: Human-in-the-Loop Action Loop & Three-Button Gate Methods
  // =========================================================================

  /**
   * Restores active task session and historical audit logs from storage
   * (e.g. after side panel reopening or service worker suspension)
   */
  async restoreSessionIfExists() {
    try {
      // 1. Restore dry-run setting
      const dryRunPref = await getDryRunMode();
      this.dryRunMode = dryRunPref;
      if (this.toggleDryRun) {
        this.toggleDryRun.checked = this.dryRunMode;
      }
      if (this.badgeDryRunStatus) {
        if (this.dryRunMode) {
          this.badgeDryRunStatus.className = 'badge badge-dryrun';
          this.badgeDryRunStatus.textContent = 'Dry-Run Active';
        } else {
          this.badgeDryRunStatus.className = 'badge badge-neutral';
          this.badgeDryRunStatus.textContent = 'Execution Active';
        }
      }

      // 2. Restore active session
      const session = await getActiveSession();
      if (session && session.task && session.loopStatus && session.loopStatus !== 'DONE' && session.loopStatus !== 'STOPPED') {
        this.taskQuery = session.task;
        if (this.taskInput) this.taskInput.value = session.task;
        this.currentStepNumber = session.currentStepNumber || 1;
        this.stepHistory = session.stepHistory || [];
        if (session.dryRunMode !== undefined) {
          this.dryRunMode = Boolean(session.dryRunMode);
          if (this.toggleDryRun) this.toggleDryRun.checked = this.dryRunMode;
        }
        this.renderHistory();

        if (session.currentProposal) {
          this.currentProposal = session.currentProposal;
          this.loopStatus = 'AWAITING_APPROVAL';
          this.renderProposalCard(this.currentProposal);

          // Re-highlight target element on active tab
          if (this.currentProposal.targetId) {
            this.highlightElement(this.currentProposal.targetId, {
              reason: this.currentProposal.reason,
              label: this.currentProposal.label
            });
          }
        }
      }

      // 3. Load persistent historical audit logs
      await this.loadAuditLogs();
    } catch (err) {
      console.warn('[Siddarth Agent] Could not restore active session or audit logs:', err);
    }
  }

  /**
   * Starts a new user-guided browser automation task
   * @param {string|null} customTask
   */
  async handleStartTask(customTask = null) {
    this.hideError();
    if (this.loopStatus === 'PLANNING' || this.loopStatus === 'EXECUTING') {
      return;
    }

    const task = (customTask || this.taskInput?.value || '').trim();
    if (!task) {
      this.showToast('Please describe the task you want Siddarth to perform on this page.');
      this.taskInput?.focus();
      return;
    }

    const tab = await this.getActiveTab();
    if (!tab || !tab.id) {
      this.showError('No active browser tab detected. Please focus a webpage and try again.');
      return;
    }

    // Deterministic Safety Rail: Hard block on banking, payments, and UPI domains (Slice 16)
    if (SafetyGuard.isFinancialUrl(tab.url)) {
      this.showError('Automated actions are disabled on banking/financial domains.');
      this.setLoopStatus('IDLE');
      return;
    }

    if (this.isRestrictedUrl(tab.url)) {
      const displayUrl = (tab.url || '').split('?')[0];
      this.showError(`Cannot automate internal browser page (${displayUrl}). Please open a regular website or sample-form.html.`);
      return;
    }

    const settings = await getSettings();
    if (!settings.geminiApiKey?.trim() && !settings.groqApiKey?.trim()) {
      this.showError('API Key is required for agent reasoning. Please configure your key in Settings.');
      this.onNavigateTab('settings');
      return;
    }

    // Load profile memory to enable personalized form-filling
    try {
      this.userProfile = await getProfile();
    } catch {
      this.userProfile = null;
    }

    this.maxSteps = settings.maxAgentSteps || 10;
    this.taskQuery = task;
    this.currentStepNumber = 1;
    this.stepHistory = [];
    this.currentProposal = null;

    if (this.taskDoneBox) this.taskDoneBox.style.display = 'none';
    if (this.proposalCard) this.proposalCard.style.display = 'none';
    this.renderHistory();

    await this.saveSession();
    this.showToast(`Starting task: "${task.length > 28 ? task.slice(0, 28) + '...' : task}"`);

    await this.planStep();
  }

  /**
   * Plans the next single atomic step using Gemini Flash-Lite and scanned elements
   */
  async planStep() {
    this.setLoopStatus('PLANNING', `Planning step ${this.currentStepNumber}...`);

    const tab = await this.getActiveTab();
    if (!tab || !tab.id) {
      this.showError('Browser tab was lost during task planning.');
      this.setLoopStatus('IDLE');
      return;
    }

    try {
      // Ensure scripts are injected and get fresh elements
      await this.ensureContentScriptInjected(tab.id);

      const scanRes = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, { type: 'SCAN_PAGE_ELEMENTS' }, (res) => {
          if (chrome.runtime?.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(res || { success: false, error: 'No scan response' });
          }
        });
      });

      if (scanRes?.success && Array.isArray(scanRes.elements)) {
        this.scannedElements = scanRes.elements;
        this.updateSummaryCard(this.scannedElements);
        this.renderFilteredList();
      }

      if (!this.scannedElements || this.scannedElements.length === 0) {
        throw new Error('No interactive elements detected on the active webpage.');
      }

      const settings = await getSettings();
      const lang = settings.defaultLanguage || 'en';

      // Call AI planner for 1 atomic action
      const proposal = await aiClient.planNextStep({
        task: this.taskQuery,
        elements: this.scannedElements,
        stepHistory: this.stepHistory,
        profile: this.userProfile,
        language: lang
      });

      if (!proposal) {
        throw new Error('Agent failed to generate a valid step proposal.');
      }

      // Check if task is completed
      if (proposal.action === 'done') {
        await this.handleTaskDone(proposal.reason);
        return;
      }

      // Deterministic Safety Rail: Intercept actions targeting sensitive credential fields (Slice 16)
      const targetEl = proposal.targetId ? this.scannedElements.find(el => el.id === proposal.targetId) : null;
      if (targetEl && SafetyGuard.isSensitiveField(targetEl)) {
        this.showError('Security Guard: Automated actions on password, PIN, OTP, or credit card fields are strictly prohibited.');
        this.setLoopStatus('STOPPED', 'Terminated: Sensitive field protected');
        return;
      }

      // Store proposal & await user approval
      this.currentProposal = proposal;
      this.setLoopStatus('AWAITING_APPROVAL');
      this.renderProposalCard(proposal);

      // Visually highlight the target element on the webpage
      if (proposal.targetId) {
        await this.highlightElement(proposal.targetId, {
          reason: proposal.reason,
          label: proposal.label
        });
      }

      await this.saveSession();
    } catch (err) {
      console.error('[Siddarth Agent] Plan step error:', err);
      this.showError(`Planning failed: ${err.message}`);
      this.setLoopStatus('IDLE');
    }
  }

  /**
   * Renders the proposed action card and configures the Three-Button Gate
   * @param {object} proposal
   */
  renderProposalCard(proposal) {
    if (!this.proposalCard) return;

    this.proposalCard.style.display = 'block';
    if (this.statusCard) this.statusCard.style.display = 'none';

    // Step counter
    if (this.stepCounter) {
      this.stepCounter.textContent = `Step ${this.currentStepNumber} of ${this.maxSteps}`;
    }

    // Action pill
    if (this.propActionType) {
      const act = (proposal.action || 'click').toLowerCase();
      this.propActionType.textContent = act.toUpperCase();
      this.propActionType.className = `agent-action-type-pill pill-${act}`;
    }

    // Target badge & label
    if (this.propTargetBadge) {
      if (proposal.targetId) {
        this.propTargetBadge.textContent = `#${proposal.targetId}`;
        this.propTargetBadge.style.display = 'inline-flex';
      } else {
        this.propTargetBadge.style.display = 'none';
      }
    }

    if (this.propTargetLabel) {
      this.propTargetLabel.textContent = proposal.label || (proposal.targetId ? `Element #${proposal.targetId}` : 'Web Page');
    }

    // Value preview row
    if (this.propValueRow) {
      if (proposal.value !== null && proposal.value !== undefined && String(proposal.value).trim() !== '') {
        this.propValueRow.style.display = 'block';
        if (this.propValueText) {
          this.propValueText.textContent = `"${String(proposal.value)}"`;
        }
      } else {
        this.propValueRow.style.display = 'none';
      }
    }

    // Reasoning
    if (this.propReasonText) {
      this.propReasonText.textContent = proposal.reason || 'Proposed atomic action.';
    }

    // Consequential Warning Box
    if (this.propConsequentialAlert) {
      if (proposal.isConsequential) {
        this.propConsequentialAlert.style.display = 'flex';
        this.proposalCard.classList.add('consequential-active');
      } else {
        this.propConsequentialAlert.style.display = 'none';
        this.proposalCard.classList.remove('consequential-active');
      }
    }

    // Reset button states
    if (this.btnApproveStep) this.btnApproveStep.disabled = false;
    if (this.btnSkipStep) this.btnSkipStep.disabled = false;
    if (this.btnStopLoop) this.btnStopLoop.disabled = false;

    // Slice 13: Dry-run mode notice and button labeling
    if (this.propDryRunBanner) {
      this.propDryRunBanner.style.display = this.dryRunMode ? 'block' : 'none';
    }
    if (this.btnApproveStep) {
      this.btnApproveStep.innerHTML = this.dryRunMode
        ? `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg><span>Approve & Simulate</span>`
        : `<svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5"><polyline points="20 6 9 17 4 12"></polyline></svg><span>Approve & Execute</span>`;
    }
  }

  /**
   * User clicked "Approve & Execute" (or "Approve & Simulate")
   * Dispatches the approved action to content/executor.js and plans next step
   * @param {boolean} [forceConfirmed=false] True when secondary confirmation modal was accepted
   */
  async handleApproveStep(forceConfirmed = false) {
    this.hideError();
    if (this.loopStatus !== 'AWAITING_APPROVAL' || !this.currentProposal) {
      return;
    }

    const proposal = this.currentProposal;
    const targetEl = proposal.targetId ? this.scannedElements.find(el => el.id === proposal.targetId) : null;

    // Slice 16: Consequential Action Secondary Confirmation Check
    const isConsequential = SafetyGuard.isConsequentialAction(proposal, targetEl);
    if (isConsequential && !forceConfirmed) {
      this.showConsequentialModal(proposal, targetEl);
      return;
    }
    this.hideConsequentialModal();

    const tab = await this.getActiveTab();
    if (!tab || !tab.id) {
      this.showError('No active browser tab found to execute action.');
      return;
    }

    const isDry = this.dryRunMode;
    this.setLoopStatus('EXECUTING', `${isDry ? 'Simulating' : 'Executing'} ${proposal.action} on #${proposal.targetId || 'page'}...`);

    try {
      // Send synthetic action execution request to content/executor.js (with dryRun flag)
      const execResult = await new Promise((resolve) => {
        chrome.tabs.sendMessage(tab.id, {
          type: 'EXECUTE_ACTION',
          payload: {
            action: proposal.action,
            targetId: proposal.targetId,
            value: proposal.value,
            dryRun: isDry
          }
        }, (res) => {
          if (chrome.runtime?.lastError) {
            resolve({ success: false, error: chrome.runtime.lastError.message });
          } else {
            resolve(res || { success: false, error: 'No response from action executor' });
          }
        });
      });

      if (!execResult || !execResult.success) {
        throw new Error(execResult?.error || 'Action execution failed on webpage.');
      }

      const stepStatus = isDry ? 'dryrun' : 'approved';

      // Record successfully executed step
      this.stepHistory.push({
        stepNumber: this.currentStepNumber,
        action: proposal.action,
        targetId: proposal.targetId,
        value: proposal.value,
        label: proposal.label,
        reason: proposal.reason,
        status: stepStatus,
        isDryRun: isDry,
        result: execResult,
        timestamp: Date.now()
      });

      // Append to persistent audit log (Slice 13)
      try {
        let domain = '';
        try { domain = new URL(tab.url).hostname || ''; } catch {}
        await appendActionLog({
          task: this.taskQuery,
          stepNumber: this.currentStepNumber,
          action: proposal.action,
          targetId: proposal.targetId,
          value: proposal.value,
          label: proposal.label,
          reason: proposal.reason,
          status: stepStatus,
          isDryRun: isDry,
          url: tab.url || '',
          domain,
          timestamp: Date.now()
        });
        await this.loadAuditLogs();
      } catch (logErr) {
        console.warn('[Siddarth Agent] Could not log audit action:', logErr);
      }

      this.renderHistory();
      this.showToast(isDry
        ? `🛡️ Step ${this.currentStepNumber} simulated (Dry-Run)!`
        : `✓ Step ${this.currentStepNumber} executed!`);

      // Check if step completed the task
      if (proposal.action === 'done') {
        await this.handleTaskDone(proposal.reason);
        return;
      }

      // Advance step counter
      this.currentStepNumber++;

      if (this.currentStepNumber > this.maxSteps) {
        await this.handleTaskDone(`Maximum step limit (${this.maxSteps}) reached. Task paused.`);
        return;
      }

      // Brief delay to allow webpage DOM / frameworks (React/Vue) to re-render
      await new Promise(r => setTimeout(r, 450));

      // Plan next atomic step
      await this.planStep();
    } catch (err) {
      console.error('[Siddarth Agent] Execution error:', err);
      this.showError(`Execution error: ${err.message}`);
      // Restore proposal card so user can retry or skip
      this.setLoopStatus('AWAITING_APPROVAL');
      if (this.currentProposal) {
        this.renderProposalCard(this.currentProposal);
      }
    }
  }

  /**
   * User clicked "Skip"
   * Bypasses the proposed step, notifies LLM via step history, and plans next step
   */
  async handleSkipStep() {
    this.hideError();
    if (this.loopStatus !== 'AWAITING_APPROVAL' || !this.currentProposal) {
      return;
    }

    const proposal = this.currentProposal;
    const tab = await this.getActiveTab();

    // Record skipped step
    this.stepHistory.push({
      stepNumber: this.currentStepNumber,
      action: proposal.action,
      targetId: proposal.targetId,
      value: proposal.value,
      label: proposal.label,
      reason: proposal.reason,
      status: 'skipped',
      isDryRun: this.dryRunMode,
      timestamp: Date.now()
    });

    // Append to persistent audit log (Slice 13)
    try {
      let domain = '';
      try { domain = new URL(tab?.url || '').hostname || ''; } catch {}
      await appendActionLog({
        task: this.taskQuery,
        stepNumber: this.currentStepNumber,
        action: proposal.action,
        targetId: proposal.targetId,
        value: proposal.value,
        label: proposal.label,
        reason: proposal.reason,
        status: 'skipped',
        isDryRun: this.dryRunMode,
        url: tab?.url || '',
        domain,
        timestamp: Date.now()
      });
      await this.loadAuditLogs();
    } catch (logErr) {
      console.warn('[Siddarth Agent] Could not log audit action:', logErr);
    }

    this.renderHistory();
    this.showToast(`Step ${this.currentStepNumber} skipped.`);

    // Clear highlight on page
    if (tab?.id) {
      try {
        chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_HIGHLIGHT' }, () => {});
      } catch {}
    }

    this.currentStepNumber++;

    if (this.currentStepNumber > this.maxSteps) {
      await this.handleTaskDone(`Maximum step limit (${this.maxSteps}) reached. Task paused.`);
      return;
    }

    // Plan next step with skipped history
    await this.planStep();
  }

  /**
   * User clicked "Stop"
   * Halts the action loop immediately and restores idle state
   */
  async handleStopLoop() {
    this.hideError();
    this.hideConsequentialModal();
    this.setLoopStatus('STOPPED');

    if (this.proposalCard) this.proposalCard.style.display = 'none';
    if (this.statusCard) this.statusCard.style.display = 'none';

    // Clear active highlight on page
    const tab = await this.getActiveTab();
    if (tab?.id) {
      try {
        chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_HIGHLIGHT' }, () => {});
      } catch {}
    }

    await clearActiveSession();
    this.showToast('Agent task stopped by user.');
  }

  /**
   * Displays the secondary confirmation modal for consequential operations (Slice 16)
   * @param {object} proposal
   * @param {object|null} targetEl
   */
  showConsequentialModal(proposal, targetEl = null) {
    if (!this.consequentialModal) return;

    const actionText = (proposal.action || 'click').toUpperCase();
    const targetText = proposal.label || (proposal.targetId ? `Element #${proposal.targetId}` : 'Web Page');

    if (this.conseqModalActionName) {
      this.conseqModalActionName.textContent = `${actionText} (${targetText})`;
    }

    if (this.conseqModalTargetLabel) {
      this.conseqModalTargetLabel.textContent = targetText;
    }

    if (this.conseqModalValueRow && this.conseqModalValue) {
      if (proposal.value !== null && proposal.value !== undefined && String(proposal.value).trim() !== '') {
        this.conseqModalValueRow.style.display = 'flex';
        this.conseqModalValue.textContent = `"${String(proposal.value)}"`;
      } else {
        this.conseqModalValueRow.style.display = 'none';
      }
    }

    if (this.conseqModalReason) {
      this.conseqModalReason.textContent = proposal.reason || 'Consequential operation on live webpage.';
    }

    this.consequentialModal.style.display = 'flex';
  }

  /**
   * Hides the secondary confirmation modal
   */
  hideConsequentialModal() {
    if (this.consequentialModal) {
      this.consequentialModal.style.display = 'none';
    }
  }

  /**
   * User explicitly confirmed consequential action in secondary modal
   */
  async handleConfirmConsequential() {
    this.hideConsequentialModal();
    await this.handleApproveStep(true);
  }

  /**
   * User cancelled consequential action in secondary modal
   */
  handleCancelConsequential() {
    this.hideConsequentialModal();
    this.showToast('Consequential action cancelled. You can skip this step or modify the task.');
  }

  /**
   * Handles task completion
   * @param {string} message
   */
  async handleTaskDone(message = 'Task completed successfully.') {
    this.setLoopStatus('DONE');

    if (this.proposalCard) this.proposalCard.style.display = 'none';
    if (this.statusCard) this.statusCard.style.display = 'none';

    if (this.taskDoneBox) {
      this.taskDoneBox.style.display = 'block';
      if (this.taskDoneMessage) {
        this.taskDoneMessage.textContent = message;
      }
    }

    // Clear highlight on page
    const tab = await this.getActiveTab();
    if (tab?.id) {
      try {
        chrome.tabs.sendMessage(tab.id, { type: 'CLEAR_HIGHLIGHT' }, () => {});
      } catch {}
    }

    await clearActiveSession();
    this.showToast('🎉 Task completed successfully!');
  }

  /**
   * Updates UI state according to loop status
   * @param {string} status 'IDLE' | 'PLANNING' | 'AWAITING_APPROVAL' | 'EXECUTING' | 'DONE' | 'STOPPED'
   * @param {string|null} detailMessage
   */
  setLoopStatus(status, detailMessage = null) {
    this.loopStatus = status;

    if (status === 'PLANNING' || status === 'EXECUTING') {
      if (this.statusCard) {
        this.statusCard.style.display = 'flex';
        if (this.statusTitle) {
          this.statusTitle.textContent = status === 'PLANNING' ? 'Planning Next Step...' : 'Executing Action on Page...';
        }
        if (this.statusSub && detailMessage) {
          this.statusSub.textContent = detailMessage;
        }
      }
      if (this.proposalCard) {
        this.proposalCard.style.display = 'none';
      }
    } else if (status === 'AWAITING_APPROVAL') {
      if (this.statusCard) this.statusCard.style.display = 'none';
      if (this.proposalCard) this.proposalCard.style.display = 'block';
    } else {
      if (this.statusCard) this.statusCard.style.display = 'none';
    }
  }

  /**
   * Persists current loop session state to storage
   */
  async saveSession() {
    try {
      await saveActiveSession({
        task: this.taskQuery,
        loopStatus: this.loopStatus,
        currentStepNumber: this.currentStepNumber,
        currentProposal: this.currentProposal,
        stepHistory: this.stepHistory,
        dryRunMode: this.dryRunMode,
        timestamp: Date.now()
      });
    } catch (err) {
      console.warn('[Siddarth Agent] Could not save active session:', err);
    }
  }

  /**
   * Renders the session step history list
   */
  renderHistory() {
    if (!this.historyCard || !this.historyList) return;

    if (!this.stepHistory || this.stepHistory.length === 0) {
      this.historyCard.style.display = 'none';
      this.historyList.innerHTML = '';
      return;
    }

    this.historyCard.style.display = 'block';
    if (this.historyCount) {
      this.historyCount.textContent = String(this.stepHistory.length);
    }

    this.historyList.innerHTML = '';

    this.stepHistory.forEach(step => {
      const item = document.createElement('div');
      const isDry = step.status === 'dryrun' || step.isDryRun;
      const isApproved = step.status === 'approved';
      item.className = `agent-history-item ${isDry ? 'history-dryrun' : isApproved ? 'history-approved' : 'history-skipped'}`;

      const stepBadge = document.createElement('span');
      stepBadge.className = 'history-step-badge';
      stepBadge.textContent = `#${step.stepNumber}`;

      const bodyDiv = document.createElement('div');
      bodyDiv.className = 'history-item-body';

      const actionText = (step.action || '').toUpperCase();
      const valText = step.value ? ` "${step.value}"` : '';
      const targetText = step.label || (step.targetId ? `Element #${step.targetId}` : '');
      bodyDiv.textContent = `${actionText}${valText} ${targetText ? `→ ${targetText}` : ''}`;
      bodyDiv.title = step.reason || '';

      const statusTag = document.createElement('span');
      statusTag.className = `history-status-tag ${isDry ? 'tag-dryrun' : isApproved ? 'tag-approved' : 'tag-skipped'}`;
      statusTag.textContent = isDry ? 'Simulated' : isApproved ? 'Approved' : 'Skipped';

      item.appendChild(stepBadge);
      item.appendChild(bodyDiv);
      item.appendChild(statusTag);

      this.historyList.appendChild(item);
    });
  }

  /**
   * Clears the session history
   */
  async clearHistory() {
    this.stepHistory = [];
    this.renderHistory();
    await this.saveSession();
    this.showToast('Session history cleared.');
  }

  // =========================================================================
  // Slice 13: Dry-Run Mode & Persistent Audit Action Log Methods
  // =========================================================================

  /**
   * Toggles Dry-Run Simulation Mode
   * @param {boolean} enabled
   */
  async handleToggleDryRun(enabled) {
    this.dryRunMode = Boolean(enabled);
    await setDryRunMode(this.dryRunMode);

    if (this.toggleDryRun) {
      this.toggleDryRun.checked = this.dryRunMode;
    }

    if (this.badgeDryRunStatus) {
      if (this.dryRunMode) {
        this.badgeDryRunStatus.className = 'badge badge-dryrun';
        this.badgeDryRunStatus.textContent = 'Dry-Run Active';
      } else {
        this.badgeDryRunStatus.className = 'badge badge-neutral';
        this.badgeDryRunStatus.textContent = 'Execution Active';
      }
    }

    // Update active proposal card if visible
    if (this.currentProposal) {
      this.renderProposalCard(this.currentProposal);
    }

    await this.saveSession();

    this.showToast(this.dryRunMode
      ? 'Dry-Run Mode ON: Actions will be simulated without clicking or typing.'
      : 'Dry-Run Mode OFF: Real actions will be executed on webpage upon approval.');
  }

  /**
   * Loads historical audit logs from storage and displays them
   */
  async loadAuditLogs() {
    try {
      this.auditLogs = await getActionLogs();
      this.renderAuditLogs();
    } catch (err) {
      console.warn('[Siddarth Agent] Failed to load audit logs:', err);
    }
  }

  /**
   * Renders the persistent action audit log list with optional search query filter
   */
  renderAuditLogs() {
    if (!this.auditListContainer) return;

    const logs = this.auditLogs || [];
    if (this.auditCountBadge) {
      this.auditCountBadge.textContent = `${logs.length} ${logs.length === 1 ? 'Event' : 'Events'}`;
    }

    let filtered = logs;
    if (this.auditSearchQuery) {
      filtered = logs.filter(item => {
        const query = this.auditSearchQuery;
        const actMatch = (item.action || '').toLowerCase().includes(query);
        const taskMatch = (item.task || '').toLowerCase().includes(query);
        const labelMatch = (item.label || '').toLowerCase().includes(query);
        const valueMatch = String(item.value || '').toLowerCase().includes(query);
        const statusMatch = (item.status || '').toLowerCase().includes(query);
        const domainMatch = (item.domain || '').toLowerCase().includes(query);
        return actMatch || taskMatch || labelMatch || valueMatch || statusMatch || domainMatch;
      });
    }

    this.auditListContainer.innerHTML = '';

    if (filtered.length === 0) {
      if (this.auditEmptyText) {
        this.auditEmptyText.style.display = 'block';
        this.auditEmptyText.textContent = logs.length === 0
          ? 'No actions recorded yet. Approved and simulated actions will appear here.'
          : 'No log entries match your filter.';
      }
      return;
    }

    if (this.auditEmptyText) {
      this.auditEmptyText.style.display = 'none';
    }

    // Render newest logs first
    const reversed = [...filtered].reverse();
    reversed.forEach(item => {
      const row = document.createElement('div');
      const isDry = item.status === 'dryrun' || item.isDryRun;
      const isApproved = item.status === 'approved';
      const statusClass = isDry ? 'audit-dryrun' : isApproved ? 'audit-approved' : 'audit-skipped';
      row.className = `agent-audit-item ${statusClass}`;

      // Header row: action badge + target + timestamp
      const headerRow = document.createElement('div');
      headerRow.className = 'agent-audit-header-row';

      const titleDiv = document.createElement('div');
      titleDiv.className = 'agent-audit-title';

      const actTag = document.createElement('span');
      actTag.className = `agent-action-type-pill pill-${(item.action || 'click').toLowerCase()}`;
      actTag.textContent = (item.action || '').toUpperCase();

      const targetText = document.createElement('span');
      targetText.textContent = item.targetId ? `#${item.targetId} ${item.label ? `(${item.label})` : ''}` : (item.label || 'Webpage');

      titleDiv.appendChild(actTag);
      titleDiv.appendChild(targetText);

      const timeSpan = document.createElement('span');
      timeSpan.className = 'agent-audit-time';
      if (item.timestamp) {
        const d = new Date(item.timestamp);
        timeSpan.textContent = d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
      }

      headerRow.appendChild(titleDiv);
      headerRow.appendChild(timeSpan);

      // Details row
      const detailsDiv = document.createElement('div');
      detailsDiv.className = 'agent-audit-details';
      const valStr = item.value ? `Value: "${item.value}" | ` : '';
      const statusLabel = isDry ? 'Simulated (Dry-Run)' : isApproved ? 'Executed' : 'Skipped';
      detailsDiv.textContent = `${valStr}Status: ${statusLabel}${item.reason ? ` — ${item.reason}` : ''}`;

      // Domain row
      const metaRow = document.createElement('div');
      metaRow.className = 'agent-audit-domain';
      metaRow.textContent = item.domain ? `🌐 ${item.domain}` : (item.task ? `Task: ${item.task}` : '');

      row.appendChild(headerRow);
      row.appendChild(detailsDiv);
      if (item.domain || item.task) {
        row.appendChild(metaRow);
      }

      this.auditListContainer.appendChild(row);
    });
  }

  /**
   * Exports historical action audit logs as a downloadable JSON file
   */
  async handleExportAuditLogs() {
    try {
      const jsonStr = await exportActionLogsAsJson();
      if (typeof document !== 'undefined') {
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `siddarth-audit-logs-${Date.now()}.json`;
        document.body?.appendChild(a);
        a.click?.();
        if (typeof a.remove === 'function') {
          a.remove();
        } else {
          a.parentNode?.removeChild?.(a);
        }
        URL.revokeObjectURL(url);
      }
      this.showToast('Audit log JSON exported successfully!');
    } catch (err) {
      console.warn('[Siddarth Agent] Export audit log failed:', err);
      this.showError(`Failed to export audit logs: ${err.message}`);
    }
  }

  /**
   * Clears the historical audit log
   */
  async handleClearAuditLogs() {
    try {
      await clearActionLogs();
      this.auditLogs = [];
      this.renderAuditLogs();
      this.showToast('Audit action logs cleared.');
    } catch (err) {
      this.showError(`Failed to clear audit logs: ${err.message}`);
    }
  }
}

