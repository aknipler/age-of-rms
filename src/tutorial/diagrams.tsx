// The pictures a `diagram` body block names (types.ts, `DiagramName`). Drawn
// as inline SVG in the page, so every colour is a theme token from App.css
// and a picture switches with the theme like the rest of the card. The
// alternative, an SVG file in public/tutorial/ shown through `<img>`, is a
// separate document that cannot see the page's CSS variables, so it would be
// stuck with one set of colours that has to read on both a light and a dark
// card.

import type { ReactElement } from "react";
import type { ScreenPoint } from "../preview/render/projection";
import {
  startSquareDiagram,
  type DiagramPanel,
} from "./landGenerationComeer/startSquareDiagram";
import type { DiagramName } from "./types";
import styles from "./TutorialOverlay.module.css";

export function TutorialDiagram({
  name,
  alt,
}: {
  name: DiagramName;
  alt: string;
}): ReactElement {
  // A switch with no default, and a declared return type. A name added to
  // `DiagramName` without a picture here falls out of the switch, and the
  // compiler reports a function that can end without returning an element.
  switch (name) {
    case "start-square-overlap":
      return <StartSquareOverlap alt={alt} />;
  }
}

function points(corners: readonly ScreenPoint[]): string {
  return corners.map((p) => `${p.x},${p.y}`).join(" ");
}

/** Space between the two panels, in the same units as the map (one tile half-width). */
const PANEL_GAP = 24;

/**
 * Two copies of the map side by side. On the left the players are lined up
 * one above the other and their starting squares overlap. On the right they
 * are the same distance apart, lined up along an edge, and water is left
 * between the squares. The step's caption paragraph says which is which.
 */
function StartSquareOverlap({ alt }: { alt: string }) {
  const geometry = startSquareDiagram();
  const { width, height } = geometry;
  return (
    <svg
      className={styles.diagram}
      viewBox={`0 0 ${2 * width + PANEL_GAP} ${height}`}
      role="img"
      aria-label={alt}
    >
      <Panel map={geometry.map} panel={geometry.lined} />
      <g transform={`translate(${width + PANEL_GAP} 0)`}>
        <Panel map={geometry.map} panel={geometry.edge} />
      </g>
    </svg>
  );
}

function Panel({ map, panel }: { map: ScreenPoint[]; panel: DiagramPanel }) {
  return (
    <g>
      <polygon className={styles.diagramMap} points={points(map)} />
      {panel.squares.map((square, i) => (
        <polygon
          key={i}
          className={styles.diagramSquare}
          points={points(square)}
        />
      ))}
      {/* The ring after the squares, which cover most of it otherwise.
          Dashed, so the squares still read through it. */}
      <circle
        className={styles.diagramRing}
        cx={panel.ring.centre.x}
        cy={panel.ring.centre.y}
        r={panel.ring.radius}
      />
      {panel.overlap && (
        <polygon
          className={styles.diagramOverlap}
          points={points(panel.overlap)}
        />
      )}
      {panel.squares.map((square, i) => {
        // The centre of a diamond is the middle of its west and east corners.
        const x = (square[0].x + square[2].x) / 2;
        const y = (square[0].y + square[2].y) / 2;
        return (
          <circle
            key={i}
            className={styles.diagramPlayer}
            cx={x}
            cy={y}
            r={4}
          />
        );
      })}
    </g>
  );
}
