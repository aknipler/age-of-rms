import React from "react";
import ReactDOM from "react-dom/client";
import * as monaco from "monaco-editor";
import "./editor/monacoSetup";
import { registerAoe2RmsLanguage } from "./editor/aoe2RmsLanguage";
import { registerAoe2RmsHoverProvider } from "./editor/aoe2RmsHover";
import { registerDiagnosticActions } from "./editor/diagnosticActions";
import { registerAoe2RmsCompletion } from "./editor/aoe2RmsCompletion";
import { registerAoe2RmsPrediction } from "./editor/aoe2RmsPrediction";
import { registerConstActions } from "./editor/constActions";
import { registerAoe2RmsMonacoThemePlaceholder } from "./editor/monacoTheme";
import "@fontsource/cinzel/latin-600.css";
import "@fontsource/cinzel/latin-700.css";
import App from "./App";
import { PERF_TRACE, perfReactCommit } from "./perfTrace";

registerAoe2RmsLanguage();
registerAoe2RmsHoverProvider();
registerDiagnosticActions();
registerAoe2RmsCompletion();
registerAoe2RmsPrediction();
registerConstActions();
registerAoe2RmsMonacoThemePlaceholder(monaco);

// <Profiler> reports how long each React commit took to render (only in a
// development build, React strips the timing from production ones). It is
// added only when the trace is on, so a normal run renders the same tree as
// before. PERF_TRACE never changes while the page is open, so the tree shape
// is fixed for the whole session and nothing remounts.
const app = PERF_TRACE ? (
  <React.Profiler id="app" onRender={perfReactCommit}>
    <App />
  </React.Profiler>
) : (
  <App />
);

ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <React.StrictMode>{app}</React.StrictMode>,
);
