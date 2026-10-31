const temporary = new Map<string, string | null>();
let warning = '';
export const getStorageWarning = () => warning;
function failed() {
  warning = 'Browser storage is unavailable or full. Changes may only last for this session. Export important work before closing FRIDAY.';
  queueMicrotask(() => window.dispatchEvent(new Event('friday:storage-warning')));
}
export const safeStorage = {
  getItem(key: string): string | null {
    if (temporary.has(key)) return temporary.get(key) ?? null;
    try { return window.localStorage.getItem(key); }
    catch { failed(); return null; }
  },
  setItem(key: string, value: string) {
    try { window.localStorage.setItem(key, value); temporary.delete(key); }
    catch { temporary.set(key, value); failed(); }
  },
  removeItem(key: string) {
    try { window.localStorage.removeItem(key); temporary.delete(key); }
    catch { temporary.set(key, null); failed(); }
  },
};
