import { useEffect, useRef, useState } from "react";

// In-page "tap again to confirm" instead of window.confirm(), which freezes the page
// (and any remote control of the browser) until someone answers it.
export const useConfirmTap = (ms = 4000) => {
  const [armed, setArmed] = useState(null);
  const timer = useRef(null);
  useEffect(() => () => clearTimeout(timer.current), []);
  const ask = (key, run) => {
    clearTimeout(timer.current);
    if (armed === key) {
      setArmed(null);
      run();
      return;
    }
    setArmed(key);
    timer.current = setTimeout(() => setArmed(null), ms);
  };
  return [armed, ask];
};
