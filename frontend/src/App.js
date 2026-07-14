import { useState, useEffect } from "react";
import "./App.css";
import Dashboard from "./components/Dashboard";
import { isIOS, isStandalone } from "./lib/platform";

function App() {
  const [booting, setBooting] = useState(true);
  const [showIOSBanner, setShowIOSBanner] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setBooting(false), 1400);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (isIOS() && !isStandalone()) setShowIOSBanner(true);
  }, []);

  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    const handler = (event) => {
      if (event.data && event.data.type === "OPEN_JOB" && event.data.jobId) {
        window.dispatchEvent(
          new CustomEvent("pp:openJob", { detail: { jobId: event.data.jobId } })
        );
      }
    };
    navigator.serviceWorker.addEventListener("message", handler);
    return () => navigator.serviceWorker.removeEventListener("message", handler);
  }, []);

  return (
    <div className="placement-app">
      <div className="mesh-bg" aria-hidden="true">
        <span className="blob blob-a" />
        <span className="blob blob-b" />
        <span className="blob blob-c" />
      </div>
      {showIOSBanner && (
        <div className="ios-install-banner">
          Tap <strong>Share</strong> → <strong>Add to Home Screen</strong> to enable notifications on iPhone.
          <button onClick={() => setShowIOSBanner(false)} aria-label="Dismiss">✕</button>
        </div>
      )}
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