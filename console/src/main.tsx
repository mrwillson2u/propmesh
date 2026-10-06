import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { PropStore } from "./lib/propStore";
import { SettingsProvider } from "./lib/settings";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <SettingsProvider>
      <PropStore>
        <App />
      </PropStore>
    </SettingsProvider>
  </React.StrictMode>
);
