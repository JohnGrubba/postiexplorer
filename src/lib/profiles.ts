import type { ConnectionProfile } from "../types";

const KEY = "postiexplorer.profiles.v1";

export function loadProfiles(): ConnectionProfile[] {
  try {
    const raw = localStorage.getItem(KEY);
    if (!raw) return [];
    return JSON.parse(raw) as ConnectionProfile[];
  } catch {
    return [];
  }
}

export function saveProfiles(profiles: ConnectionProfile[]) {
  localStorage.setItem(KEY, JSON.stringify(profiles));
}

export function newProfile(): ConnectionProfile {
  return {
    id: Math.random().toString(36).slice(2),
    name: "Localhost",
    host: "localhost",
    port: 5432,
    user: "postgres",
    password: "",
    database: "",
    sslmode: "prefer",
  };
}
