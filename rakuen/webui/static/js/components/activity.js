import { qs } from '../utils/dom.js';
import { agentColor, agentLabel, formatTimestamp, renderMarkdown, entryTypeLabel, statusLabel } from '../utils/format.js';
import * as state from '../state.js';

export function initActivity() {
  state.subscribe('activityEntries', (entries) => {
    renderTimeline(entries);
  });

  state.subscribe('dashboardContent', (content) => {
    renderDashboard(content);
  });
}

function renderTimeline(entries) {
  const timeline = qs('#activity-timeline');
  if (!timeline) return;

  timeline.innerHTML = '';

  if (!entries || !Array.isArray(entries) || entries.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'flow-empty';
    empty.textContent = 'アクティビティがありません';
    timeline.appendChild(empty);
    return;
  }

  // Separate attention entries (pinned to top) from regular entries
  const attentionEntries = entries.filter(e => e.type === 'attention');
  const regularEntries = entries.filter(e => e.type !== 'attention');

  // Render attention entries first (pinned)
  for (const entry of attentionEntries) {
    timeline.appendChild(renderAttentionEntry(entry));
  }

  // Render regular timeline entries
  for (const entry of regularEntries) {
    timeline.appendChild(renderRegularEntry(entry));
  }

  // Auto-scroll to bottom
  timeline.scrollTop = timeline.scrollHeight;
}

function renderAttentionEntry(entry) {
  const div = document.createElement('div');
  div.className = 'flow-entry flow-entry-attention';
  div.dataset.type = 'attention';

  // Header: badge + section name
  const header = document.createElement('div');
  header.className = 'flow-header';

  const badge = document.createElement('span');
  badge.className = 'flow-badge flow-badge-attention';
  badge.textContent = entryTypeLabel('attention');
  header.appendChild(badge);

  if (entry.section) {
    const sectionTag = document.createElement('span');
    sectionTag.className = 'flow-attention-section';
    sectionTag.textContent = entry.section;
    header.appendChild(sectionTag);
  }

  div.appendChild(header);

  // Content
  if (entry.action) {
    const content = document.createElement('div');
    content.className = 'flow-content';
    content.textContent = entry.action;
    div.appendChild(content);
  }

  return div;
}

function renderRegularEntry(entry) {
  const div = document.createElement('div');
  div.className = 'flow-entry';
  div.dataset.type = entry.type || 'command';

  // --- Row 1: badge + timestamp + task_id + status ---
  const header = document.createElement('div');
  header.className = 'flow-header';

  const badge = document.createElement('span');
  badge.className = 'flow-badge flow-badge-' + (entry.type || 'command');
  badge.textContent = entryTypeLabel(entry.type);
  header.appendChild(badge);

  const ts = document.createElement('span');
  ts.className = 'flow-timestamp';
  ts.textContent = formatTimestamp(entry.timestamp);
  header.appendChild(ts);

  if (entry.task_id) {
    const taskTag = document.createElement('span');
    taskTag.className = 'flow-task-id';
    taskTag.textContent = entry.task_id;
    header.appendChild(taskTag);
  }

  // Status badge
  const sLabel = statusLabel(entry.status);
  if (sLabel) {
    const statusBadge = document.createElement('span');
    statusBadge.className = 'flow-status flow-status-' + entry.status;
    statusBadge.textContent = sLabel;
    header.appendChild(statusBadge);
  }

  div.appendChild(header);

  // --- Row 2: who did what (agent flow) ---
  const agents = document.createElement('div');
  agents.className = 'flow-agents';

  const fromSpan = document.createElement('span');
  fromSpan.className = 'flow-agent-name';
  fromSpan.style.color = agentColor(entry.from);
  fromSpan.textContent = agentLabel(entry.from);
  agents.appendChild(fromSpan);

  if (entry.to) {
    const verb = document.createElement('span');
    verb.className = 'flow-verb';
    verb.textContent = ' が ';
    agents.appendChild(verb);

    const toSpan = document.createElement('span');
    toSpan.className = 'flow-agent-name';
    toSpan.style.color = agentColor(entry.to);
    toSpan.textContent = agentLabel(entry.to);
    agents.appendChild(toSpan);

    const action = document.createElement('span');
    action.className = 'flow-verb';
    action.textContent = entry.type === 'command' ? ' に指示' : ' に割当';
    agents.appendChild(action);
  } else {
    const verb = document.createElement('span');
    verb.className = 'flow-verb';
    verb.textContent = ' が報告';
    agents.appendChild(verb);
  }

  div.appendChild(agents);

  // --- Row 3: action content ---
  if (entry.action) {
    const content = document.createElement('div');
    content.className = 'flow-content';
    content.textContent = entry.action;
    div.appendChild(content);
  }

  return div;
}

function renderDashboard(content) {
  const dashboard = qs('#dashboard-content');
  if (!dashboard) return;

  if (!content) {
    dashboard.textContent = 'No dashboard data';
    return;
  }

  dashboard.innerHTML = renderMarkdown(content);
}
