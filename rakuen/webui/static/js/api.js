// API client with fetch wrappers

/**
 * GET /api/activity
 * @returns {Promise<Object>}
 */
export async function fetchActivity() {
  try {
    const res = await fetch("/api/activity");
    return await res.json();
  } catch (err) {
    console.error("fetchActivity failed:", err);
    return { error: err.message };
  }
}

/**
 * GET /api/panes?lines={lines}
 * @param {number} lines
 * @returns {Promise<Object>}
 */
export async function fetchPanes(lines = 300) {
  try {
    const res = await fetch(`/api/panes?lines=${lines}`);
    return await res.json();
  } catch (err) {
    console.error("fetchPanes failed:", err);
    return { error: err.message };
  }
}

/**
 * GET /api/status
 * @returns {Promise<Object>}
 */
export async function fetchStatus() {
  try {
    const res = await fetch("/api/status");
    return await res.json();
  } catch (err) {
    console.error("fetchStatus failed:", err);
    return { error: err.message };
  }
}

/**
 * GET /api/presets
 * @returns {Promise<Object>}
 */
export async function fetchPresets() {
  try {
    const res = await fetch("/api/presets");
    return await res.json();
  } catch (err) {
    console.error("fetchPresets failed:", err);
    return { error: err.message };
  }
}

/**
 * GET /api/dashboard
 * @returns {Promise<Object>}
 */
export async function fetchDashboard() {
  try {
    const res = await fetch("/api/dashboard");
    return await res.json();
  } catch (err) {
    console.error("fetchDashboard failed:", err);
    return { error: err.message };
  }
}

/**
 * POST /api/send-escape -> send Escape key to uichan
 * @returns {Promise<Object>}
 */
export async function sendEscape() {
  try {
    const res = await fetch("/api/send-escape", { method: "POST" });
    return await res.json();
  } catch (err) {
    console.error("sendEscape failed:", err);
    return { error: err.message };
  }
}

/**
 * GET /api/agents/health
 * @returns {Promise<Object>}
 */
export async function fetchAgentHealth() {
  try {
    const res = await fetch("/api/agents/health");
    return await res.json();
  } catch (err) {
    console.error("fetchAgentHealth failed:", err);
    return { error: err.message };
  }
}

/**
 * POST /api/restart with JSON body {agent}
 * @param {string} agentName
 * @returns {Promise<Object>}
 */
export async function restartAgent(agentName) {
  try {
    const res = await fetch("/api/restart", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agent: agentName }),
    });
    return await res.json();
  } catch (err) {
    console.error("restartAgent failed:", err);
    return { error: err.message };
  }
}

/**
 * POST /api/send with JSON body {text}
 * @param {string} text
 * @returns {Promise<Object>}
 */
export async function sendCommand(text) {
  try {
    const res = await fetch("/api/send", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text }),
    });
    return await res.json();
  } catch (err) {
    console.error("sendCommand failed:", err);
    return { error: err.message };
  }
}
