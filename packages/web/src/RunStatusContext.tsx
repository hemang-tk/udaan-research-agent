import { createContext, useContext, useState, type ReactNode } from "react";

/** Tracks whether a synthesis run is in progress, so the shell can disable
 *  navigation and action buttons app-wide while the pipeline is running. */
interface RunStatus {
  running: boolean;
  setRunning: (v: boolean) => void;
}

const RunStatusCtx = createContext<RunStatus>({ running: false, setRunning: () => {} });

export function RunStatusProvider({ children }: { children: ReactNode }) {
  const [running, setRunning] = useState(false);
  return <RunStatusCtx.Provider value={{ running, setRunning }}>{children}</RunStatusCtx.Provider>;
}

export function useRunStatus() {
  return useContext(RunStatusCtx);
}
