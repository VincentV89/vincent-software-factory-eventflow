import '@cloudscape-design/global-styles/index.css';
import './index.css';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { loadConfig } from './config';

const root = createRoot(document.getElementById('root')!);

loadConfig()
  .then(() =>
    root.render(
      <StrictMode>
        <BrowserRouter>
          <App />
        </BrowserRouter>
      </StrictMode>,
    ),
  )
  .catch(() => {
    root.render(
      <div style={{ fontFamily: 'sans-serif', padding: 40 }} role="alert">
        <h1>EventFlow is temporarily unavailable</h1>
        <p>The application configuration could not be loaded. Please try again shortly.</p>
      </div>,
    );
  });
