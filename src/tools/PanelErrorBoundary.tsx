// Keeps a panel tool's render error inside the Advanced Tools pane.
//
// Without a boundary, a component that throws while rendering makes React
// unmount the whole tree, and the app goes blank with nothing to click. The
// Land Placement panel did exactly that on 2026-11-14 when + Land made a land
// the emitter could not write. That one cause is fixed at its source
// (`effectiveRepeatIndex`, `tryEmitAlpModel`). This boundary covers the next
// one nobody has found yet.
//
// An error boundary has to be a class component. React has no hook for
// catching a child's render error (`getDerivedStateFromError` and
// `componentDidCatch` are class lifecycle methods only), so this is the one
// standard exception to the repo's functional-components rule, not a project
// quirk.

import { Component, type ErrorInfo, type ReactNode } from "react";
import { HelpTip } from "../components/HelpTip";

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export class PanelErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  // Runs during the render that failed and swaps in the fallback below.
  // It must stay pure, so the logging lives in componentDidCatch instead.
  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.error("Tool panel crashed", error, info.componentStack);
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    return (
      <div role="alert">
        <p>
          This tool hit an error and stopped. The script is unchanged. (
          {error.message})
        </p>
        <HelpTip id="tools.panelError.retry">
          <button type="button" onClick={() => this.setState({ error: null })}>
            Try again
          </button>
        </HelpTip>
      </div>
    );
  }
}
