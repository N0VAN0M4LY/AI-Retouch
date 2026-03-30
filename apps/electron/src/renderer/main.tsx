import React from 'react';
import ReactDOM from 'react-dom/client';

const urlPrefer = new URLSearchParams(window.location.search).get('preferLayout');
const stored = localStorage.getItem('ui-layout');
const layout = urlPrefer ?? stored ?? 'v2';

if (urlPrefer) {
  localStorage.setItem('ui-layout', urlPrefer);
  const cleanUrl = new URL(window.location.href);
  cleanUrl.searchParams.delete('preferLayout');
  history.replaceState(null, '', cleanUrl.pathname + cleanUrl.search);
}

if (layout === 'v2') {
  document.documentElement.setAttribute('data-layout', 'v2');
}

(window as any).electronAPI?.window.setLayoutSize?.(layout === 'v2' ? 'v2' : 'classic');

async function mount() {
  const { default: Layout } = layout === 'v2'
    ? await import('./layouts/v2/index')
    : await import('./layouts/classic/index');

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <Layout />
    </React.StrictMode>,
  );
}

mount();
