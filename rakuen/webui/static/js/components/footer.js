import { qs } from '../utils/dom.js';
import * as api from '../api.js';

export function initFooter() {
  const presetSelect = qs('#preset-select');
  const input = qs('#input');
  const sendBtn = qs('#send-btn');
  const cancelBtn = qs('#cancel-btn');

  if (presetSelect) {
    presetSelect.addEventListener('change', () => {
      const selected = presetSelect.selectedOptions[0];
      if (selected && selected.dataset.text && input) {
        input.value = selected.dataset.text;
      }
      presetSelect.selectedIndex = 0;
    });
  }

  async function doSend() {
    if (!input || !input.value.trim()) return;
    const text = input.value.trim();

    if (sendBtn) {
      sendBtn.textContent = 'Sending...';
      sendBtn.disabled = true;
    }
    if (cancelBtn) {
      cancelBtn.disabled = true;
    }

    try {
      await api.sendCommand(text);
      input.value = '';
    } catch (e) {
      console.error('Send failed:', e);
    } finally {
      if (sendBtn) {
        sendBtn.textContent = 'Send';
        sendBtn.disabled = false;
      }
      if (cancelBtn) {
        cancelBtn.disabled = false;
      }
    }
  }

  async function doCancel() {
    if (sendBtn) {
      sendBtn.disabled = true;
    }
    if (cancelBtn) {
      cancelBtn.textContent = 'Sending...';
      cancelBtn.disabled = true;
    }

    try {
      await api.sendEscape();
    } catch (e) {
      console.error('Cancel failed:', e);
    } finally {
      if (sendBtn) {
        sendBtn.disabled = false;
      }
      if (cancelBtn) {
        cancelBtn.textContent = 'Cancel';
        cancelBtn.disabled = false;
      }
    }
  }

  if (sendBtn) {
    sendBtn.addEventListener('click', doSend);
  }

  if (cancelBtn) {
    cancelBtn.addEventListener('click', doCancel);
  }

  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    });
  }
}

export function updatePresets(presets) {
  const presetSelect = qs('#preset-select');
  if (!presetSelect) return;

  // Keep only the first default option
  while (presetSelect.options.length > 1) {
    presetSelect.remove(1);
  }

  if (!presets || !Array.isArray(presets)) return;

  for (const preset of presets) {
    const option = document.createElement('option');
    option.value = preset.id;
    option.textContent = preset.label;
    option.dataset.text = preset.text;
    presetSelect.appendChild(option);
  }
}
