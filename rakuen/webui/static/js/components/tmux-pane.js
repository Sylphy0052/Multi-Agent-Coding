import { agentColor, agentLabel } from '../utils/format.js';

export function createPane(agentName) {
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

  widget.appendChild(header);

  // Output
  const output = document.createElement('pre');
  output.className = 'pane-output';
  widget.appendChild(output);

  function update(text) {
    output.textContent = text || '';
    output.scrollTop = output.scrollHeight;
  }

  // Click handler dispatches custom event for modal open
  header.addEventListener('click', () => {
    widget.dispatchEvent(new CustomEvent('pane-open', {
      bubbles: true,
      detail: { agent: agentName, text: output.textContent }
    }));
  });

  return { element: widget, update };
}
