import { createContext, createElement, useContext, useState, useCallback, useMemo } from 'react';

const PageContext = createContext(null);

export const PageContextProvider = ({ children }) => {
  const [ctx, setCtx] = useState({ current_page: null, page_data: {} });
  const register = useCallback((current_page, page_data = {}) => {
    setCtx({ current_page, page_data });
  }, []);
  const value = useMemo(() => ({ ctx, register }), [ctx, register]);
  return createElement(PageContext.Provider, { value }, children);
};

export const usePageContext = () => {
  const v = useContext(PageContext);
  if (!v) return { ctx: { current_page: null, page_data: {} }, register: () => {} };
  return v;
};
