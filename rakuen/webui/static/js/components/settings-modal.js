import { qs } from '../utils/dom.js';
import { getSettings, saveSetting, applyTheme, applyFontSize } from '../settings.js';

const SETTING_GROUPS = [
  {
    key: 'autoRefresh',
    label: 'Auto Refresh',
    options: [
      { label: 'ON', value: true },
      { label: 'OFF', value: false }
    ]
  },
  {
    key: 'pollInterval',
    label: 'Poll Interval',
    options: [
      { label: '2s', value: 2000 },
      { label: '5s', value: 5000 },
      { label: '10s', value: 10000 }
    ]
  },
  {
    key: 'logLines',
    label: 'Log Lines',
    options: [
      { label: '100', value: 100 },
      { label: '300', value: 300 },
      { label: '500', value: 500 },
      { label: '1K', value: 1000 }
    ]
  },
  {
    key: 'theme',
    label: 'Theme',
    options: [
      { label: 'Dark', value: 'dark' },
      { label: 'Light', value: 'light' }
    ]
  },
  {
    key: 'fontSize',
    label: 'Font Size',
    options: [
      { label: 'S', value: 's' },
      { label: 'M', value: 'm' },
      { label: 'L', value: 'l' }
    ]
  }
];

export function initSettingsModal() {
  const modal = qs('#settings-modal');
  const body = qs('#settings-body');
  if (!body) return;

  const settings = getSettings();

  body.innerHTML = '';

  for (const group of SETTING_GROUPS) {
    const groupEl = document.createElement('div');
    groupEl.className = 'setting-group';

    const labelEl = document.createElement('div');
    labelEl.className = 'setting-label';
    labelEl.textContent = group.label;
    groupEl.appendChild(labelEl);

    const optionsEl = document.createElement('div');
    optionsEl.className = 'setting-options';

    for (const opt of group.options) {
      const btn = document.createElement('button');
      btn.className = 'setting-btn';
      btn.textContent = opt.label;
      btn.dataset.key = group.key;
      btn.dataset.value = JSON.stringify(opt.value);

      // Set initial active state
      const currentValue = settings[group.key];
      if (currentValue === opt.value || JSON.stringify(currentValue) === JSON.stringify(opt.value)) {
        btn.classList.add('active');
      }

      btn.addEventListener('click', () => {
        // Parse value back from JSON string
        const value = JSON.parse(btn.dataset.value);
        saveSetting(group.key, value);

        // Update active class within this group
        const siblings = optionsEl.querySelectorAll('.setting-btn');
        siblings.forEach((s) => s.classList.remove('active'));
        btn.classList.add('active');

        // Apply immediate visual changes
        if (group.key === 'theme') {
          applyTheme(value);
        }
        if (group.key === 'fontSize') {
          applyFontSize(value);
        }

        // Dispatch settings-changed event
        document.dispatchEvent(new CustomEvent('settings-changed'));
      });

      optionsEl.appendChild(btn);
    }

    groupEl.appendChild(optionsEl);
    body.appendChild(groupEl);
  }

  // Modal close handlers
  if (modal) {
    // Close buttons (X and Close button)
    const closeButtons = modal.querySelectorAll('[data-close="settings-modal"]');
    closeButtons.forEach((btn) => {
      btn.addEventListener('click', () => {
        modal.style.display = 'none';
      });
    });

    // Overlay click
    modal.addEventListener('click', (e) => {
      if (e.target === modal) {
        modal.style.display = 'none';
      }
    });
  }

  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && modal && modal.style.display !== 'none') {
      modal.style.display = 'none';
    }
  });
}
