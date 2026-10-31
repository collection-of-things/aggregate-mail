import { useCallback, useEffect, useState } from "react";
import type { AgentProposal, Commitment, Project, ProjectDecision } from "../../shared/workspace";
import { request } from "../api";

export type Workspace = {
  commitments: (Commitment & { sourceUnavailable?: boolean })[];
  projects: Project[];
  decisions: ProjectDecision[];
  proposals: AgentProposal[];
};

/** The workspace records (Today, Projects, Agent review) with a reload. */
export function useWorkspace() {
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => request<Workspace>("/api/workspace")
    .then((data) => { setWorkspace(data); setError(null); })
    .catch((reason: Error) => setError(reason.message)), []);
  useEffect(() => { void load(); }, [load]);
  return { workspace, error, load };
}

/** Shows a notice for four seconds. */
export function useNotice() {
  const [notice, setNotice] = useState<string | null>(null);
  useEffect(() => {
    if (!notice) return;
    const timer = setTimeout(() => setNotice(null), 4000);
    return () => clearTimeout(timer);
  }, [notice]);
  return [notice, setNotice] as const;
}
