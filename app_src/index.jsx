import './index.scss';
import './lib/CSInterface.js';
import './lib/themeManager.js';

import React from 'react';
import { createRoot } from 'react-dom/client';
import { ContextProvider } from './context';
import HotkeysListner from './hotkeys';
import MainComponent from './components/main/main';

const App = React.memo(function App() {
  return (
    <ContextProvider>
      <HotkeysListner />
      <MainComponent />
    </ContextProvider>
  );
});

const container = document.getElementById('app');
const root = createRoot(container);
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
