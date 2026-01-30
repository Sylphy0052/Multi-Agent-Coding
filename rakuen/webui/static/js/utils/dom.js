// DOM helper utilities

/**
 * Create an element with attributes and children.
 * @param {string} tag - HTML tag name
 * @param {Object} attrs - Attributes, className, textContent, innerHTML, or on* event handlers
 * @param {Array} children - Child elements or strings
 * @returns {HTMLElement}
 */
export function el(tag, attrs = {}, children = []) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'className') e.className = v;
    else if (k === 'textContent') e.textContent = v;
    else if (k === 'innerHTML') e.innerHTML = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else e.setAttribute(k, v);
  }
  for (const child of children) {
    if (typeof child === 'string') e.appendChild(document.createTextNode(child));
    else if (child) e.appendChild(child);
  }
  return e;
}

/** @param {string} sel @param {Document|Element} root */
export const qs = (sel, root = document) => root.querySelector(sel);

/** @param {string} sel @param {Document|Element} root */
export const qsa = (sel, root = document) => root.querySelectorAll(sel);
