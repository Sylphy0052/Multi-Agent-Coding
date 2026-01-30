import { qs } from '../utils/dom.js';
import * as state from '../state.js';

export function initHeader() {
  const tabActivity = qs('#tab-activity');
  const tabTmux = qs('#tab-tmux');
  const settingsBtn = qs('#settings-btn');
  const tmuxDot = qs('#tmux-dot');
  const tmuxStatus = qs('#tmux-status');
  const validDot = qs('#valid-dot');
  const validationStatus = qs('#validation-status');
  const portInfo = qs('#port-info');

  if (portInfo) {
    portInfo.textContent = window.location.port;
  }

  const activityView = qs('#activity-view');
  const tmuxView = qs('#tmux-view');

  if (tabActivity) {
    tabActivity.addEventListener('click', () => {
      state.set('activeTab', 'activity');
      tabActivity.classList.add('active');
      if (tabTmux) tabTmux.classList.remove('active');
      if (activityView) activityView.style.display = '';
      if (tmuxView) tmuxView.style.display = 'none';
    });
  }

  if (tabTmux) {
    tabTmux.addEventListener('click', () => {
      state.set('activeTab', 'tmux');
      tabTmux.classList.add('active');
      if (tabActivity) tabActivity.classList.remove('active');
      if (tmuxView) tmuxView.style.display = '';
      if (activityView) activityView.style.display = 'none';
    });
  }

  if (settingsBtn) {
    settingsBtn.addEventListener('click', () => {
      const modal = qs('#settings-modal');
      if (modal) modal.style.display = 'flex';
    });
  }

  state.subscribe('status', (data) => {
    if (!data) return;

    if (tmuxDot && tmuxStatus) {
      const tmuxOk = data.tmux_running;
      tmuxDot.className = 'dot ' + (tmuxOk ? 'dot-ok' : 'dot-err');
      tmuxStatus.textContent = tmuxOk ? 'Tmux OK' : 'Tmux Down';
    }

    if (validDot && validationStatus) {
      const validOk = data.validation_ok;
      validDot.className = 'dot ' + (validOk ? 'dot-ok' : 'dot-err');
      validationStatus.textContent = validOk ? 'Valid' : 'Invalid';
    }
  });
}
