import { agentColor, agentLabel } from '../utils/format.js';
import * as api from '../api.js';

/**
 * @param {string} agentName
 * @param {{ interactive?: boolean }} [opts]
 */
export function createPane(agentName, opts = {}) {
  const widget = document.createElement('div');
  widget.className = 'pane-widget';
  widget.dataset.agent = agentName;

  // Header
  const header = document.createElement('div');
  header.className = 'pane-header';

  const colorBar = document.createElement('span');
  colorBar.className = 'pane-color-indicator';
  colorBar.style.backgroundColor = agentColor(agentName);
  header.appendChild(colorBar);

  const label = document.createElement('span');
  label.className = 'pane-label';
  label.textContent = agentLabel(agentName);
  header.appendChild(label);

  // Health indicator dot
  const healthDot = document.createElement('span');
  healthDot.className = 'pane-health-dot pane-health-unknown';
  healthDot.title = 'Health: checking...';
  header.appendChild(healthDot);

  // Restart button (hidden by default, shown when dead)
  const restartBtn = document.createElement('button');
  restartBtn.className = 'pane-restart-btn';
  restartBtn.textContent = 'Restart';
  restartBtn.title = 'Restart this agent';
  restartBtn.style.display = 'none';
  restartBtn.addEventListener('click', async (e) => {
    e.stopPropagation();
    restartBtn.textContent = 'Restarting...';
    restartBtn.disabled = true;
    try {
      const result = await api.restartAgent(agentName);
      if (!result.ok && result.message) {
        console.error('Restart failed:', result.message);
      }
    } catch (err) {
      console.error('Restart error:', err);
    } finally {
      restartBtn.textContent = 'Restart';
      restartBtn.disabled = false;
    }
  });
  header.appendChild(restartBtn);

  widget.appendChild(header);

  // Output
  const output = document.createElement('pre');
  output.className = 'pane-output';
  widget.appendChild(output);

  // Interactive input bar (UI-chan only)
  if (opts.interactive) {
    const inputBar = document.createElement('div');
    inputBar.className = 'pane-input-bar';

    const textarea = document.createElement('textarea');
    textarea.className = 'pane-input';
    textarea.rows = 2;
    textarea.placeholder = 'UI-chan\u3078\u30b3\u30de\u30f3\u30c9\u3092\u5165\u529b...';
    inputBar.appendChild(textarea);

    const sendBtn = document.createElement('button');
    sendBtn.className = 'pane-send-btn';
    sendBtn.textContent = 'Send';
    inputBar.appendChild(sendBtn);

    async function doSend() {
      const text = textarea.value.trim();
      if (!text) return;
      sendBtn.textContent = 'Sending...';
      sendBtn.disabled = true;
      try {
        await api.sendCommand(text);
        textarea.value = '';
      } catch (e) {
        console.error('Pane send failed:', e);
      } finally {
        sendBtn.textContent = 'Send';
        sendBtn.disabled = false;
      }
    }

    sendBtn.addEventListener('click', doSend);
    textarea.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        doSend();
      }
    });

    widget.appendChild(inputBar);
  }

  function update(text) {
    output.textContent = text || '';
    output.scrollTop = output.scrollHeight;
  }

  function updateHealth(info) {
    if (!info) return;
    healthDot.className = 'pane-health-dot pane-health-' + info.status;
    healthDot.title = `Health: ${info.status} (${info.command || 'n/a'})`;

    if (info.status === 'dead' || info.status === 'session_missing') {
      restartBtn.style.display = '';
      if (!info.restart_allowed) {
        restartBtn.disabled = true;
        restartBtn.title = info.circuit_breaker_reason || 'Restart not allowed';
      } else {
        restartBtn.disabled = false;
        restartBtn.title = 'Restart this agent';
      }
    } else {
      restartBtn.style.display = 'none';
    }
  }

  // Click handler dispatches custom event for modal open
  header.addEventListener('click', () => {
    widget.dispatchEvent(new CustomEvent('pane-open', {
      bubbles: true,
      detail: { agent: agentName, text: output.textContent }
    }));
  });

  return { element: widget, update, updateHealth };
}
