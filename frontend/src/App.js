import { useState, useEffect } from "react";
import "./App.css";
import Dashboard from "./components/Dashboard";

function App() {
  const [booting, setBooting] = useState(true);

  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 1400);
    return () => clearTimeout(t);
  }, []);

  return (
    <div className="placement-app">
      <div className="mesh-bg" aria-hidden="true">
        <span className="blob blob-a" />
        <span className="blob blob-b" />
        <span className="blob blob-c" />
      </div>

      {booting && (
        <div className="splash" data-testid="app-splash">
          <img src="/icons/icon-192.png" alt="Placement Pulse logo" className="splash-logo" />
          <h1 className="splash-title font-display">Placement Pulse</h1>
          <div className="splash-spinner" />
        </div>
      )}

      <Dashboard />
    </div>
  );
}

export default App;
