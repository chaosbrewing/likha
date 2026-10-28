import type { ReactNode } from "react";

export type PanelTab = "terminal" | "output" | "problems";

export interface OutputEntry {
  id: number;
  time: string;
  level: "info" | "error";
  message: string;
}

export interface Problem {
  path: string;
  line: number;
  column: number;
  severity: "error" | "warning" | "info";
  message: string;
}

interface BottomPanelProps {
  tab: PanelTab;
  onTab(tab: PanelTab): void;
  onHide(): void;
  terminal: ReactNode;
  output: OutputEntry[];
  problems: Problem[];
  /** Null until the language server has checked the project; then how much it covered. */
  problemsScope: { filesChecked: number; truncated: boolean } | null;
  onOpenProblem(problem: Problem): void;
  height: number;
  onResize(height: number): void;
}

export function BottomPanel(props: BottomPanelProps) {
  const errors = props.problems.filter((p) => p.severity === "error").length;
  const tabs: [PanelTab, string][] = [
    ["terminal", "Terminal"],
    ["output", "Output"],
    ["problems", `Problems${props.problems.length ? ` (${props.problems.length})` : ""}`]
  ];

  function startResize(event: React.PointerEvent<HTMLDivElement>) {
    const startY = event.clientY;
    const startHeight = props.height;
    const move = (e: PointerEvent) => props.onResize(Math.max(120, Math.min(window.innerHeight - 200, startHeight + startY - e.clientY)));
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  return (
    <section className="bottom-panel" style={{ height: props.height }} aria-label="Panel">
      <div className="panel-resizer" onPointerDown={startResize} role="separator" aria-orientation="horizontal" aria-label="Resize panel" />
      <div className="panel-header">
        <div role="tablist" aria-label="Panel views" className="panel-tabs">
          {tabs.map(([id, label]) => (
            <button key={id} type="button" role="tab" aria-selected={props.tab === id} className={`panel-tab${props.tab === id ? " active" : ""}`} onClick={() => props.onTab(id)}>
              {label}
              {id === "problems" && errors > 0 ? <span className="badge">{errors}</span> : null}
            </button>
          ))}
        </div>
        <button type="button" className="icon-button" aria-label="Hide panel (Ctrl+`)" title="Hide panel (Ctrl+`)" onClick={props.onHide}>
          <span className="codicon codicon-chevron-down" aria-hidden="true" />
        </button>
      </div>
      <div className="panel-body">
        <div className="panel-view" hidden={props.tab !== "terminal"}>
          {props.terminal}
        </div>
        {props.tab === "output" ? (
          <ol className="output-list" aria-live="polite">
            {props.output.length === 0 ? <li className="panel-message">Nothing logged yet.</li> : null}
            {props.output.map((entry) => (
              <li key={entry.id} className={entry.level}>
                <time>{entry.time}</time> {entry.message}
              </li>
            ))}
          </ol>
        ) : null}
        {props.tab === "problems" ? (
          <ul className="problem-list">
            {props.problems.length === 0 ? (
              <li className="panel-message">
                {props.problemsScope ? `No problems detected in the project (${props.problemsScope.filesChecked} source file${props.problemsScope.filesChecked === 1 ? "" : "s"} checked).` : "No problems detected in open files."}
              </li>
            ) : null}
            {props.problemsScope?.truncated ? <li className="panel-message">The project has more source files than LIKHA checks; only the first files are included.</li> : null}
            {props.problems.map((problem, index) => (
              <li key={index}>
                <button type="button" onClick={() => props.onOpenProblem(problem)}>
                  <span className={`codicon codicon-${problem.severity === "error" ? "error" : problem.severity === "warning" ? "warning" : "info"} ${problem.severity}`} aria-label={problem.severity} />
                  <span className="problem-message">{problem.message}</span>
                  <span className="problem-location">
                    {problem.path}:{problem.line}:{problem.column}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>
    </section>
  );
}
