// Settings management with localStorage

const STORAGE_KEY = "rakuen-settings";

const DEFAULTS = {
  autoRefresh: true,
  pollInterval: 2000,
  logLines: 300,
  theme: "dark",
  fontSize: "m",
};

/** @type {Object} In-memory settings cache */
let _settings = null;

/**
 * Reads settings from localStorage, merges with DEFAULTS, and returns the result.
 * @returns {Object}
 */
export function loadSettings() {
  let stored = {};
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      stored = JSON.parse(raw);
    }
  } catch (err) {
    console.error("Failed to load settings:", err);
  }
  _settings = { ...DEFAULTS, ...stored };
  return _settings;
}

/**
 * Returns current in-memory settings. Loads from storage if not yet initialized.
 * @returns {Object}
 */
export function getSettings() {
  if (!_settings) {
    return loadSettings();
  }
  return _settings;
}

/**
 * Updates a single setting key, saves to localStorage, and applies theme/fontSize if relevant.
 * @param {string} key
 * @param {*} value
 */
export function saveSetting(key, value) {
  if (!_settings) {
    loadSettings();
  }
  _settings[key] = value;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_settings));
  } catch (err) {
    console.error("Failed to save settings:", err);
  }
  if (key === "theme") {
    applyTheme(value);
  }
  if (key === "fontSize") {
    applyFontSize(value);
  }
}

/**
 * Applies the theme by toggling "theme-light" class on document.documentElement.
 * @param {string} theme - "dark" or "light"
 */
export function applyTheme(theme) {
  if (theme === "light") {
    document.documentElement.classList.add("theme-light");
  } else {
    document.documentElement.classList.remove("theme-light");
  }
}

/**
 * Sets the CSS variable --font-size-log on :root based on size.
 * S=12px, M=13px, L=15px.
 * @param {string} size - "s", "m", or "l"
 */
export function applyFontSize(size) {
  const map = { s: "12px", m: "13px", l: "15px" };
  const px = map[size.toLowerCase()] ?? map.m;
  document.documentElement.style.setProperty("--font-size-log", px);
}
