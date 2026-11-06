/**
 * Siddarth - Background Service Worker (Manifest V3)
 * Manages extension lifecycle, side-panel opening, and cross-context routing.
 */

// Configure side panel behavior on installation
if (typeof chrome !== 'undefined' && chrome.runtime?.onInstalled) {
  chrome.runtime.onInstalled.addListener(async (details) => {
    console.log('[Siddarth] Extension installed:', details.reason);

    try {
      // Open side panel when extension action icon is clicked
      if (chrome.sidePanel?.setPanelBehavior) {
        await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
        console.log('[Siddarth] Side panel behavior set to open on action click.');
      }
    } catch (err) {
      console.error('[Siddarth] Failed to set side panel behavior:', err);
    }

    // Setup context menu entries for selected text
    setupContextMenus();
  });
}

// Also ensure panel behavior and context menus are set on startup
if (typeof chrome !== 'undefined' && chrome.runtime?.onStartup) {
  chrome.runtime.onStartup.addListener(async () => {
    try {
      if (chrome.sidePanel?.setPanelBehavior) {
        await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
      }
    } catch (err) {
      console.error('[Siddarth] Failed on startup side panel config:', err);
    }
    setupContextMenus();
  });
}

/**
 * Register right-click context menu items (Slice 7)
 */
export function setupContextMenus() {
  if (!chrome.contextMenus) return;

  chrome.contextMenus.removeAll(() => {
    // Parent context menu
    chrome.contextMenus.create({
      id: 'siddarth-parent',
      title: 'Siddarth AI',
      contexts: ['selection']
    });

    chrome.contextMenus.create({
      parentId: 'siddarth-parent',
      id: 'siddarth-explain',
      title: 'Explain this in plain language',
      contexts: ['selection']
    });

    chrome.contextMenus.create({
      parentId: 'siddarth-parent',
      id: 'siddarth-translate',
      title: 'Translate to Hindi / Hinglish',
      contexts: ['selection']
    });

    chrome.contextMenus.create({
      parentId: 'siddarth-parent',
      id: 'siddarth-reply',
      title: 'Draft a reply to this',
      contexts: ['selection']
    });
  });
}

// Handle context menu clicks (Slice 7)
if (typeof chrome !== 'undefined' && chrome.contextMenus?.onClicked) {
  chrome.contextMenus.onClicked.addListener(async (info, tab) => {
    if (!tab?.id) return;

    const actionMap = {
      'siddarth-explain': 'explain',
      'siddarth-translate': 'translate',
      'siddarth-reply': 'reply'
    };

    const action = actionMap[info.menuItemId];
    if (!action || !info.selectionText) return;

    const payload = {
      action,
      selectionText: info.selectionText.trim(),
      pageUrl: tab.url || '',
      pageTitle: tab.title || '',
      timestamp: Date.now()
    };

    try {
      // 1. Store pending context action in storage to survive side panel cold boot
      if (chrome.storage?.local) {
        await chrome.storage.local.set({ siddarth_pending_context_action: payload });
      }

      // 2. Open the side panel for this tab / window
      if (chrome.sidePanel?.open) {
        await chrome.sidePanel.open({ tabId: tab.id });
      }

      // 3. Broadcast message to side panel if already mounted
      setTimeout(() => {
        chrome.runtime.sendMessage({
          type: 'CONTEXT_MENU_ACTION',
          payload
        }).catch(() => {
          // Handled via storage fallback if side panel is still mounting
        });
      }, 200);
    } catch (err) {
      console.error('[Siddarth] Error routing context menu action:', err);
    }
  });
}

/**
 * Captures visible tab screenshot as PNG Data URL (Slice 8)
 * @param {number|null} windowId
 * @returns {Promise<{success: boolean, dataUrl?: string, error?: string}>}
 */
export async function captureTabScreenshot(windowId = null) {
  return new Promise(async (resolve) => {
    if (typeof chrome === 'undefined' || !chrome.tabs?.captureVisibleTab) {
      resolve({ success: false, error: 'chrome.tabs.captureVisibleTab is not available' });
      return;
    }

    let isResolved = false;
    const safetyTimer = setTimeout(() => {
      if (!isResolved) {
        isResolved = true;
        resolve({ success: false, error: 'Tab capture timed out after 4 seconds' });
      }
    }, 4500);

    try {
      let targetWinId = windowId;
      if (targetWinId == null && chrome.windows?.getLastFocused) {
        try {
          const win = await chrome.windows.getLastFocused({ populate: false });
          if (win && win.id && win.type === 'normal') {
            targetWinId = win.id;
          }
        } catch {}
      }

      chrome.tabs.captureVisibleTab(targetWinId, { format: 'png' }, (dataUrl) => {
        if (isResolved) return;
        isResolved = true;
        clearTimeout(safetyTimer);

        if (chrome.runtime?.lastError) {
          resolve({ success: false, error: chrome.runtime.lastError.message });
        } else if (!dataUrl) {
          resolve({ success: false, error: 'Empty screenshot captured' });
        } else {
          resolve({ success: true, dataUrl });
        }
      });
    } catch (err) {
      if (!isResolved) {
        isResolved = true;
        clearTimeout(safetyTimer);
        resolve({ success: false, error: err.message });
      }
    }
  });
}

// Central message listener for background operations
if (typeof chrome !== 'undefined' && chrome.runtime?.onMessage) {
  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    // Capture screenshot request (Slice 8)
    if (message.type === 'CAPTURE_SCREENSHOT') {
      const targetWindowId = message.windowId !== undefined ? message.windowId : null;
      captureTabScreenshot(targetWindowId).then(sendResponse);
      return true; // Keep message channel open for async response
    }

    // Ping / healthcheck
    if (message.type === 'PING') {
      sendResponse({ status: 'PONG', timestamp: Date.now() });
      return false;
    }
  });
}

