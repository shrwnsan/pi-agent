// Stub for @earendil-works/pi-coding-agent — exposes only the runtime import
// the extension uses (getAgentDir). Type imports are erased by jiti.
export let agentDir = "";
export function getAgentDir() { return agentDir; }
export function __setAgentDir(d) { agentDir = d; }
