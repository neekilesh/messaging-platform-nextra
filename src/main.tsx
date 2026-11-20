import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import { VisualPrefsProvider } from './lib/theme.tsx';
import { CursorParticleTrail } from './components/ui/CursorParticleTrail.tsx';
import './index.css';

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(
  <VisualPrefsProvider>
    <CursorParticleTrail />
    <App />
  </VisualPrefsProvider>
);
