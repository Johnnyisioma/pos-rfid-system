import { useSearchParams } from 'react-router-dom';

/**
 * Keeps a page's active tab in the URL as ?tab=…
 *
 * This is what lets the sidebar link straight to "Low stock" or "VAT report"
 * instead of dropping you on the page and making you find the tab.
 */
export function useTabParam(defaultTab) {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') || defaultTab;

  const setTab = (next) => {
    const sp = new URLSearchParams(params);
    sp.set('tab', next);
    setParams(sp, { replace: true });
  };

  return [tab, setTab];
}
