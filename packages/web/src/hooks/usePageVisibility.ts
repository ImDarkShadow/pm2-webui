import { useState, useEffect } from 'react';

/**
 * Custom hook tracking page/tab visibility (document.visibilityState).
 * Used to pause high-frequency metric polling, chart streaming, and WS messages
 * when the user is not looking at the dashboard, reducing network & CPU usage.
 */
export function usePageVisibility(): boolean {
  const [isVisible, setIsVisible] = useState<boolean>(() => {
    return typeof document !== 'undefined' ? document.visibilityState === 'visible' : true;
  });

  useEffect(() => {
    const handleVisibilityChange = () => {
      setIsVisible(document.visibilityState === 'visible');
    };

    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  return isVisible;
}
