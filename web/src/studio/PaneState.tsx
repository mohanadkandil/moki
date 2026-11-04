import { createContext, useContext } from 'react';
import { PaneArt, type ArtName } from './PaneArt';

/** Which tab this pane belongs to and whether its build failed, so every state in that tab draws the same way. */
export const PaneContext = createContext<{ art: ArtName; failed: boolean }>({ art: 'bench', failed: false });

/** The canvas when there's nothing to draw yet, or the drawing failed. Says which, and why. */
export function PaneState({ what, error, absent, waiting }: { what: string; error?: string; absent?: string; waiting?: boolean }) {
  const { art, failed } = useContext(PaneContext);
  if (absent && waiting) return <div className="st-pane-state is-waiting" role="status"><PaneArt name={art} state="live" /><p>{absent}</p></div>;
  if (absent && failed) return <div className="st-pane-state is-failed" role="status"><PaneArt name={art} state="failed" /><p><strong>The build stopped before {what}.</strong></p><p>The error is in the chat.</p></div>;
  if (absent) return <div className="st-pane-state"><PaneArt name={art} state="idle" /><p>{absent}</p></div>;
  if (error) return <div className="st-pane-state is-failed" role="alert"><PaneArt name={art} state="failed" /><p><strong>{capitalized(what)} didn’t load.</strong></p><p>{error}</p></div>;
  return <div className="st-pane-state is-loading" role="status"><PaneArt name={art} state="live" /><p>Loading {what}</p></div>;
}

const capitalized = (text: string) => text.charAt(0).toUpperCase() + text.slice(1);
