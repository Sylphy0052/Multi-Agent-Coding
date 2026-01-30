// Simple observable state store

const _state = {
  activeTab: "activity",
  activityEntries: [],
  panes: {},
  status: null,
  dashboardContent: "",
  presets: [],
};

/** @type {Map<string, Set<Function>>} */
const _listeners = new Map();

/**
 * Returns the current value for the given key.
 * @param {string} key
 * @returns {*}
 */
export function get(key) {
  return _state[key];
}

/**
 * Updates the value for the given key and notifies all subscribers.
 * @param {string} key
 * @param {*} value
 */
export function set(key, value) {
  _state[key] = value;
  const subs = _listeners.get(key);
  if (subs) {
    for (const cb of subs) {
      cb(value);
    }
  }
}

/**
 * Registers a listener for changes to the given key.
 * @param {string} key
 * @param {Function} callback - Called with the new value on change
 * @returns {Function} Unsubscribe function
 */
export function subscribe(key, callback) {
  if (!_listeners.has(key)) {
    _listeners.set(key, new Set());
  }
  _listeners.get(key).add(callback);

  return () => {
    const subs = _listeners.get(key);
    if (subs) {
      subs.delete(callback);
    }
  };
}
