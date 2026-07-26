import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './styles.css';

const normalizedPath = window.location.pathname.replace(/\/+$/, '') || '/';
const isSupportPage =
  normalizedPath === '/support' || normalizedPath === '/support.html';

async function mountPage() {
  const Page = isSupportPage
    ? (await import('./SupportPage')).SupportPage
    : (await import('./App')).default;

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <Page />
    </StrictMode>,
  );
}

void mountPage();
