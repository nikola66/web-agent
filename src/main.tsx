import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { initialize } from "./core/orchestrator";
import "./styles.css";

// Initialize orchestrator (loads credentials, requests storage persistence)
initialize().catch(console.error);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
