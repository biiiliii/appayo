// Alguns lectors de QR obren la pàgina en un WebView sense emmagatzematge DOM.
// També cal comprovar l'escriptura: l'objecte pot existir però rebutjar setItem.
export function canStoreLocally(getStorage = () => globalThis.localStorage) {
  try {
    const storage = getStorage();
    if (!storage) return false;
    const key = `appayo:storage-check:${Math.random()}`;
    storage.setItem(key, '1');
    const works = storage.getItem(key) === '1';
    storage.removeItem(key);
    return works;
  } catch { return false; }
}
