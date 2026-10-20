import * as monaco from "monaco-editor";
import { isDismissible } from "../parser/diagnostics";

// "Ok" and "Don't show me this again" for a warning the user may hide, in the
// Code tab. Breakdown shows the same two as React buttons
// (DismissDiagnosticButtons.tsx). Here they are links in a hover, because a
// Monaco hover holds markdown, not components.
//
// HELPTIP EXCEPTION. CLAUDE.md wraps every interactive element in a HelpTip,
// and a link inside Monaco's hover cannot be wrapped in anything. The two
// links say what they do in their own words, and the Breakdown buttons
// carry the HelpTips (diagnostics.dismiss.ok and .never).
//
// Why a hover provider of its own rather than lines added to
// aoe2RmsHover.ts. That provider returns nothing when the help mode is off,
// and a warning's buttons must show whatever the help mode is, as the
// warning itself does.

/** What the links call, set by CodePane while it is mounted. */
export interface DiagnosticActionHandlers {
  hideForFile: (code: string) => void;
  turnOff: (code: string) => void;
}

// A module-level bridge from Monaco's global command registry into React.
// Commands are registered once for the whole app, but what they must change
// lives in React state, so the mounted CodePane hands its current callbacks
// in here and takes them out on unmount. A link clicked with no CodePane
// mounted (it cannot be, since the hover lives in its editor) does nothing.
let handlers: DiagnosticActionHandlers | null = null;

export function setDiagnosticActionHandlers(
  next: DiagnosticActionHandlers | null,
): void {
  handlers = next;
}

const HIDE_FOR_FILE = "aoe2rms.diagnostic.hideForFile";
const TURN_OFF = "aoe2rms.diagnostic.turnOff";

function link(label: string, command: string, code: string): string {
  const args = encodeURIComponent(JSON.stringify([code]));
  return `[${label}](command:${command}?${args})`;
}

let registered = false;

export function registerDiagnosticActions(): void {
  if (registered) return;
  registered = true;

  monaco.editor.registerCommand(HIDE_FOR_FILE, (_accessor, code: unknown) => {
    if (typeof code === "string") handlers?.hideForFile(code);
  });
  monaco.editor.registerCommand(TURN_OFF, (_accessor, code: unknown) => {
    if (typeof code === "string") handlers?.turnOff(code);
  });

  monaco.languages.registerHoverProvider("aoe2-rms", {
    provideHover(model, position) {
      const markers = monaco.editor
        .getModelMarkers({ resource: model.uri })
        .filter((marker) => {
          const code =
            typeof marker.code === "string" ? marker.code : marker.code?.value;
          if (code === undefined || !isDismissible(code)) return false;
          return new monaco.Range(
            marker.startLineNumber,
            marker.startColumn,
            marker.endLineNumber,
            marker.endColumn,
          ).containsPosition(position);
        });
      if (markers.length === 0) return null;
      const contents = markers.map((marker) => {
        const code =
          typeof marker.code === "string"
            ? marker.code
            : (marker.code?.value ?? "");
        return {
          value: `${link("Ok", HIDE_FOR_FILE, code)} · ${link("Don't show me this again", TURN_OFF, code)}`,
          // Command links only run when the markdown is trusted, and only
          // the two commands named here are allowed, so nothing else a
          // hover might contain can trigger a command.
          isTrusted: { enabledCommands: [HIDE_FOR_FILE, TURN_OFF] },
        };
      });
      return { range: undefined, contents };
    },
  });
}
