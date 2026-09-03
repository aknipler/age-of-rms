import React from "react";
import ReactDOM from "react-dom/client";
import * as monaco from "monaco-editor";
import "./editor/monacoSetup";
import { registerAoe2RmsLanguage } from "./editor/aoe2RmsLanguage";
import { registerAoe2RmsHoverProvider } from "./editor/aoe2RmsHover";
import { registerAoe2RmsMonacoThemePlaceholder } from "./editor/monacoTheme";
import App from "./App";

registerAoe2RmsLanguage();
registerAoe2RmsHoverProvider();
registerAoe2RmsMonacoThemePlaceholder(monaco);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
