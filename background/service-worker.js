/**
 * Siddarth - Background Service Worker (Manifest V3)
 * Manages extension lifecycle, side-panel opening, and cross-context routing.
 */

// Configure side panel behavior on installation
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

// Also ensure panel behavior is set on startup
chrome.runtime.onStartup.addListener(async () => {
  try {
    if (chrome.sidePanel?.setPanelBehavior) {
      await chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
    }
  } catch (err) {
    console.error('[Siddarth] Failed on startup side panel config:', err);
  }
});

/**
 * Register right-click context menu items
 */
function setupContextMenus() {
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

// Handle context menu clicks
chrome.contextMenus?.onClicked.addListener(async (info, tab) => {
  if (!tab?.id) return;

  const actionMap = {
    'siddarth-explain': 'explain',
    'siddarth-translate': 'translate',
    'siddarth-reply': 'reply'
  };

  const action = actionMap[info.menuItemId];
  if (!action || !info.selectionText) return;

  try {
    // Open the side panel for this tab
    if (chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }

    // Broadcast message to side panel
    setTimeout(() => {
      chrome.runtime.sendMessage({
        type: 'CONTEXT_MENU_ACTION',
        payload: {
          action,
          selectionText: info.selectionText,
          pageUrl: tab.url,
          pageTitle: tab.title
        }
      }).catch(() => {
        // Side panel might still be initializing, state will be picked up
      });
    }, 400);
  } catch (err) {
    console.error('[Siddarth] Error routing context menu action:', err);
  }
});

// Central message listener for background operations
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Capture screenshot request
  if (message.type === 'CAPTURE_SCREENSHOT') {
    chrome.tabs.captureVisibleTab(null, { format: 'png' }, (dataUrl) => {
      if (chrome.runtime.lastError) {
        sendResponse({ success: false, error: chrome.runtime.lastError.message });
      } else {
        sendResponse({ success: true, dataUrl });
      }
    });
    return true; // Keep message channel open for async response
  }

  // Ping / healthcheck
  if (message.type === 'PING') {
    sendResponse({ status: 'PONG', timestamp: Date.now() });
    return false;
  }
});

