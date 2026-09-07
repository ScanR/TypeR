import React from 'react';
let closeHandler = null;
export const registerModalClose = (handler) => {
  closeHandler = handler;
  return () => { if (closeHandler === handler) closeHandler = null; };
};
export const requestModalClose = (fallback) => (closeHandler || fallback)();
export const useModalClose = (handler) => {
  const latest = React.useRef(handler);
  latest.current = handler;
  React.useEffect(() => registerModalClose(() => latest.current()), []);
};
