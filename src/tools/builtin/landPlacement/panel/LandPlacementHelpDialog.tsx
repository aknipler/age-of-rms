// The Land Placement panel's own "how do I use this" dialog. Its own file
// rather than another section inside LandPlacementPanel.tsx, which is
// already the largest file in this tool and is all live controls. This is
// static prose and has no reason to re-render when the model changes.
//
// Kept as JSX rather than another reference/data/ui-help.json entry on
// purpose. A ui-help entry is a one-sentence tooltip about ONE control, and
// the HelpTip popup that renders it is plain text with no headings, no lists
// and no scrolling. This answers the different question of how the controls
// fit together, which is what a first-time user of a graph-and-fence model
// has to be told.
//
// Dismissal follows UnsavedChangesDialog and SettingsDialog exactly. Escape,
// the backdrop and the close button all mean the same harmless "close".
// There is nothing to decide here, so unlike UnsavedChangesDialog no latch
// is needed and a second dismissal is a no-op.

import { useEffect } from "react";
import { HelpTip } from "../../../../components/HelpTip";
import dialogStyles from "../../../../components/dialog.module.css";
import styles from "./LandPlacementHelpDialog.module.css";

export function LandPlacementHelpDialog({ onClose }: { onClose: () => void }) {
  // The cleanup function is the load-bearing half. Without it every
  // open/close cycle leaves another live listener on `window`, and each one
  // fires on the next Escape, so the fifth open closes on a keypress four
  // dead listeners also handled. `onClose` is in the dependency array
  // because a listener registered against an older `onClose` would be a
  // stale closure, calling a function the parent has since replaced.
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [onClose]);

  return (
    <div className={dialogStyles.overlay} onMouseDown={onClose}>
      <div
        className={`${dialogStyles.dialog} ${styles.helpDialog}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby="land-placement-help-title"
        // Stops a click INSIDE the box bubbling up to the overlay, which
        // would read as a backdrop click and close the dialog the moment
        // anyone tried to select the text in it.
        onMouseDown={(event) => event.stopPropagation()}
      >
        <h2 className={dialogStyles.title} id="land-placement-help-title">
          How Land Placement works
        </h2>

        <div className={styles.body}>
          <h3 className={styles.heading}>What the tool does</h3>
          <p>
            Build a layout of lands here, and the tool writes it into the script as its own fenced block. That block holds a table
            of <code>#const</code> lines carrying the position algebra, plus a <code>create_land</code> command for every land
            that does not have one yet. Nothing reaches the document until you press Apply, and an Apply lands as a single undo
            step.
          </p>

          <h3 className={styles.heading}>It only manages the block it wrote</h3>
          <p>
            The tool reads a layout back out of a fence comment that it wrote itself. A script with no such fence starts empty,
            even when that script already places lands by hand. Those lands are left exactly as they are, and the tree reads "No
            lands yet" until you add something. That is deliberate. There is no partial adopt, so the tool can never half-own
            algebra it did not write. To manage an existing layout, rebuild it here and Apply. To keep the hand-written one, leave
            the tool alone.
          </p>

          <h3 className={styles.heading}>Work in this order, role first</h3>
          <ul>
            <li>
              A <strong>role</strong> is a shared set of terrain, base size, elevation, land percent, zone policy and player
              assignment. Any number of lands wear one role, and editing the role edits every land wearing it.{" "}
              <code>+ Shape</code> and <code>+ Land</code> stay disabled until a role exists.
            </li>
            <li>
              <strong>+ Shape</strong> adds a circle of eight lands around the map centre at radius 30%, all wearing the first
              role. Radius, rotation and repeat count are edited on the shape itself rather than on its members, and the shape
              can be changed afterward (circle, line, arc, square, triangle, polygon) from its own editor.
            </li>
            <li>
              <strong>+ Land</strong> adds one standalone land, for a home base or a lone feature that belongs to no shape.
            </li>
          </ul>

          <h3 className={styles.heading}>Parents and frames</h3>
          <p>
            Every placement is measured from a parent, either the map centre or another placement. That chain is what the tree's
            indentation shows. In a <strong>radial</strong> frame the angle is measured at the parent, from the ray pointing back
            at the parent's own anchor, so turning a root turns the whole chain with it. An <strong>absolute</strong> frame uses a
            plain world bearing instead. An offset is polar (radius and angle), cartesian (dx and dy), or a custom formula.
          </p>
          <p>
            Radial only means something for a polar offset: it works by measuring FROM the parent's own angle, so it needs the
            parent to have one. Every ring shape, circle, line, arc, square, triangle and polygon alike, is a polar offset with a
            real angle to measure from, so a land chained to any of them keeps working as expected. Only a placement set to a
            cartesian or formula offset has no angle of its own, so a land parented to one of those falls back to a plain world
            bearing even with Frame set to radial, indistinguishable from absolute.
          </p>
          <p>Distances are percentages of the map dimension rather than tiles. Each field shows its tile equivalent beside it.</p>

          <h3 className={styles.heading}>The canvas</h3>
          <p>
            Two layers. Underneath sits a real generation of the current document, cut at the end of land placement, which is what
            the script does now. On top are the tool's own circles, drawn live from the model, which is what Apply would write.
          </p>
          <ul>
            <li>Click a circle to select it, or click a row in the tree. Clicking bare map clears the selection.</li>
            <li>Drag a land's middle to move it. A selected ring also grows a radius handle and a rotation handle.</li>
            <li>Drag the selected land's rim onto another land, or onto the map centre, to re-parent it.</li>
            <li>
              Drops snap to the tile lattice, and magnetically to the centre and the parent's axis. Hold <kbd>Ctrl</kbd> to snap
              to whole percentages instead.
            </li>
            <li>
              A drag that would overwrite a formula or a random parameter is refused rather than flattened to a number. The panel
              says which value stopped it.
            </li>
            <li>Drag bare map to pan, and use the wheel to zoom.</li>
          </ul>

          <h3 className={styles.heading}>The seed belongs to this panel</h3>
          <p>
            The number beside Re-roll is pinned when the tool opens and is separate from Breakdown and Code's seed, so switching
            tabs never resets the arrangement you are working against. It also means this canvas and the Breakdown preview will
            not agree unless their seeds happen to match.
          </p>

          <h3 className={styles.heading}>The warning strip</h3>
          <p>
            Anything about this script that limits what the tool can manage. Code the app can only show as raw text, along with
            the <code>create_land</code> commands hidden inside it; a random parameter emitted for a different player count; a
            player-assigned land with no <code>direct_placement</code> declared; a name that would collide with one already in
            the script; or a fence that could not be read. It is empty on a healthy script.
          </p>
        </div>

        <div className={dialogStyles.actions}>
          <HelpTip id="landPlacement.explainClose">
            <button type="button" className={dialogStyles.closeButton} onClick={onClose}>
              Close
            </button>
          </HelpTip>
        </div>
      </div>
    </div>
  );
}
