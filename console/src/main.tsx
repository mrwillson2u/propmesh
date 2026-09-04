import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { PropStore } from "./lib/propStore";
import "./styles.css";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <PropStore>
      <App />
    </PropStore>
  </React.StrictMode>
);
