/**
 * Siddarth Local Profile & Skills Tab Controller
 * Slice 14: Local Profile Memory & Auto-Form Filling
 * Slice 15: Reusable One-Click Skills Import & Export
 * 
 * - Manages user profile data (Name, Email, Phone, College, Degree, Skills, Links, Bio, Preferred Tone).
 * - Enforces zero-cloud privacy: all profile data stored strictly in chrome.storage.local.
 * - Computes profile completeness dynamically.
 * - Powers one-click "Fill Form from Profile" action via Agent Action Loop.
 * - Skills Manager:
 *   - Built-in prompt recipes: Exam notes, Explain in Hinglish, Reply to this email politely, Fill form from profile.
 *   - Custom user skill recipe creation and editing.
 *   - 1-click execution on active page (routed to Chat or Agent).
 *   - JSON Export and Import with schema validation and merge support.
 */

import {
  getProfile,
  saveProfile,
  clearProfile,
  getSkills,
  saveSkills,
  addOrUpdateSkill,
  deleteSkill,
  resetSkillsToDefault,
  exportSkillsAsJson,
  importSkillsFromJson
} from '../../utils/storage-manager.js';

export class ProfileTab {
  constructor(options = {}) {
    this.onNavigateTab = options.onNavigateTab || (() => {});
    this.onFillFormFromProfile = options.onFillFormFromProfile || (() => {});
    this.onRunSkill = options.onRunSkill || (() => {});
    this.profileData = null;
    this.skills = [];
    this.editingSkillId = null;

    this.initElements();
    this.bindEvents();
    this.loadProfile();
    this.loadSkills();
  }

  initElements() {
    // Profile Elements
    this.inputName = document.getElementById('profile-name');
    this.inputEmail = document.getElementById('profile-email');
    this.inputPhone = document.getElementById('profile-phone');
    this.inputCollege = document.getElementById('profile-college');
    this.inputDegree = document.getElementById('profile-degree');
    this.inputSkills = document.getElementById('profile-skills');
    this.inputLinks = document.getElementById('profile-links');
    this.inputBio = document.getElementById('profile-bio');
    this.selectTone = document.getElementById('profile-tone');

    this.btnSave = document.getElementById('btn-save-profile');
    this.btnClear = document.getElementById('btn-clear-profile');
    this.btnFillForm = document.getElementById('btn-fill-form-profile');

    this.statusBox = document.getElementById('profile-status-box');
    this.completenessBar = document.getElementById('profile-completeness-bar');
    this.completenessText = document.getElementById('profile-completeness-text');

    // Slice 15: Skills Manager Elements
    this.btnCreateSkill = document.getElementById('btn-create-skill');
    this.btnExportSkills = document.getElementById('btn-export-skills');
    this.btnImportSkills = document.getElementById('btn-import-skills');
    this.fileImportSkills = document.getElementById('file-import-skills');
    this.btnResetSkills = document.getElementById('btn-reset-skills');

    this.skillEditorCard = document.getElementById('skill-editor-card');
    this.skillEditorTitle = document.getElementById('skill-editor-title');
    this.skillInputName = document.getElementById('skill-input-name');
    this.skillInputDesc = document.getElementById('skill-input-desc');
    this.skillInputTarget = document.getElementById('skill-input-target');
    this.skillInputPrompt = document.getElementById('skill-input-prompt');
    this.btnSaveSkill = document.getElementById('btn-save-skill');
    this.btnCancelSkill = document.getElementById('btn-cancel-skill');

    this.skillsStatusBox = document.getElementById('skills-status-box');
    this.skillsListContainer = document.getElementById('skills-list-container');
  }

  bindEvents() {
    // Profile Actions
    this.btnSave?.addEventListener('click', () => this.handleSaveProfile());
    this.btnClear?.addEventListener('click', () => this.handleClearProfile());
    this.btnFillForm?.addEventListener('click', () => this.handleFillFormFromProfile());

    // Profile Completeness Listeners
    const inputs = [
      this.inputName,
      this.inputEmail,
      this.inputPhone,
      this.inputCollege,
      this.inputDegree,
      this.inputSkills,
      this.inputLinks,
      this.inputBio
    ];

    inputs.forEach(input => {
      input?.addEventListener('input', () => this.updateCompleteness());
    });

    // Skills Toolbar
    this.btnCreateSkill?.addEventListener('click', () => this.handleOpenSkillEditor());
    this.btnCancelSkill?.addEventListener('click', () => this.handleCloseSkillEditor());
    this.btnSaveSkill?.addEventListener('click', () => this.handleSaveSkill());
    this.btnExportSkills?.addEventListener('click', () => this.handleExportSkills());
    this.btnImportSkills?.addEventListener('click', () => this.fileImportSkills?.click());
    this.fileImportSkills?.addEventListener('change', (e) => this.handleImportSkillsFile(e));
    this.btnResetSkills?.addEventListener('click', () => this.handleResetSkills());

    // Skills List Event Delegation (Run, Edit, Delete)
    this.skillsListContainer?.addEventListener('click', (e) => {
      const runBtn = e.target?.closest?.('.btn-run-skill');
      if (runBtn) {
        const id = runBtn.getAttribute('data-id');
        if (id) this.handleRunSkill(id);
        return;
      }

      const editBtn = e.target?.closest?.('.btn-edit-skill');
      if (editBtn) {
        const id = editBtn.getAttribute('data-id');
        if (id) this.handleOpenSkillEditor(id);
        return;
      }

      const deleteBtn = e.target?.closest?.('.btn-delete-skill');
      if (deleteBtn) {
        const id = deleteBtn.getAttribute('data-id');
        if (id) this.handleDeleteSkill(id);
        return;
      }
    });
  }

  // =========================================================================
  // Profile Memory Operations (Slice 14)
  // =========================================================================

  /**
   * Loads saved profile from local storage and populates form fields
   */
  async loadProfile() {
    try {
      this.profileData = await getProfile();

      if (this.inputName) this.inputName.value = this.profileData.name || '';
      if (this.inputEmail) this.inputEmail.value = this.profileData.email || '';
      if (this.inputPhone) this.inputPhone.value = this.profileData.phone || '';
      if (this.inputCollege) this.inputCollege.value = this.profileData.college || '';
      if (this.inputDegree) this.inputDegree.value = this.profileData.degree || '';
      if (this.inputSkills) this.inputSkills.value = this.profileData.skills || '';
      if (this.inputLinks) this.inputLinks.value = this.profileData.links || '';
      if (this.inputBio) this.inputBio.value = this.profileData.bio || '';
      if (this.selectTone) this.selectTone.value = this.profileData.preferredTone || 'Professional and concise';

      this.updateCompleteness();
    } catch (err) {
      console.warn('[Siddarth Profile] Error loading profile:', err);
    }
  }

  /**
   * Saves current input values to chrome.storage.local
   */
  async handleSaveProfile() {
    this.hideStatus();

    const data = {
      name: (this.inputName?.value || '').trim(),
      email: (this.inputEmail?.value || '').trim(),
      phone: (this.inputPhone?.value || '').trim(),
      college: (this.inputCollege?.value || '').trim(),
      degree: (this.inputDegree?.value || '').trim(),
      skills: (this.inputSkills?.value || '').trim(),
      links: (this.inputLinks?.value || '').trim(),
      bio: (this.inputBio?.value || '').trim(),
      preferredTone: this.selectTone?.value || 'Professional and concise'
    };

    try {
      this.profileData = await saveProfile(data);
      this.updateCompleteness();
      this.showStatus('✓ Profile memory saved successfully on this machine!', 'success');
    } catch (err) {
      this.showStatus(`Failed to save profile: ${err.message}`, 'error');
    }
  }

  /**
   * Resets profile fields and storage to defaults
   */
  async handleClearProfile() {
    this.hideStatus();

    if (this.inputName) this.inputName.value = '';
    if (this.inputEmail) this.inputEmail.value = '';
    if (this.inputPhone) this.inputPhone.value = '';
    if (this.inputCollege) this.inputCollege.value = '';
    if (this.inputDegree) this.inputDegree.value = '';
    if (this.inputSkills) this.inputSkills.value = '';
    if (this.inputLinks) this.inputLinks.value = '';
    if (this.inputBio) this.inputBio.value = '';
    if (this.selectTone) this.selectTone.value = 'Professional and concise';

    try {
      this.profileData = await clearProfile();
      this.updateCompleteness();
      this.showStatus('Profile memory cleared and reset to defaults.', 'info');
    } catch (err) {
      this.showStatus(`Failed to clear profile: ${err.message}`, 'error');
    }
  }

  /**
   * Triggers "Fill this form from profile" workflow
   */
  async handleFillFormFromProfile() {
    // Save current values first so any unsaved edits are captured
    await this.handleSaveProfile();

    const p = this.profileData;
    const hasData = Boolean(p?.name || p?.email || p?.college || p?.skills || p?.phone || p?.degree);
    if (!hasData) {
      this.showStatus('Please enter at least your name, email, or college before filling a form.', 'warning');
      return;
    }

    if (typeof this.onFillFormFromProfile === 'function') {
      this.onFillFormFromProfile(this.profileData);
    } else {
      this.onNavigateTab('agent');
    }
  }

  /**
   * Calculates profile completeness percentage based on filled fields
   */
  updateCompleteness() {
    const fields = [
      this.inputName?.value?.trim(),
      this.inputEmail?.value?.trim(),
      this.inputPhone?.value?.trim(),
      this.inputCollege?.value?.trim(),
      this.inputDegree?.value?.trim(),
      this.inputSkills?.value?.trim(),
      this.inputLinks?.value?.trim(),
      this.inputBio?.value?.trim()
    ];

    const filledCount = fields.filter(Boolean).length;
    const percentage = Math.round((filledCount / fields.length) * 100);

    if (this.completenessBar) {
      this.completenessBar.style.width = `${percentage}%`;
    }

    if (this.completenessText) {
      this.completenessText.textContent = `${percentage}%`;
    }
  }

  showStatus(message, type = 'info') {
    if (!this.statusBox) return;
    this.statusBox.textContent = message;
    this.statusBox.className = `alert-box alert-${type}`;
    this.statusBox.style.display = 'block';

    clearTimeout(this.statusTimeout);
    this.statusTimeout = setTimeout(() => {
      this.hideStatus();
    }, 4000);
  }

  hideStatus() {
    if (this.statusBox) {
      this.statusBox.style.display = 'none';
      this.statusBox.textContent = '';
    }
  }

  // =========================================================================
  // Skills Manager Operations (Slice 15)
  // =========================================================================

  /**
   * Loads saved skills from storage and populates skills list
   */
  async loadSkills() {
    try {
      this.skills = await getSkills();
      this.renderSkillsList();
    } catch (err) {
      console.warn('[Siddarth Skills] Error loading skills:', err);
    }
  }

  /**
   * Renders skills list in sidepanel container
   */
  renderSkillsList() {
    if (!this.skillsListContainer) return;

    if (!this.skills || this.skills.length === 0) {
      this.skillsListContainer.innerHTML = `
        <div style="text-align: center; padding: 18px 12px; color: #94a3b8; font-size: 11.5px; background: rgba(255,255,255,0.02); border: 1px dashed rgba(255,255,255,0.1); border-radius: var(--radius-sm);">
          No skills configured yet. Click <strong>New Skill</strong> or <strong>Reset</strong> to load built-in recipes.
        </div>
      `;
      return;
    }

    const cardsHtml = this.skills.map(skill => {
      const isChat = skill.targetTab !== 'agent';
      const targetLabel = isChat ? 'CHAT' : 'AGENT';
      const targetBadgeClass = isChat ? 'badge-skill-chat' : 'badge-skill-agent';
      const typeBadge = skill.isBuiltIn
        ? '<span class="badge-skill-builtin">Built-in</span>'
        : '<span class="badge-skill-custom">Custom</span>';

      const preview = (skill.promptTemplate || '').length > 85
        ? `${(skill.promptTemplate || '').slice(0, 85)}...`
        : skill.promptTemplate || '';

      const editBtnHtml = `
        <button type="button" class="btn btn-secondary btn-sm btn-edit-skill" data-id="${this.escapeHtml(skill.id)}" title="Edit skill recipe" style="padding: 2px 7px; font-size: 11px;">
          Edit
        </button>
      `;

      const deleteBtnHtml = `
        <button type="button" class="btn btn-secondary btn-sm btn-delete-skill" data-id="${this.escapeHtml(skill.id)}" title="Delete skill recipe" style="padding: 2px 7px; font-size: 11px;">
          Delete
        </button>
      `;

      return `
        <div class="skill-card" data-id="${this.escapeHtml(skill.id)}">
          <div class="skill-card-header">
            <div class="skill-card-title-row">
              <span class="skill-card-title">${this.escapeHtml(skill.name)}</span>
              <span class="${targetBadgeClass}">${targetLabel}</span>
              ${typeBadge}
            </div>
          </div>
          ${skill.description ? `<p class="skill-card-desc">${this.escapeHtml(skill.description)}</p>` : ''}
          <div class="skill-card-prompt-preview" title="${this.escapeHtml(skill.promptTemplate)}">
            "${this.escapeHtml(preview)}"
          </div>
          <div class="skill-card-actions">
            <button type="button" class="btn btn-primary btn-sm btn-run-skill" data-id="${this.escapeHtml(skill.id)}" style="padding: 3px 10px; font-size: 11px; gap: 4px;">
              <svg width="10" height="10" viewBox="0 0 24 24" fill="currentColor">
                <polygon points="5 3 19 12 5 21 5 3"></polygon>
              </svg>
              Run on Page
            </button>
            <div style="display: flex; gap: 4px;">
              ${editBtnHtml}
              ${deleteBtnHtml}
            </div>
          </div>
        </div>
      `;
    }).join('');

    this.skillsListContainer.innerHTML = cardsHtml;
  }

  /**
   * Opens create/edit skill form
   * @param {string|null} skillId
   */
  handleOpenSkillEditor(skillId = null) {
    this.hideSkillsStatus();
    this.editingSkillId = skillId;

    if (skillId) {
      const skill = this.skills.find(s => s.id === skillId);
      if (skill) {
        if (this.skillEditorTitle) this.skillEditorTitle.textContent = `Edit Skill: ${skill.name}`;
        if (this.skillInputName) this.skillInputName.value = skill.name || '';
        if (this.skillInputDesc) this.skillInputDesc.value = skill.description || '';
        if (this.skillInputTarget) this.skillInputTarget.value = skill.targetTab || 'chat';
        if (this.skillInputPrompt) this.skillInputPrompt.value = skill.promptTemplate || '';
      }
    } else {
      if (this.skillEditorTitle) this.skillEditorTitle.textContent = 'Create New Skill Recipe';
      if (this.skillInputName) this.skillInputName.value = '';
      if (this.skillInputDesc) this.skillInputDesc.value = '';
      if (this.skillInputTarget) this.skillInputTarget.value = 'chat';
      if (this.skillInputPrompt) this.skillInputPrompt.value = '';
    }

    if (this.skillEditorCard) {
      this.skillEditorCard.style.display = 'block';
    }
  }

  /**
   * Closes skill editor form
   */
  handleCloseSkillEditor() {
    this.editingSkillId = null;
    if (this.skillInputName) this.skillInputName.value = '';
    if (this.skillInputDesc) this.skillInputDesc.value = '';
    if (this.skillInputPrompt) this.skillInputPrompt.value = '';
    if (this.skillEditorCard) {
      this.skillEditorCard.style.display = 'none';
    }
  }

  /**
   * Saves new or edited skill to storage
   */
  async handleSaveSkill() {
    this.hideSkillsStatus();

    const name = (this.skillInputName?.value || '').trim();
    const description = (this.skillInputDesc?.value || '').trim();
    const targetTab = this.skillInputTarget?.value || 'chat';
    const promptTemplate = (this.skillInputPrompt?.value || '').trim();

    if (!name || !promptTemplate) {
      this.showSkillsStatus('Please provide both a Skill Name and Prompt Template.', 'warning');
      return;
    }

    try {
      const skillPayload = {
        id: this.editingSkillId || undefined,
        name,
        description,
        targetTab,
        promptTemplate,
        isBuiltIn: false
      };

      await addOrUpdateSkill(skillPayload);
      this.handleCloseSkillEditor();
      await this.loadSkills();
      this.showSkillsStatus(`✓ Skill "${name}" saved successfully!`, 'success');
    } catch (err) {
      this.showSkillsStatus(`Failed to save skill: ${err.message}`, 'error');
    }
  }

  /**
   * Deletes a skill by ID
   * @param {string} skillId
   */
  async handleDeleteSkill(skillId) {
    this.hideSkillsStatus();
    try {
      const target = this.skills.find(s => s.id === skillId);
      const name = target ? target.name : 'Skill';

      await deleteSkill(skillId);
      await this.loadSkills();
      this.showSkillsStatus(`"${name}" deleted.`, 'info');
    } catch (err) {
      this.showSkillsStatus(`Failed to delete skill: ${err.message}`, 'error');
    }
  }

  /**
   * Resets all skills to default built-ins
   */
  async handleResetSkills() {
    this.hideSkillsStatus();
    try {
      await resetSkillsToDefault();
      this.handleCloseSkillEditor();
      await this.loadSkills();
      this.showSkillsStatus('Skills reset to default built-in prompt recipes.', 'info');
    } catch (err) {
      this.showSkillsStatus(`Failed to reset skills: ${err.message}`, 'error');
    }
  }

  /**
   * Runs a skill on the active webpage
   * @param {string} skillId
   */
  handleRunSkill(skillId) {
    const skill = this.skills.find(s => s.id === skillId);
    if (!skill) {
      this.showSkillsStatus('Selected skill was not found.', 'error');
      return;
    }

    this.showSkillsStatus(`Executing skill: "${skill.name}" on active webpage...`, 'info');

    if (typeof this.onRunSkill === 'function') {
      this.onRunSkill(skill);
    } else if (skill.targetTab === 'agent') {
      this.onNavigateTab('agent');
    } else {
      this.onNavigateTab('chat');
    }
  }

  /**
   * Exports skills to JSON string and triggers browser file download
   */
  async handleExportSkills() {
    this.hideSkillsStatus();
    try {
      const jsonStr = await exportSkillsAsJson();

      if (typeof Blob !== 'undefined' && typeof document !== 'undefined') {
        const blob = new Blob([jsonStr], { type: 'application/json' });
        const url = (globalThis.URL || window.URL)?.createObjectURL?.(blob);
        if (url) {
          const a = document.createElement('a');
          a.href = url;
          a.download = 'siddarth-skills.json';
          if (document.body?.appendChild) {
            document.body.appendChild(a);
          }
          a.click?.();
          if (typeof a.remove === 'function') {
            a.remove();
          } else if (a.parentNode?.removeChild) {
            a.parentNode.removeChild(a);
          }
          (globalThis.URL || window.URL)?.revokeObjectURL?.(url);
        }
      }

      this.showSkillsStatus(`✓ Exported ${this.skills.length} skills to siddarth-skills.json`, 'success');
      return jsonStr;
    } catch (err) {
      this.showSkillsStatus(`Export failed: ${err.message}`, 'error');
      throw err;
    }
  }

  /**
   * Handles file upload import
   * @param {Event} e
   */
  async handleImportSkillsFile(e) {
    this.hideSkillsStatus();
    const file = e.target?.files?.[0];
    if (!file) return;

    try {
      let content = '';
      if (typeof file.text === 'function') {
        content = await file.text();
      } else {
        content = await new Promise((resolve, reject) => {
          const reader = new FileReader();
          reader.onload = () => resolve(reader.result);
          reader.onerror = () => reject(new Error('Failed to read file.'));
          reader.readAsText(file);
        });
      }

      const res = await this.handleImportSkillsText(content);
      if (this.fileImportSkills) {
        this.fileImportSkills.value = '';
      }
      return res;
    } catch (err) {
      if (this.fileImportSkills) {
        this.fileImportSkills.value = '';
      }
      this.showSkillsStatus(`Import failed: ${err.message}`, 'error');
      throw err;
    }
  }

  /**
   * Direct text/string JSON import
   * @param {string} jsonText
   */
  async handleImportSkillsText(jsonText) {
    const res = await importSkillsFromJson(jsonText, { merge: true });
    await this.loadSkills();
    this.showSkillsStatus(`✓ Successfully imported ${res.importedCount} skill recipes! (Total: ${res.totalCount})`, 'success');
    return res;
  }

  showSkillsStatus(message, type = 'info') {
    if (!this.skillsStatusBox) return;
    this.skillsStatusBox.textContent = message;
    this.skillsStatusBox.className = `alert-box alert-${type}`;
    this.skillsStatusBox.style.display = 'block';

    clearTimeout(this.skillsStatusTimeout);
    this.skillsStatusTimeout = setTimeout(() => {
      this.hideSkillsStatus();
    }, 4500);
  }

  hideSkillsStatus() {
    if (this.skillsStatusBox) {
      this.skillsStatusBox.style.display = 'none';
      this.skillsStatusBox.textContent = '';
    }
  }

  escapeHtml(str) {
    if (!str) return '';
    return String(str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }
}
