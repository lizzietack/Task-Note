import { useCallback, useEffect, useState } from 'react';

export const useLocalStorage = (key, initialValue) => {
  const read = useCallback(() => {
    if (typeof window === 'undefined') return initialValue;
    try {
      const item = window.localStorage.getItem(key);
      return item == null ? initialValue : JSON.parse(item);
    } catch (error) {
      console.warn(`JotRelay could not read localStorage key "${key}"`, error);
      return initialValue;
    }
  }, [key, initialValue]);

  const [storedValue, setStoredValue] = useState(read);

  const setValue = useCallback((value) => {
    setStoredValue(previous => {
      const next = typeof value === 'function' ? value(previous) : value;
      if (typeof window !== 'undefined') {
        try {
          window.localStorage.setItem(key, JSON.stringify(next));
        } catch (error) {
          console.warn(`JotRelay could not save localStorage key "${key}"`, error);
        }
      }
      return next;
    });
  }, [key]);

  useEffect(() => {
    const handleStorageChange = (event) => {
      if (event.key !== key) return;
      try {
        setStoredValue(event.newValue == null ? initialValue : JSON.parse(event.newValue));
      } catch (error) {
        console.warn(`JotRelay could not sync localStorage key "${key}"`, error);
      }
    };
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, [key, initialValue]);

  return [storedValue, setValue];
};
