import { useCallback, useEffect, useRef, useState, type KeyboardEvent, type ReactElement } from "react";

export interface DialogButton {
  id: string;
  label: string;
  variant?: "primary" | "danger";
}

interface ChoiceRequest {
  kind: "choice";
  title: string;
  message: string;
  detail?: string;
  buttons: DialogButton[];
  /** Returned when the user presses Escape. */
  cancelId: string;
  resolve: (id: string) => void;
}

interface PromptRequest {
  kind: "prompt";
  title: string;
  label: string;
  initialValue: string;
  confirmLabel: string;
  /** Returns an error message, or null when the value is acceptable. */
  validate: (value: string) => string | null;
  resolve: (value: string | null) => void;
}

type DialogRequest = ChoiceRequest | PromptRequest;

export interface Dialogs {
  choose(options: Omit<ChoiceRequest, "kind" | "resolve">): Promise<string>;
  prompt(options: Omit<PromptRequest, "kind" | "resolve">): Promise<string | null>;
  notify(title: string, message: string, detail?: string): Promise<void>;
  isOpen: boolean;
  element: ReactElement | null;
}

/** Promise-based modal dialogs. One dialog shows at a time; others queue. */
export function useDialogs(): Dialogs {
  const [queue, setQueue] = useState<DialogRequest[]>([]);

  const choose = useCallback<Dialogs["choose"]>(
    (options) => new Promise((resolve) => setQueue((q) => [...q, { ...options, kind: "choice", resolve }])),
    []
  );
  const prompt = useCallback<Dialogs["prompt"]>(
    (options) => new Promise((resolve) => setQueue((q) => [...q, { ...options, kind: "prompt", resolve }])),
    []
  );
  const notify = useCallback<Dialogs["notify"]>(
    async (title, message, detail) => {
      await choose({ title, message, ...(detail ? { detail } : {}), buttons: [{ id: "ok", label: "OK", variant: "primary" }], cancelId: "ok" });
    },
    [choose]
  );

  const current = queue[0];
  const done = useCallback(() => setQueue((q) => q.slice(1)), []);
  const element = current ? <DialogView key={queue.length + current.title} request={current} onDone={done} /> : null;

  return { choose, prompt, notify, isOpen: current !== undefined, element };
}

function DialogView({ request, onDone }: { request: DialogRequest; onDone: () => void }) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [value, setValue] = useState(request.kind === "prompt" ? request.initialValue : "");
  const error = request.kind === "prompt" ? request.validate(value) : null;

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    const input = panel?.querySelector<HTMLInputElement>("input");
    if (input) {
      input.focus();
      // Select the name without its extension, like most file managers.
      const dot = input.value.lastIndexOf(".");
      input.setSelectionRange(0, dot > 0 ? dot : input.value.length);
    } else {
      panel?.querySelector<HTMLButtonElement>("button[data-default='true']")?.focus();
    }
    return () => previous?.focus();
  }, []);

  function finish(result: string | null) {
    if (request.kind === "choice") {
      request.resolve(result ?? request.cancelId);
    } else {
      request.resolve(result);
    }
    onDone();
  }

  function onKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (event.key === "Escape") {
      event.preventDefault();
      finish(null);
      return;
    }
    if (event.key === "Tab") {
      // Keep focus inside the dialog.
      const focusable = [...(panelRef.current?.querySelectorAll<HTMLElement>("button, input") ?? [])];
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    }
  }

  const titleId = "dialog-title";
  return (
    <div className="dialog-backdrop">
      <div
        ref={panelRef}
        className="dialog"
        role={request.kind === "choice" && request.buttons.some((b) => b.variant === "danger") ? "alertdialog" : "dialog"}
        aria-modal="true"
        aria-labelledby={titleId}
        onKeyDown={onKeyDown}
      >
        <h2 id={titleId}>{request.title}</h2>
        {request.kind === "choice" ? (
          <>
            <p className="dialog-message">{request.message}</p>
            {request.detail ? <p className="dialog-detail">{request.detail}</p> : null}
            <div className="dialog-buttons">
              {request.buttons.map((button) => (
                <button
                  key={button.id}
                  type="button"
                  className={`button ${button.variant ?? ""}`}
                  data-default={button.variant === "primary" ? "true" : undefined}
                  onClick={() => finish(button.id)}
                >
                  {button.label}
                </button>
              ))}
            </div>
          </>
        ) : (
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (error === null) {
                finish(value.trim());
              }
            }}
          >
            <label className="dialog-label">
              {request.label}
              <input
                value={value}
                onChange={(event) => setValue(event.target.value)}
                aria-invalid={error !== null}
                aria-describedby="dialog-error"
                spellCheck={false}
              />
            </label>
            <p id="dialog-error" className="dialog-error" role="status">
              {value.length > 0 ? error : ""}
            </p>
            <div className="dialog-buttons">
              <button type="button" className="button" onClick={() => finish(null)}>
                Cancel
              </button>
              <button type="submit" className="button primary" disabled={error !== null}>
                {request.confirmLabel}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
