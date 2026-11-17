const ctx = new Proxy({}, { get: (t, k) => (k === 'createRadialGradient' ? () => ({ addColorStop() {} }) : k in t ? t[k] : () => {}), set: (t, k, v) => { t[k] = v; return true; } });
const el = (tag = 'div') => ({
  tagName: tag.toUpperCase(), style: {}, dataset: {}, textContent: '', innerHTML: '', width: 0, height: 0, offsetWidth: 0,
  classList: { add() {}, remove() {}, toggle() {}, contains() { return false; } },
  addEventListener() {}, removeEventListener() {}, appendChild(c) { return c; }, remove() {}, setAttribute() {}, getAttribute() { return null; },
  querySelector() { return el(); }, querySelectorAll() { return []; }, getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 100 }; },
  focus() {}, animate() { return {}; }, getContext() { return ctx; }, parentNode: { insertBefore() {} },
});
globalThis.document = { querySelector: () => el(), querySelectorAll: () => [], getElementById: () => el(), createElement: (t) => el(t), body: el('body'), head: el('head'), addEventListener() {}, hidden: false };
globalThis.window = globalThis; globalThis.addEventListener = () => {}; globalThis.removeEventListener = () => {};
globalThis.innerWidth = 1200; globalThis.innerHeight = 800; globalThis.devicePixelRatio = 1;
globalThis.matchMedia = () => ({ matches: false });
const store = new Map();
globalThis.localStorage = { getItem: (k) => (store.has(k) ? store.get(k) : null), setItem: (k, v) => store.set(k, String(v)), removeItem: (k) => store.delete(k) };
