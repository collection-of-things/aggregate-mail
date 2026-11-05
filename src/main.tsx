import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { BrowserSession } from "./BrowserSession";
import "@fontsource-variable/host-grotesk";
import "@fontsource-variable/geist-mono";
import "@fontsource/instrument-serif/400-italic.css";
import "./style.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <BrowserSession><App /></BrowserSession>
  </React.StrictMode>,
);
