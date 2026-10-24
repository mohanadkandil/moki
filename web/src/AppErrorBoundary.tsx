import { Component, type ReactNode } from 'react';

/** Keep saved work reachable if a view fails while a run result arrives. */
export default class AppErrorBoundary extends Component<{children:ReactNode}, {failed:boolean}> {
  state = {failed:false};
  static getDerivedStateFromError() { return {failed:true}; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="app-recovery" role="alert">
      <div><h1>The workshop hit a display error.</h1>
        <p>Your saved project and run files are still available. Reload to reopen them.</p>
        <button onClick={() => location.reload()}>Reopen this workshop</button>
        <a href="/">Back to your workshops</a>
      </div>
    </main>;
  }
}
