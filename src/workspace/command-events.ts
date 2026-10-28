const COMMAND_EVENT = "agri-terminal:command";

/**
 * Asks the workspace to run a command-bar command, as if it were typed. Returns false when nothing
 * ran it, as in a pop-out window, which has no workspace of its own.
 */
export function requestCommand(text: string): boolean {
  return !window.dispatchEvent(new CustomEvent(COMMAND_EVENT, { detail: text, cancelable: true }));
}

/** Runs commands requested by panels. Returns a function that stops listening. */
export function onCommandRequest(handler: (text: string) => void) {
  const listener = (event: Event) => {
    event.preventDefault();
    handler((event as CustomEvent<string>).detail);
  };
  window.addEventListener(COMMAND_EVENT, listener);
  return () => window.removeEventListener(COMMAND_EVENT, listener);
}
