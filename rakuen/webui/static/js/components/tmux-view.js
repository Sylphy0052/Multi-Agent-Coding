import { qs } from '../utils/dom.js';
import { agentLabel } from '../utils/format.js';
import * as state from '../state.js';
import { createPane } from './tmux-pane.js';

const GRID_AGENTS = [
  'aichan', 'kobito1', 'kobito2', 'kobito3',
  'kobito4', 'kobito5', 'kobito6', 'kobito7', 'kobito8'
];

export function initTmuxView() {
  const tmuxLeft = qs('#tmux-left');
  const tmuxGrid = qs('#tmux-grid');
  const paneModal = qs('#pane-modal');
  const paneModalTitle = qs('#pane-modal-title');
  const paneModalContent = qs('#pane-modal-content');

  const paneMap = {};
  let activeModalAgent = null;

  // Create UI-chan pane in left panel
  if (tmuxLeft) {
    const uiPane = createPane('uichan');
    paneMap['uichan'] = uiPane;
    tmuxLeft.appendChild(uiPane.element);
  }

  // Create 9 panes in grid
  if (tmuxGrid) {
    for (const agent of GRID_AGENTS) {
      const pane = createPane(agent);
      paneMap[agent] = pane;
      tmuxGrid.appendChild(pane.element);
    }
  }

  // Subscribe to panes state
  state.subscribe('panes', (panes) => {
    if (!panes) return;
    for (const [agentName, pane] of Object.entries(paneMap)) {
      if (panes[agentName] !== undefined) {
        pane.update(panes[agentName]);
      }
    }
    // Update modal content if open
    if (activeModalAgent && panes[activeModalAgent] !== undefined && paneModalContent) {
      paneModalContent.textContent = panes[activeModalAgent];
      paneModalContent.scrollTop = paneModalContent.scrollHeight;
    }
  });

  // Pane click handler via event delegation
  document.addEventListener('pane-open', (e) => {
    const { agent, text } = e.detail;
    openModal(agent, text);
  });

  function openModal(agent, text) {
    activeModalAgent = agent;
    if (paneModalTitle) {
      paneModalTitle.textContent = agentLabel(agent);
    }
    if (paneModalContent) {
      paneModalContent.textContent = text || '';
      paneModalContent.scrollTop = paneModalContent.scrollHeight;
    }
    if (paneModal) {
      paneModal.style.display = 'flex';
    }
  }

  function closeModal() {
    activeModalAgent = null;
    if (paneModal) {
      paneModal.style.display = 'none';
    }
  }

  // Modal close handlers
  if (paneModal) {
    // X button and close button
    const closeButtons = paneModal.querySelectorAll('[data-close="pane-modal"]');
    closeButtons.forEach((btn) => {
      btn.addEventListener('click', closeModal);
    });

    // Overlay click
    paneModal.addEventListener('click', (e) => {
      if (e.target === paneModal) {
        closeModal();
      }
    });
  }

  // Escape key
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && paneModal && paneModal.style.display !== 'none') {
      closeModal();
    }
  });
}
