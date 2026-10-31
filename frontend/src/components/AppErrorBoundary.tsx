import { Component, type ReactNode } from 'react';

export class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  declare props: Readonly<{ children: ReactNode }>;
  state = { failed: false };
  static getDerivedStateFromError() { return { failed: true }; }
  render() {
    if (!this.state.failed) return this.props.children;
    return <main className="min-h-screen bg-slate-950 p-10 text-cyan-50" role="alert">
      <h1 className="text-xl">FRIDAY’s interface hit a problem</h1>
      <p className="my-4">Saved files and memory have not been cleared. Reload to try again; unsaved edits may be lost.</p>
      <button className="rounded border border-cyan-300 px-4 py-2" onClick={() => window.location.reload()}>Reload FRIDAY</button>
    </main>;
  }
}
