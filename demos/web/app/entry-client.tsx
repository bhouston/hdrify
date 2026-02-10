import { StrictMode } from 'react';
import { hydrateRoot } from 'react-dom/client';
import { App } from './root';

hydrateRoot(document.getElementById('root')!, (
  <StrictMode>
    <App />
  </StrictMode>
));
