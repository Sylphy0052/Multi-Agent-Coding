import { qs } from '../utils/dom.js';
import { agentColor, agentLabel, formatTimestamp, renderMarkdown } from '../utils/format.js';
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

  if (!entries || !Array.isArray(entries)) return;

  for (const entry of entries) {
    const div = document.createElement('div');
    div.className = 'timeline-entry';
    div.style.borderLeftColor = agentColor(entry.from);

    // Header
    const header = document.createElement('div');
    header.className = 'entry-header';

    const ts = document.createElement('span');
    ts.className = 'entry-timestamp';
    ts.textContent = formatTimestamp(entry.timestamp);
    header.appendChild(ts);

    const fromSpan = document.createElement('span');
    fromSpan.className = 'entry-agent';
    fromSpan.style.color = agentColor(entry.from);
    fromSpan.textContent = agentLabel(entry.from);
    header.appendChild(fromSpan);

    if (entry.to) {
      const arrow = document.createElement('span');
      arrow.className = 'entry-arrow';
      arrow.textContent = '\u2192';
      header.appendChild(arrow);

      const toSpan = document.createElement('span');
      toSpan.className = 'entry-agent';
      toSpan.style.color = agentColor(entry.to);
      toSpan.textContent = agentLabel(entry.to);
      header.appendChild(toSpan);
    }

    div.appendChild(header);

    // Body
    const body = document.createElement('div');
    body.className = 'entry-body';
    let bodyText = '';
    if (entry.task_id) {
      bodyText += '[' + entry.task_id + '] ';
    }
    bodyText += entry.action || '';
    body.textContent = bodyText;
    div.appendChild(body);

    timeline.appendChild(div);
  }

  // Auto-scroll to bottom
  timeline.scrollTop = timeline.scrollHeight;
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
