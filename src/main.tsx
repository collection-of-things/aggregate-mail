// The interface is being rebuilt; see docs/KB.md#frontend-rebuild.
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./style.css";

createRoot(document.getElementById("root")!).render(<App />);
