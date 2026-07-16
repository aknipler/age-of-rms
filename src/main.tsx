import React from "react";
import ReactDOM from "react-dom/client";
import "./editor/monacoSetup";
import { registerAoe2RmsLanguage } from "./editor/aoe2RmsLanguage";
import { registerAoe2RmsHoverProvider } from "./editor/aoe2RmsHover";
import App from "./App";

registerAoe2RmsLanguage();
registerAoe2RmsHoverProvider();

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
