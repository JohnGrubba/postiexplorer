import { useEffect, useState } from "react";
import { Pencil, Plus, RefreshCw, Search, Trash2, Users } from "lucide-react";
import { alterRole, createRole, dropRole, getRoleMemberships, grantRole, listRoles, revokeRole } from "../lib/api";
import { DEFAULT_ROLE_OPTIONS, type RoleEntry, type RoleListResult, type RoleMemberships, type RoleOptions } from "../types";

function badge(text: string, tone: "neon" | "violet" | "grey" | "amber"): string {
  const tones = {
    neon: "bg-neon/15 text-neon",
    violet: "bg-violet2/20 text-violet-200",
    grey: "bg-white/5 text-slate-500",
    amber: "bg-amber-400/10 text-amber-300",
  };
  return `rounded px-1.5 py-0.5 font-mono text-[10px] font-semibold ${tones[tone]}`;
}

export default function RolesView({ connected }: { connected: boolean }) {
  const [list, setList] = useState<RoleListResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filter, setFilter] = useState("");
  const [showCreate, setShowCreate] = useState(false);
  const [editing, setEditing] = useState<RoleEntry | null>(null);
  const [deleting, setDeleting] = useState<RoleEntry | null>(null);
  const [saving, setSaving] = useState(false);
  const [mutError, setMutError] = useState<string | null>(null);

  async function load() {
    if (!connected) return;
    setLoading(true);
    setError(null);
    try {
      setList(await listRoles());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    setList(null);
    setFilter("");
    setMutError(null);
    if (connected) void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [connected]);

  if (!connected) {
    return (
      <div className="grid flex-1 place-items-center p-8">
        <div className="max-w-sm text-center">
          <Users size={20} className="mx-auto text-slate-600" />
          <div className="mt-2 text-sm font-semibold text-slate-200">Not connected</div>
          <div className="mt-1 text-[13px] text-slate-500">Connect to manage database roles.</div>
        </div>
      </div>
    );
  }

  const canManage = list?.is_superuser ?? false;
  const f = filter.toLowerCase();
  const roles = (list?.roles ?? []).filter((r) => !f || r.name.toLowerCase().includes(f));
  const btn =
    "flex h-8 items-center gap-1.5 rounded-lg border border-edge bg-white/5 px-2.5 text-xs text-slate-200 hover:bg-white/10 disabled:cursor-not-allowed disabled:opacity-40";

  async function handleDelete() {
    if (!deleting) return;
    setSaving(true);
    setMutError(null);
    try {
      await dropRole(deleting.name);
      setDeleting(null);
      await load();
    } catch (e) {
      setMutError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="flex shrink-0 flex-wrap items-center gap-2 border-b border-edge px-3 py-2">
        <div className="min-w-0 flex-1 truncate text-[13px] text-slate-300">
          <span className="font-semibold text-white">Roles</span>
          {list && <span className="ml-2 text-xs text-slate-500">{list.roles.length} roles · connected as {list.current_user}</span>}
          {list && !canManage && (
            <span className="ml-2 rounded-full bg-amber-400/10 px-2 py-0.5 text-[10px] text-amber-300" title="Role management requires superuser">
              read-only
            </span>
          )}
        </div>
        <div className="relative">
          <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-slate-500" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter roles…"
            className="h-8 w-44 rounded-lg border border-edge bg-void pl-7 pr-2 text-xs text-slate-200 outline-none placeholder:text-slate-600 focus:border-neon/60"
          />
        </div>
        <button onClick={() => setShowCreate(true)} disabled={!canManage} title={canManage ? "Create a new role" : "Requires superuser"} className={btn}>
          <Plus size={13} /> New role
        </button>
        <button onClick={() => load()} className={btn}>
          <RefreshCw size={13} className={loading ? "animate-spin" : ""} /> Refresh
        </button>
      </div>

      {error && <div className="shrink-0 border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{error}</div>}
      {mutError && !deleting && (
        <div className="shrink-0 border-b border-red-500/30 bg-red-500/10 px-3 py-2 text-xs text-red-300">{mutError}</div>
      )}

      <div className="min-h-0 flex-1 overflow-y-auto">
        {loading && !list ? (
          <div className="p-6 text-center text-sm text-slate-500">Loading roles…</div>
        ) : roles.length === 0 ? (
          <div className="p-6 text-center text-sm text-slate-500">{filter ? "No roles match the filter." : "No roles found."}</div>
        ) : (
          <div className="divide-y divide-white/[0.04]">
            {roles.map((r) => (
              <div key={r.name} className="flex flex-wrap items-center gap-2 px-3 py-2 hover:bg-white/[0.02]">
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-2">
                    <span className="truncate font-mono text-[13px] font-semibold text-white">{r.name}</span>
                    {list?.current_user === r.name && <span className={badge("you", "neon")}>you</span>}
                    {!r.can_login && <span className={badge("GROUP", "grey")}>group</span>}
                  </div>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {r.superuser && <span className={badge("SUPERUSER", "violet")}>SUPERUSER</span>}
                    <span className={badge(r.can_login ? "LOGIN" : "NOLOGIN", r.can_login ? "neon" : "grey")}>
                      {r.can_login ? "LOGIN" : "NOLOGIN"}
                    </span>
                    {r.create_db && <span className={badge("CREATEDB", "grey")}>CREATEDB</span>}
                    {r.create_role && <span className={badge("CREATEROLE", "grey")}>CREATEROLE</span>}
                    {r.replication && <span className={badge("REPLICATION", "grey")}>REPLICATION</span>}
                    {!r.inherit && <span className={badge("NOINHERIT", "amber")}>NOINHERIT</span>}
                    {r.conn_limit >= 0 && <span className={badge(`LIMIT ${r.conn_limit}`, "grey")}>LIMIT {r.conn_limit}</span>}
                    {r.valid_until && <span className={badge(`UNTIL ${r.valid_until}`, "amber")}>UNTIL {r.valid_until}</span>}
                    {r.member_count > 0 && <span className={badge(`${r.member_count} grants`, "grey")}>{r.member_count} grants</span>}
                  </div>
                </div>
                <button
                  onClick={() => {
                    setMutError(null);
                    setEditing(r);
                  }}
                  disabled={!canManage}
                  title={canManage ? `Edit ${r.name}` : "Requires superuser"}
                  className="grid h-7 w-7 place-items-center rounded-lg border border-edge bg-white/5 text-slate-300 hover:bg-white/10 disabled:opacity-40"
                >
                  <Pencil size={13} />
                </button>
                <button
                  onClick={() => {
                    setMutError(null);
                    setDeleting(r);
                  }}
                  disabled={!canManage || list?.current_user === r.name}
                  title={list?.current_user === r.name ? "Cannot drop the role you are connected as" : canManage ? `Drop ${r.name}` : "Requires superuser"}
                  className="grid h-7 w-7 place-items-center rounded-lg border border-edge bg-white/5 text-slate-300 hover:border-red-500/40 hover:text-red-300 disabled:opacity-40"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
          </div>
        )}
      </div>

      {showCreate && (
        <RoleDialog
          mode="create"
          saving={saving}
          error={mutError}
          onClose={() => {
            if (!saving) {
              setShowCreate(false);
              setMutError(null);
            }
          }}
          onSave={async (name, opts) => {
            setSaving(true);
            setMutError(null);
            try {
              await createRole(name, opts);
              setShowCreate(false);
              await load();
            } catch (e) {
              setMutError(e instanceof Error ? e.message : String(e));
            } finally {
              setSaving(false);
            }
          }}
        />
      )}

      {editing && (
        <RoleDialog
          mode="edit"
          initial={editing}
          allRoles={(list?.roles ?? []).map((r) => r.name)}
          saving={saving}
          error={mutError}
          onClose={() => {
            if (!saving) {
              setEditing(null);
              setMutError(null);
            }
          }}
          onSave={async (_name, opts) => {
            setSaving(true);
            setMutError(null);
            try {
              await alterRole(editing.name, opts);
              setEditing(null);
              await load();
            } catch (e) {
              setMutError(e instanceof Error ? e.message : String(e));
            } finally {
              setSaving(false);
            }
          }}
        />
      )}

      {deleting && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => !saving && setDeleting(null)}>
          <div className="w-full max-w-[400px] overflow-hidden rounded-2xl border border-edge bg-panel shadow-card" onClick={(e) => e.stopPropagation()}>
            <div className="border-b border-edge px-4 py-3 text-sm font-bold text-white">
              Drop role <span className="font-mono">{deleting.name}</span>?
            </div>
            <div className="px-4 py-3 text-[13px] text-slate-400">
              The role loses all memberships. Dropping fails if the role still owns objects — reassign or drop those first.
              {mutError && (
                <div className="mt-2 rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-2 font-mono text-[11px] text-red-300">{mutError}</div>
              )}
            </div>
            <div className="flex gap-2 border-t border-edge p-3">
              <button
                onClick={() => !saving && (setDeleting(null), setMutError(null))}
                disabled={saving}
                className="h-9 flex-1 rounded-lg border border-edge bg-white/5 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={() => void handleDelete()}
                disabled={saving}
                className="h-9 flex-1 rounded-lg bg-red-500/90 text-sm font-bold text-white hover:bg-red-500 disabled:opacity-50"
              >
                {saving ? "Dropping…" : "Drop"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RoleDialog({
  mode,
  initial,
  allRoles,
  saving,
  error,
  onClose,
  onSave,
}: {
  mode: "create" | "edit";
  initial?: RoleEntry;
  allRoles?: string[];
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onSave: (name: string, opts: RoleOptions) => Promise<void>;
}) {
  const [name, setName] = useState(initial?.name ?? "");
  const [password, setPassword] = useState("");
  const [showPw, setShowPw] = useState(false);
  const [canLogin, setCanLogin] = useState(initial?.can_login ?? DEFAULT_ROLE_OPTIONS.can_login);
  const [superuser, setSuperuser] = useState(initial?.superuser ?? false);
  const [createDb, setCreateDb] = useState(initial?.create_db ?? false);
  const [createRole, setCreateRole] = useState(initial?.create_role ?? false);
  const [inherit, setInherit] = useState(initial?.inherit ?? true);
  const [replication, setReplication] = useState(initial?.replication ?? false);
  const [connLimit, setConnLimit] = useState(String(initial?.conn_limit ?? -1));
  const [validUntil, setValidUntil] = useState(initial?.valid_until ?? "");

  // Memberships (edit mode).
  const [memberships, setMemberships] = useState<RoleMemberships | null>(null);
  const [grantTarget, setGrantTarget] = useState("");
  const [memBusy, setMemBusy] = useState(false);
  const [memError, setMemError] = useState<string | null>(null);

  useEffect(() => {
    if (mode !== "edit" || !initial) return;
    setMemError(null);
    getRoleMemberships(initial.name)
      .then(setMemberships)
      .catch((e) => setMemError(e instanceof Error ? e.message : String(e)));
  }, [mode, initial]);

  async function refreshMemberships() {
    if (!initial) return;
    try {
      setMemberships(await getRoleMemberships(initial.name));
    } catch (e) {
      setMemError(e instanceof Error ? e.message : String(e));
    }
  }

  const check = (label: string, value: boolean, set: (v: boolean) => void, hint?: string) => (
    <label className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2.5 py-2 text-xs text-slate-200" title={hint}>
      <input type="checkbox" checked={value} onChange={(e) => set(e.target.checked)} className="h-3.5 w-3.5 accent-cyan-400" />
      <span className="font-mono">{label}</span>
    </label>
  );

  async function submit() {
    const limit = Number(connLimit);
    const vt = validUntil.trim();
    await onSave(name.trim(), {
      password: password === "" ? null : password,
      can_login: canLogin,
      superuser,
      create_db: createDb,
      create_role: createRole,
      inherit,
      replication,
      // Invalid limits are rejected again server-side with a clear message.
      conn_limit: Number.isInteger(limit) ? limit : -2,
      valid_until: vt === "" ? (mode === "edit" ? "" : null) : vt,
    });
  }

  const grantables = (allRoles ?? []).filter((r) => r !== initial?.name && !(memberships?.member_of ?? []).includes(r));

  return (
    <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-black/60 p-4 backdrop-blur-sm" onClick={() => !saving && onClose()}>
      <div className="my-8 w-full max-w-[520px] overflow-hidden rounded-2xl border border-edge bg-panel shadow-card" onClick={(e) => e.stopPropagation()}>
        <div className="border-b border-edge px-4 py-3 text-sm font-bold text-white">
          {mode === "create" ? "Create role" : <>Edit role <span className="font-mono">{initial?.name}</span></>}
        </div>
        <div className="max-h-[65vh] space-y-3 overflow-y-auto px-4 py-3">
          {mode === "create" && (
            <label className="block">
              <span className="mb-1 block text-xs text-slate-400">Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="app_reader"
                spellCheck={false}
                className="h-9 w-full rounded-lg border border-edge bg-void px-2.5 font-mono text-[13px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-neon/60"
              />
            </label>
          )}
          <label className="block">
            <span className="mb-1 block text-xs text-slate-400">
              Password {mode === "edit" && <span className="text-slate-600">(empty = unchanged)</span>}
            </span>
            <div className="flex gap-2">
              <input
                type={showPw ? "text" : "password"}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={mode === "edit" ? "Unchanged" : "No password"}
                className="h-9 min-w-0 flex-1 rounded-lg border border-edge bg-void px-2.5 font-mono text-[13px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-neon/60"
              />
              <button onClick={() => setShowPw((v) => !v)} className="h-9 shrink-0 rounded-lg border border-edge bg-white/5 px-2.5 text-xs text-slate-300 hover:bg-white/10">
                {showPw ? "Hide" : "Show"}
              </button>
            </div>
          </label>
          <div className="grid grid-cols-2 gap-2">
            {check("LOGIN", canLogin, setCanLogin, "Can connect (a user); off = group")}
            {check("SUPERUSER", superuser, setSuperuser, "Bypasses all permission checks")}
            {check("CREATEDB", createDb, setCreateDb)}
            {check("CREATEROLE", createRole, setCreateRole)}
            {check("INHERIT", inherit, setInherit, "Inherits privileges of granted roles")}
            {check("REPLICATION", replication, setReplication, "Can initiate streaming replication")}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <label className="block">
              <span className="mb-1 block text-xs text-slate-400">Connection limit (-1 = unlimited)</span>
              <input
                value={connLimit}
                onChange={(e) => setConnLimit(e.target.value)}
                inputMode="numeric"
                className="h-9 w-full rounded-lg border border-edge bg-void px-2.5 font-mono text-[13px] text-slate-100 outline-none focus:border-neon/60"
              />
            </label>
            <label className="block">
              <span className="mb-1 block text-xs text-slate-400">
                Valid until {mode === "edit" && <span className="text-slate-600">(empty clears)</span>}
              </span>
              <input
                value={validUntil}
                onChange={(e) => setValidUntil(e.target.value)}
                placeholder="2027-01-01 00:00"
                spellCheck={false}
                className="h-9 w-full rounded-lg border border-edge bg-void px-2.5 font-mono text-[13px] text-slate-100 outline-none placeholder:text-slate-600 focus:border-neon/60"
              />
            </label>
          </div>

          {mode === "edit" && initial && (
            <div className="space-y-2 rounded-xl border border-edge p-2.5">
              <div className="text-xs font-semibold text-slate-300">Memberships</div>
              {memError && <div className="rounded-lg border border-red-500/30 bg-red-500/10 px-2.5 py-2 font-mono text-[11px] text-red-300">{memError}</div>}
              <div className="text-[11px] text-slate-500">Member of (inherits from):</div>
              {(memberships?.member_of ?? []).length === 0 && <div className="text-[11px] text-slate-600">— none —</div>}
              {(memberships?.member_of ?? []).map((m) => (
                <div key={m} className="flex items-center gap-2 rounded-lg bg-white/[0.03] px-2 py-1.5 font-mono text-xs text-slate-200">
                  <span className="flex-1 truncate">{m}</span>
                  <button
                    disabled={memBusy}
                    onClick={async () => {
                      setMemBusy(true);
                      setMemError(null);
                      try {
                        await revokeRole(initial.name, m);
                        await refreshMemberships();
                      } catch (e) {
                        setMemError(e instanceof Error ? e.message : String(e));
                      } finally {
                        setMemBusy(false);
                      }
                    }}
                    className="text-slate-500 hover:text-red-300 disabled:opacity-40"
                  >
                    Revoke
                  </button>
                </div>
              ))}
              <div className="flex gap-2">
                <select
                  value={grantTarget}
                  onChange={(e) => setGrantTarget(e.target.value)}
                  className="h-8 min-w-0 flex-1 rounded-lg border border-edge bg-void px-2 font-mono text-xs text-slate-200"
                >
                  <option value="">Make member of…</option>
                  {grantables.map((r) => (
                    <option key={r} value={r}>{r}</option>
                  ))}
                </select>
                <button
                  disabled={memBusy || !grantTarget}
                  onClick={async () => {
                    setMemBusy(true);
                    setMemError(null);
                    try {
                      await grantRole(grantTarget, initial.name);
                      setGrantTarget("");
                      await refreshMemberships();
                    } catch (e) {
                      setMemError(e instanceof Error ? e.message : String(e));
                    } finally {
                      setMemBusy(false);
                    }
                  }}
                  className="h-8 shrink-0 rounded-lg border border-edge bg-white/5 px-2.5 text-xs text-slate-200 hover:bg-white/10 disabled:opacity-40"
                >
                  Grant
                </button>
              </div>
              {(memberships?.members ?? []).length > 0 && (
                <div className="text-[11px] text-slate-500">Has members: <span className="font-mono text-slate-400">{memberships!.members.join(", ")}</span></div>
              )}
            </div>
          )}

          {error && <div className="rounded-xl border border-red-500/30 bg-red-500/10 px-3 py-2 font-mono text-xs text-red-300">{error}</div>}
        </div>
        <div className="flex gap-2 border-t border-edge p-3">
          <button
            onClick={() => !saving && onClose()}
            disabled={saving}
            className="h-9 flex-1 rounded-lg border border-edge bg-white/5 text-sm text-slate-200 hover:bg-white/10 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void submit()}
            disabled={saving || (mode === "create" && !name.trim())}
            className="h-9 flex-1 rounded-lg bg-gradient-to-r from-neon to-violet2 text-sm font-bold text-void disabled:opacity-50"
          >
            {saving ? "Saving…" : mode === "create" ? "Create" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}
