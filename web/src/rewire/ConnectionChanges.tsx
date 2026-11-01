import type { CircuitDesign } from '../../../src/circuit/model';
import { compareDesigns } from '../../../src/rewire/diff';
import './connection-changes.css';

export default function ConnectionChanges({ before, after, revision, onSelectNet }: {
  before: CircuitDesign; after: CircuitDesign; revision: number; onSelectNet: (id: string) => void;
}) {
  const diff = compareDesigns(before, after);
  if (!diff.comparable) return null;
  const removed = diff.connections.filter(change => change.kind === 'leave');
  const added = diff.connections.filter(change => change.kind === 'join');
  return (
    <details className="connection-changes" open>
      <summary>Connection changes</summary>
      <p>Compared with revision {revision - 1}. These are changes to the draft, not a record of the wires on your bench.</p>
      {!removed.length && !added.length && !diff.nets.length && <p>No pin connections changed.</p>}
      {removed.length > 0 && <section><h3>Disconnect from the old draft</h3><ul>{removed.map(change => (
        <li key={`${change.net}:${change.endpoint.part}:${change.endpoint.pin}`}><span>{change.endpoint.part}.{change.endpoint.pin}</span> from {change.netName}</li>
      ))}</ul></section>}
      {added.length > 0 && <section><h3>Connect in this draft</h3><ul>{added.map(change => (
        <li key={`${change.net}:${change.endpoint.part}:${change.endpoint.pin}`}><span>{change.endpoint.part}.{change.endpoint.pin}</span> to <button type="button" onClick={() => onSelectNet(change.net)}>{change.netName}</button></li>
      ))}</ul></section>}
      {diff.nets.length > 0 && <section><h3>Electrical properties changed</h3><ul>{diff.nets.map(change => (
        <li key={change.net}>{change.netName}: {change.before} → {change.after}</li>
      ))}</ul></section>}
    </details>
  );
}
