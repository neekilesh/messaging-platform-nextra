import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import { VisualPrefsProvider } from './lib/theme.tsx';
import { CursorParticleTrail } from './components/ui/CursorParticleTrail.tsx';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <VisualPrefsProvider>
    <CursorParticleTrail />
    <App />
  </VisualPrefsProvider>
);
