import { locale } from "./utils";
import StorageNotice from "./components/storageNotice";
import './index.scss';
import './rtl.scss';
import './lib/CSInterface';
import './lib/themeManager';
// Opt-in profiler: stays inert unless enabled in the settings (or via
// typerPerf.enable() in the debug console). Imported after CSInterface so it
// can wrap evalScript and time every host round-trip.
import './perfDebug';

import React from 'react';
import ReactDOM from 'react-dom';
import { ContextProvider } from './context';
import HotkeysListner from './hotkeys';
import McpBridge from './mcpBridge';
import MainComponent from './components/main/main';
import GlobalTooltip from './components/globalTooltip';

// A render error anywhere in the tree used to kill the whole panel (blank
// white extension until Photoshop restarts). Catch it and offer a reload.
class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error("TypeR crashed:", error, info);
  }

  render() {
    if (this.state.error) {
      const message = (this.state.error && this.state.error.message) || String(this.state.error);
      return (
        <div style={{ padding: 16, fontFamily: "Tahoma, sans-serif", fontSize: 12, color: "#ccc" }}>
          <p style={{ marginBottom: 8 }}>{locale.unexpectedError}</p>
          <pre style={{ whiteSpace: "pre-wrap", maxHeight: 160, overflow: "auto", opacity: 0.7, marginBottom: 12 }}>{message}</pre>
          <button className="topcoat-button--large" onClick={() => window.location.reload()}>{locale.reloadApp}</button>
        </div>
      );
    }
    return this.props.children;
  }
}

const App = React.memo(function App() {
  return (
    <ErrorBoundary>
      <ContextProvider>
        <HotkeysListner />
        <McpBridge />
        <MainComponent />
        <GlobalTooltip />
        <StorageNotice />
      </ContextProvider>
    </ErrorBoundary>
  );
});

// No StrictMode: the context reducer has side effects (storage writes,
// confirm dialogs) that must not be double-invoked in development builds
ReactDOM.render(
  <App />,
  document.getElementById('app')
);
