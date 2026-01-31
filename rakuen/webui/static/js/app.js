import * as state from './state.js';
import * as api from './api.js';
import { loadSettings, getSettings, applyTheme, applyFontSize } from './settings.js';
import { initHeader } from './components/header.js';
import { initFooter, updatePresets } from './components/footer.js';
import { initActivity } from './components/activity.js';
import { initTmuxView } from './components/tmux-view.js';
import { initSettingsModal } from './components/settings-modal.js';

let dataTimer = null;
let statusTimer = null;

function startPolling() {
  stopPolling();
  const settings = getSettings();

  dataTimer = setInterval(() => {
    if (getSettings().autoRefresh) {
      fetchAndUpdateActiveTab();
    }
  }, settings.pollInterval);

  statusTimer = setInterval(() => {
    if (getSettings().autoRefresh) {
      fetchAndUpdateStatus();
      fetchAndUpdateAgentHealth();
    }
  }, 30000);
}

function stopPolling() {
  if (dataTimer !== null) {
    clearInterval(dataTimer);
    dataTimer = null;
  }
  if (statusTimer !== null) {
    clearInterval(statusTimer);
    statusTimer = null;
  }
}

function restartDataTimer() {
  if (dataTimer !== null) {
    clearInterval(dataTimer);
    dataTimer = null;
  }
  const settings = getSettings();
  dataTimer = setInterval(() => {
    if (getSettings().autoRefresh) {
      fetchAndUpdateActiveTab();
    }
  }, settings.pollInterval);
}

async function fetchAndUpdateActiveTab() {
  const activeTab = state.get('activeTab') || 'activity';
  const settings = getSettings();

  if (activeTab === 'activity') {
    try {
      const activityData = await api.fetchActivity();
      state.set('activityEntries', activityData.entries);
    } catch (e) {
      console.error('Failed to fetch activity:', e);
    }
    try {
      const dashboardData = await api.fetchDashboard();
      state.set('dashboardContent', dashboardData.content);
    } catch (e) {
      console.error('Failed to fetch dashboard:', e);
    }
  } else if (activeTab === 'tmux') {
    try {
      const panesData = await api.fetchPanes(settings.logLines);
      state.set('panes', panesData.panes);
    } catch (e) {
      console.error('Failed to fetch panes:', e);
    }
  }
}

async function fetchAndUpdateStatus() {
  try {
    const data = await api.fetchStatus();
    state.set('status', data);
  } catch (e) {
    console.error('Failed to fetch status:', e);
  }
}

async function fetchAndUpdateAgentHealth() {
  try {
    const data = await api.fetchAgentHealth();
    if (data.agents) {
      state.set('agentHealth', data.agents);
    }
  } catch (e) {
    console.error('Failed to fetch agent health:', e);
  }
}

async function fetchAndUpdatePresets() {
  try {
    const data = await api.fetchPresets();
    state.set('presets', data.presets);
    updatePresets(data.presets);
  } catch (e) {
    console.error('Failed to fetch presets:', e);
  }
}

// State change listeners
state.subscribe('activeTab', () => {
  fetchAndUpdateActiveTab();
  restartDataTimer();
});

// Settings change listener
document.addEventListener('settings-changed', () => {
  const s = getSettings();
  applyTheme(s.theme);
  applyFontSize(s.fontSize);
  restartDataTimer();
});

// Visibility change listener
document.addEventListener('visibilitychange', () => {
  if (document.hidden) {
    stopPolling();
  } else {
    fetchAndUpdateActiveTab();
    fetchAndUpdateStatus();
    fetchAndUpdateAgentHealth();
    startPolling();
  }
});

// Initialize on DOM ready
document.addEventListener('DOMContentLoaded', () => {
  // 1. Load and apply settings
  const settings = loadSettings();
  applyTheme(settings.theme);
  applyFontSize(settings.fontSize);

  // 2. Init all components
  initHeader();
  initFooter();
  initActivity();
  initTmuxView();
  initSettingsModal();

  // 3. Fetch initial data
  fetchAndUpdateStatus();
  fetchAndUpdateActiveTab();
  fetchAndUpdatePresets();
  fetchAndUpdateAgentHealth();

  // 4. Start polling
  startPolling();
});
