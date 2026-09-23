import React, { useEffect, useRef, useState } from "react";

const GRADES = [
  ["toddler", "Toddler"], ["preschool", "Preschool"], ["kindergarten", "Kindergarten"],
  ...Array.from({ length: 12 }, (_, i) => {
    const n = i + 1;
    const suffix = n === 1 ? "st" : n === 2 ? "nd" : n === 3 ? "rd" : "th";
    return [String(n), `${n}${suffix} Grade`];
  }),
  ["college", "College"],
];
const GROUPS = [["kids", "Kids"], ["ms", "Middle School"], ["hs", "High School"], ["college", "College"], ["leaders", "Leaders"]];
const id = () => crypto.randomUUID();
const gradeName = grade => GRADES.find(([value]) => value === String(grade))?.[1] || "";
const gradeOrder = grade => { const i = GRADES.findIndex(([value]) => value === String(grade)); return i < 0 ? 99 : i; };
function gradeGroup(grade) {
  const v = String(grade ?? "");
  if (["toddler", "preschool", "kindergarten", "1", "2", "3", "4"].includes(v)) return "kids";
  if (["5", "6", "7", "8"].includes(v)) return "ms";
  if (["9", "10", "11", "12"].includes(v)) return "hs";
  if (v === "college") return "college";
  return "";
}
const groupOf = p => p.type === "leader" ? "leaders" : gradeGroup(p.grade) || p.group || "";
const groupName = group => GROUPS.find(([value]) => value === group)?.[1] || "Unassigned";
const dateName = birthday => {
  if (!birthday) return "";
  const [m, d] = birthday.split("-").map(Number);
  return m && d ? new Date(2000, m - 1, d).toLocaleDateString("en-US", { month: "long", day: "numeric" }) : birthday;
};
const weekStart = () => {
  const now = new Date(new Date().toLocaleString("en-US", { timeZone: "America/New_York" }));
  now.setDate(now.getDate() - ((now.getDay() + 6) % 7));
  now.setHours(0, 0, 0, 0);
  return now;
};
const weekKey = () => { const d = weekStart(); return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`; };
const prayedThisWeek = p => p.prayedWeekDate ? p.prayedWeekDate === weekKey() : !!p.prayedAt && new Date(p.prayedAt) >= weekStart();
const birthdayDays = birthday => {
  if (!birthday) return 999;
  const [m, d] = birthday.split("-").map(Number);
  if (!m || !d) return 999;
  const now = new Date();
  const next = new Date(now.getFullYear(), m - 1, d);
  if (next < new Date(now.getFullYear(), now.getMonth(), now.getDate())) next.setFullYear(next.getFullYear() + 1);
  return Math.round((next - new Date(now.getFullYear(), now.getMonth(), now.getDate())) / 86400000);
};
const request = async (url, method = "GET", body) => {
  const response = await fetch(url, { method, ...(body === undefined ? {} : { headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) }) });
  if (!response.ok) throw new Error(`Request failed (${response.status})`);
  return response.json();
};
function csvCells(line) {
  const cells = [];
  let current = "", quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"' && quoted && line[i + 1] === '"') { current += '"'; i++; }
    else if (line[i] === '"') quoted = !quoted;
    else if (line[i] === "," && !quoted) { cells.push(current.trim()); current = ""; }
    else current += line[i];
  }
  cells.push(current.trim());
  return cells;
}
function parseCSV(text) {
  const lines = text.replace(/^\uFEFF/, "").split(/\r?\n/).filter(Boolean);
  if (lines.length < 2) return [];
  const headings = csvCells(lines[0]).map(s => s.toLowerCase().replace(/[^a-z]/g, ""));
  const index = (...names) => headings.findIndex(h => names.includes(h));
  const first = index("firstname", "first"), last = index("lastname", "last"), full = index("name", "fullname", "student");
  const grade = index("grade", "agelevel"), school = index("school", "schoolname", "college");
  const birthday = index("birthday", "dob", "birthdate"), role = index("type", "role"), group = index("group", "agegroup");
  return lines.slice(1).map(line => {
    const c = csvCells(line), name = (full >= 0 ? c[full] : `${c[first] || ""} ${c[last] || ""}`).trim();
    if (!name) return null;
    const rawGrade = (c[grade] || "").toLowerCase().replace(/^grade\s*/, "").replace(/(st|nd|rd|th)(\s+grade)?$/, "").trim();
    const g = GRADES.some(([value]) => value === rawGrade) ? rawGrade : "";
    const date = c[birthday] || "";
    const match = date.match(/^(?:\d{4}-)?(\d{1,2})[-/](\d{1,2})/);
    const bday = match ? `${match[1].padStart(2, "0")}-${match[2].padStart(2, "0")}` : "";
    const kind = (c[role] || "").toLowerCase() === "leader" ? "leader" : "student";
    const chosen = (c[group] || "").toLowerCase();
    return { id: id(), name, type: kind, grade: g || null, group: gradeGroup(g) || (GROUPS.some(([v]) => v === chosen) ? chosen : null), school: c[school] || "", birthday: bday, active: true, prayedAt: null, prayerRequests: [], updatedAt: Date.now() };
  }).filter(Boolean);
}

export default function App() {
  const [settings, setSettings] = useState(undefined);
  const [setup, setSetup] = useState({ name: "", sub: "", password: "", confirm: "" });
  const [people, setPeople] = useState([]), [loaded, setLoaded] = useState(false);
  const [view, setView] = useState("pray"), [filter, setFilter] = useState("all"), [rosterFilter, setRosterFilter] = useState("all");
  const [sort, setSort] = useState("name"), [index, setIndex] = useState(0), [selected, setSelected] = useState("");
  const [admin, setAdmin] = useState(false), [loginOpen, setLoginOpen] = useState(false), [password, setPassword] = useState("");
  const [newPassword, setNewPassword] = useState(""), [confirmPassword, setConfirmPassword] = useState("");
  const [add, setAdd] = useState({ name: "", type: "student", grade: "", group: "", birthday: "", school: "" });
  const [search, setSearch] = useState(""), [importRows, setImportRows] = useState([]), [history, setHistory] = useState([]);
  const [message, setMessage] = useState(""), [requestText, setRequestText] = useState("");
  const remote = useRef(false), timer = useRef(null), pending = useRef(false), touch = useRef(0);

  useEffect(() => {
    request("/api/data?key=settings").then(setSettings).catch(() => { setMessage("Could not load settings. Refresh to try again."); });
    request("/api/data?key=auth").then(result => setAdmin(!!result.authenticated)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!settings) return;
    Promise.all([request("/api/data"), request("/api/history").catch(() => [])])
      .then(([roster, weeks]) => { remote.current = true; setPeople(Array.isArray(roster) ? roster : []); setHistory(weeks); setLoaded(true); })
      .catch(() => setMessage("Could not load the roster. Refresh to try again."));
  }, [settings]);
  useEffect(() => {
    if (!loaded) return;
    if (remote.current) { remote.current = false; return; }
    if (!admin || !people.length) return;
    pending.current = true;
    clearTimeout(timer.current);
    timer.current = setTimeout(() => {
      request("/api/data", "POST", people).then(() => setMessage("")).catch(() => setMessage("Changes could not be saved. Check your admin session."))
        .finally(() => { pending.current = false; });
    }, 500);
    return () => clearTimeout(timer.current);
  }, [people, loaded, admin]);
  useEffect(() => {
    if (!loaded) return;
    const poll = setInterval(() => {
      if (pending.current) return;
      request("/api/data").then(rows => {
        if (!Array.isArray(rows) || !rows.length) return;
        setPeople(old => {
          if (JSON.stringify(old) === JSON.stringify(rows)) return old;
          remote.current = true;
          return rows;
        });
      }).catch(() => {});
    }, 15000);
    return () => clearInterval(poll);
  }, [loaded]);

  const active = people.filter(p => p.active !== false), prayed = active.filter(prayedThisWeek);
  const inGroup = (p, group) => group === "all" || groupOf(p) === group;
  const deck = active.filter(p => inGroup(p, filter) && !prayedThisWeek(p));
  const current = active.find(p => p.id === selected) || deck[Math.min(index, Math.max(deck.length - 1, 0))];
  const roster = active.filter(p => inGroup(p, rosterFilter)).sort((a, b) => {
    if (sort === "grade") return gradeOrder(a.grade) - gradeOrder(b.grade) || a.name.localeCompare(b.name);
    if (sort === "birthday") return birthdayDays(a.birthday) - birthdayDays(b.birthday) || a.name.localeCompare(b.name);
    return a.name.localeCompare(b.name);
  });
  const update = (personId, patch) => setPeople(old => old.map(p => p.id === personId ? { ...p, ...patch, updatedAt: Date.now() } : p));
  const openCard = personId => { setSelected(personId); setView("pray"); setMessage(""); };
  const move = amount => { setSelected(""); setIndex(i => deck.length ? (i + amount + deck.length) % deck.length : 0); };

  async function mark(undo = false) {
    if (!current) return;
    try {
      const person = await request("/api/data", "PATCH", { id: current.id, undo });
      remote.current = true;
      setPeople(old => old.map(p => p.id === person.id ? person : p));
      setSelected(""); setMessage("");
    } catch { setMessage("Could not update prayer progress. Try again."); }
  }
  async function login() {
    try { await request("/api/data?key=auth", "POST", { password }); setAdmin(true); setLoginOpen(false); setPassword(""); setMessage(""); }
    catch { setMessage("Incorrect password or connection error."); }
  }
  async function changePassword() {
    if (newPassword.length < 12 || newPassword !== confirmPassword) return setMessage("Use matching passwords of at least 12 characters.");
    try { await request("/api/data?key=auth", "PUT", { newPassword }); setNewPassword(""); setConfirmPassword(""); setMessage("Password changed."); }
    catch { setMessage("Could not change the password."); }
  }
  async function createSetup() {
    if (!setup.name.trim() || setup.password.length < 12 || setup.password !== setup.confirm) return setMessage("Enter a ministry name and matching passwords of at least 12 characters.");
    try { await request("/api/data?key=settings", "POST", { name: setup.name.trim(), sub: setup.sub.trim(), password: setup.password }); setSettings({ name: setup.name.trim(), sub: setup.sub.trim() }); setMessage(""); }
    catch { setMessage("Setup could not be saved. Refresh and try again."); }
  }
  function addPerson() {
    if (!add.name.trim()) return;
    setPeople(old => [...old, { id: id(), name: add.name.trim(), type: add.type, grade: add.type === "student" ? add.grade || null : null,
      group: add.type === "student" ? gradeGroup(add.grade) || add.group || null : null, school: add.type === "student" ? add.school.trim() : "",
      birthday: add.birthday || "", prayerRequests: [], prayedAt: null, active: true, updatedAt: Date.now() }]);
    setAdd({ name: "", type: "student", grade: "", group: "", birthday: "", school: "" });
  }
  function promote() {
    if (!window.confirm("Move every student up one age level or grade? College remains College.")) return;
    setPeople(old => old.map(p => {
      const n = GRADES.findIndex(([value]) => value === String(p.grade));
      if (p.type !== "student" || n < 0 || n === GRADES.length - 1) return p;
      const grade = GRADES[n + 1][0];
      return { ...p, grade, group: gradeGroup(grade), updatedAt: Date.now() };
    }));
  }
  function exportCSV() {
    const quote = v => `"${String(v ?? "").replace(/"/g, '""')}"`;
    const lines = [["First Name", "Last Name", "Type", "Group", "Grade", "School", "Birthday"], ...active.map(p => {
      const [first, ...rest] = p.name.split(" ");
      return [first, rest.join(" "), p.type, groupOf(p), p.grade, p.school, p.birthday];
    })].map(row => row.map(quote).join(",")).join("\n");
    const url = URL.createObjectURL(new Blob([lines], { type: "text/csv" }));
    const a = document.createElement("a"); a.href = url; a.download = "church-prayer-roster.csv"; a.click(); URL.revokeObjectURL(url);
  }

  if (settings === undefined) return <main className="shell"><p>{message || "Loading…"}</p></main>;
  if (settings === null) return <main className="shell"><Styles /><h1>Let’s Pray</h1><p>One-time setup</p>
    <input placeholder="Church or ministry name" value={setup.name} onChange={e => setSetup({ ...setup, name: e.target.value })} />
    <input placeholder="Subtitle (optional)" value={setup.sub} onChange={e => setSetup({ ...setup, sub: e.target.value })} />
    <input type="password" placeholder="Admin password (12+ characters)" value={setup.password} onChange={e => setSetup({ ...setup, password: e.target.value })} />
    <input type="password" placeholder="Confirm password" value={setup.confirm} onChange={e => setSetup({ ...setup, confirm: e.target.value })} />
    <button className="primary" onClick={createSetup}>Get started</button>{message && <p role="alert">{message}</p>}</main>;
  if (!loaded) return <main className="shell"><Styles /><p>{message || "Loading roster…"}</p></main>;

  return <><Styles /><main className="shell">
    <header><div><h1>{settings.name}</h1><small>{settings.sub || "Let’s Pray"}</small></div><div className="count">{prayed.length} / {active.length} prayed this week</div></header>
    <div className="progress"><div style={{ width: active.length ? `${100 * prayed.length / active.length}%` : "0%" }} /></div>
    <nav>{[["pray", "Pray"], ["week", "Week"], ["roster", "Roster"], ...(admin ? [["people", "People"], ["report", "Report"], ["import", "Import"]] : [])].map(([value, label]) =>
      <button key={value} className={view === value ? "on" : ""} onClick={() => setView(value)}>{label}</button>)}</nav>
    {message && <p className="notice" role="status">{message}</p>}

    {view === "pray" && <section>
      <div className="controls"><label>Pray for <select value={filter} onChange={e => { setFilter(e.target.value); setSelected(""); setIndex(0); }}>
        <option value="all">Everyone</option>{GROUPS.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></label>
        <select value={selected} onChange={e => setSelected(e.target.value)} aria-label="Find a person"><option value="">Choose a person</option>{active.filter(p => inGroup(p, filter)).sort((a, b) => a.name.localeCompare(b.name)).map(p => <option key={p.id} value={p.id}>{p.name}</option>)}</select></div>
      {current ? <><article className="prayer-card" onTouchStart={e => { touch.current = e.touches[0].clientX; }} onTouchEnd={e => { const d = e.changedTouches[0].clientX - touch.current; if (Math.abs(d) > 60) move(d < 0 ? 1 : -1); }}>
        <div className="tags"><span>{current.type === "leader" ? "Leader" : "Student"}</span>{current.type !== "leader" && <span>{groupName(groupOf(current))}</span>}{current.grade && current.type === "student" && <span>{gradeName(current.grade)}</span>}</div>
        <h2>{current.name}</h2>
        {current.birthday && <p>🎂 Birthday: {dateName(current.birthday)}{birthdayDays(current.birthday) === 0 ? " — Today!" : ""}</p>}
        {current.school && <p>School: {current.school}</p>}
        <p className="muted">{prayedThisWeek(current) ? "✓ Prayed for this week" : current.prayedAt ? `Last prayed: ${new Date(current.prayedAt).toLocaleDateString()}` : "Not yet prayed for"}</p>
        <div className="requests"><h3>Prayer requests</h3>{(current.prayerRequests || []).length ? current.prayerRequests.map((req, i) => <div key={i} className="request">
          <span>{typeof req === "string" ? req : req.text}</span>{admin && <button title="Remove request" onClick={() => update(current.id, { prayerRequests: current.prayerRequests.filter((_, n) => n !== i) })}>×</button>}
        </div>) : <p className="muted">No requests shared yet.</p>}
        {admin && <div className="inline"><input placeholder="Add a shared prayer request" value={requestText} onChange={e => setRequestText(e.target.value)} /><button onClick={() => { if (!requestText.trim()) return; update(current.id, { prayerRequests: [...(current.prayerRequests || []), requestText.trim()] }); setRequestText(""); }}>Add</button></div>}</div>
      </article><div className="card-actions"><button onClick={() => move(-1)}>← Previous</button><button className="primary" onClick={() => mark(false)}>{prayedThisWeek(current) ? "Pray Again" : "Mark as Prayed"}</button><button onClick={() => move(1)}>Next →</button></div>
      {prayedThisWeek(current) && <button className="quiet" onClick={() => mark(true)}>Undo prayed mark</button>}</> : <div className="empty"><h2>All prayed for!</h2><p>Everyone in this group has been prayed for this week.</p><button onClick={() => { const list = active.filter(p => inGroup(p, filter)); if (list.length) setSelected(list[Math.floor(Math.random() * list.length)].id); }}>Keep praying</button></div>}
    </section>}

    {view === "week" && <section><h2>This Week</h2>
      <div className="panel"><h3>Upcoming birthdays</h3>{active.filter(p => birthdayDays(p.birthday) <= 14).sort((a, b) => birthdayDays(a.birthday) - birthdayDays(b.birthday)).map(p => <button className="row" key={p.id} onClick={() => openCard(p.id)}>{p.name}<span>{dateName(p.birthday)}</span></button>)}</div>
      <div className="panel"><h3>Prayed for — {prayed.length}</h3>{prayed.sort((a, b) => b.prayedAt - a.prayedAt).map(p => <button className="row" key={p.id} onClick={() => openCard(p.id)}>{p.name}<span>✓</span></button>)}</div>
      <div className="panel"><h3>Still waiting — {active.length - prayed.length}</h3>{active.filter(p => !prayedThisWeek(p)).sort((a, b) => a.name.localeCompare(b.name)).map(p => <button className="row" key={p.id} onClick={() => openCard(p.id)}>{p.name}<span>{groupName(groupOf(p))}</span></button>)}</div>
    </section>}

    {view === "roster" && <section><div className="filters">{[["all", "All"], ...GROUPS].map(([v, label]) => <button key={v} className={rosterFilter === v ? "on" : ""} onClick={() => setRosterFilter(v)}>{label}</button>)}</div>
      <div className="controls"><label>Sort <select value={sort} onChange={e => setSort(e.target.value)}><option value="name">A–Z</option><option value="grade">Grade</option><option value="birthday">Upcoming birthday</option></select></label></div>
      {roster.map(p => <button key={p.id} className="roster-row" onClick={() => openCard(p.id)}><div><strong>{p.name}</strong><small>{[p.type === "student" && gradeName(p.grade), p.school, p.birthday && dateName(p.birthday)].filter(Boolean).join(" · ")}</small></div><span className="tag">{groupName(groupOf(p))}</span></button>)}
      {!roster.length && <p className="muted">No one in this group yet.</p>}</section>}

    {view === "people" && admin && <section><h2>Manage people</h2><div className="panel"><h3>Add person</h3>
      <input placeholder="Full name" value={add.name} onChange={e => setAdd({ ...add, name: e.target.value })} />
      <div className="inline"><select value={add.type} onChange={e => setAdd({ ...add, type: e.target.value })}><option value="student">Student</option><option value="leader">Leader</option></select>
      {add.type === "student" && <><select value={add.grade} onChange={e => setAdd({ ...add, grade: e.target.value, group: gradeGroup(e.target.value) })}><option value="">Grade or age</option>{GRADES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select>
      <select value={add.group} disabled={!!add.grade} onChange={e => setAdd({ ...add, group: e.target.value })}><option value="">Age level</option>{GROUPS.filter(([v]) => v !== "leaders").map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></>}</div>
      {add.type === "student" && <input placeholder="School (optional)" value={add.school} onChange={e => setAdd({ ...add, school: e.target.value })} />}
      <input placeholder="Birthday MM-DD (optional)" value={add.birthday} onChange={e => setAdd({ ...add, birthday: e.target.value })} /><button className="primary" onClick={addPerson}>Add person</button></div>
      <input placeholder="Search people" value={search} onChange={e => setSearch(e.target.value)} />
      {active.filter(p => p.name.toLowerCase().includes(search.toLowerCase())).sort((a, b) => a.name.localeCompare(b.name)).map(p => <div className="panel person" key={p.id}>
        <div className="inline"><input aria-label="Name" value={p.name} onChange={e => update(p.id, { name: e.target.value })} /><select value={p.type} onChange={e => update(p.id, { type: e.target.value, group: e.target.value === "leader" ? null : gradeGroup(p.grade) || p.group })}><option value="student">Student</option><option value="leader">Leader</option></select></div>
        {p.type === "student" && <><div className="inline"><select value={String(p.grade ?? "")} onChange={e => update(p.id, { grade: e.target.value || null, group: gradeGroup(e.target.value) || null })}><option value="">Grade or age</option>{GRADES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select>
        <select value={groupOf(p)} disabled={!!p.grade} onChange={e => update(p.id, { group: e.target.value || null })}><option value="">Unassigned</option>{GROUPS.filter(([v]) => v !== "leaders").map(([v, label]) => <option key={v} value={v}>{label}</option>)}</select></div>
        <input aria-label="School" placeholder="School" value={p.school || ""} onChange={e => update(p.id, { school: e.target.value })} /></>}
        <div className="inline"><input aria-label="Birthday" placeholder="Birthday MM-DD" value={p.birthday || ""} onChange={e => update(p.id, { birthday: e.target.value })} /><button onClick={() => update(p.id, { active: false })}>Make inactive</button></div>
      </div>)}
      <button onClick={promote}>🎓 Promote all grades</button>
      {people.some(p => p.active === false) && <div className="panel"><h3>Inactive</h3>{people.filter(p => p.active === false).map(p => <div key={p.id} className="row">{p.name}<button onClick={() => update(p.id, { active: true })}>Restore</button></div>)}</div>}
      <div className="panel"><h3>Change admin password</h3><input type="password" placeholder="New password (12+ characters)" value={newPassword} onChange={e => setNewPassword(e.target.value)} /><input type="password" placeholder="Confirm password" value={confirmPassword} onChange={e => setConfirmPassword(e.target.value)} /><button onClick={changePassword}>Change password</button></div>
    </section>}

    {view === "report" && admin && <section><h2>Prayer report</h2><p>This week: {prayed.length} of {active.length} people prayed for ({active.length ? Math.round(prayed.length / active.length * 100) : 0}%).</p>
      <div className="panel"><h3>Previous weeks</h3>{history.length ? history.map((w, i) => <div className="row" key={i}>{new Date(w.prevWeekStart || w.weekStart).toLocaleDateString()}<span>{w.count} / {w.total}</span></div>) : <p className="muted">No previous weeks saved yet.</p>}</div></section>}

    {view === "import" && admin && <section><h2>Import and export</h2><button onClick={exportCSV}>Export roster as CSV</button><div className="panel"><h3>Import CSV</h3><p>Use Name (or First Name and Last Name). Optional columns: Grade, School, Birthday, Type, Group.</p>
      <input type="file" accept=".csv,text/csv" onChange={e => { const file = e.target.files?.[0]; if (file) file.text().then(text => setImportRows(parseCSV(text))); e.target.value = ""; }} />
      {!!importRows.length && <><p>{importRows.length} people found. Existing names will be skipped.</p>{importRows.slice(0, 10).map(p => <div key={p.id} className="row">{p.name}<span>{gradeName(p.grade)} {p.school}</span></div>)}<button className="primary" onClick={() => { const names = new Set(people.map(p => p.name.toLowerCase())); setPeople(old => [...old, ...importRows.filter(p => !names.has(p.name.toLowerCase()))]); setImportRows([]); setView("people"); }}>Import people</button></>}</div></section>}

    <footer>{admin ? <button onClick={async () => { await request("/api/data?key=auth", "DELETE").catch(() => {}); setAdmin(false); setView("pray"); }}>lock admin</button> : <button onClick={() => setLoginOpen(true)}>admin</button>}</footer>
    {loginOpen && <div className="overlay" onClick={() => setLoginOpen(false)}><div className="panel login" onClick={e => e.stopPropagation()}><h2>Admin access</h2><input autoFocus type="password" value={password} onChange={e => setPassword(e.target.value)} onKeyDown={e => e.key === "Enter" && login()} placeholder="Password" /><button className="primary" onClick={login}>Unlock</button><button onClick={() => setLoginOpen(false)}>Cancel</button></div></div>}
  </main></>;
}

function Styles() { return <style>{`
  *{box-sizing:border-box}body{margin:0;background:#1a1c1e;color:#e9e4db;font:14px Inter,system-ui,sans-serif}
  button,input,select{font:inherit}button{cursor:pointer;background:#2a2e2f;color:#e9e4db;border:1px solid #3c4442;border-radius:8px;padding:9px 12px}
  button:hover{border-color:#6b9e78}button:focus-visible,input:focus-visible,select:focus-visible{outline:2px solid #9ccda6}
  input,select{background:#202425;color:#e9e4db;border:1px solid #3c4442;border-radius:8px;padding:10px;min-width:0}input{width:100%}
  .shell{max-width:760px;min-height:100vh;margin:auto;display:flex;flex-direction:column;padding:18px 16px 32px;gap:15px}
  header{display:flex;justify-content:space-between;align-items:center;gap:12px}h1,h2{font-family:Georgia,serif;font-weight:normal}h1{font-size:25px;margin:0 0 2px}h2{font-size:25px;margin:0 0 15px}h3{font-size:12px;letter-spacing:.07em;text-transform:uppercase;color:#abc9ac;margin:0 0 12px}
  small,.muted{color:#9ca7a1}header small{display:block}.count{font-size:12px;text-align:right;color:#a9c9ad}.progress{height:5px;background:#313838;border-radius:5px}.progress div{height:100%;background:#6b9e78;border-radius:5px}
  nav{display:flex;flex-wrap:wrap;gap:5px;border-bottom:1px solid #38403d;padding-bottom:8px}nav button{background:none;border:0;color:#aeb8b1}.on,nav button.on{background:#6b9e78;color:#fff;border-color:#6b9e78}
  section{display:flex;flex-direction:column;gap:12px;flex:1}.controls,.inline,.card-actions,.filters{display:flex;gap:8px;align-items:center;flex-wrap:wrap}.controls{justify-content:space-between}.controls label{display:flex;align-items:center;gap:8px}.inline>*{flex:1}.filters button{flex:1 1 110px}.primary{background:#6b9e78;color:#fff;border-color:#6b9e78;font-weight:600}.quiet{align-self:center;background:none;border:0;color:#9ca7a1}
  .prayer-card,.panel{background:#252a2a;border:1px solid #3a4540;border-radius:14px;padding:20px}.prayer-card{min-height:290px;background:repeating-linear-gradient(#252a2a,#252a2a 29px,#2d3332 30px);box-shadow:0 15px 40px #0005}.prayer-card h2{font-size:34px;margin:12px 0}.prayer-card p{margin:8px 0}.tags{display:flex;flex-wrap:wrap;gap:6px}.tag,.tags span{font-size:11px;background:#33413a;color:#bee0c2;border-radius:20px;padding:4px 9px}.requests{margin-top:20px;padding:14px;background:#1c2221;border-radius:9px}.request{display:flex;justify-content:space-between;align-items:flex-start;gap:10px;margin:7px 0}.request button{padding:2px 8px}.card-actions>*{flex:1}.empty{text-align:center;padding:50px 12px}
  .roster-row,.row{width:100%;display:flex;align-items:center;justify-content:space-between;gap:12px;text-align:left}.roster-row{background:#252a2a;padding:13px 16px}.roster-row div{display:flex;flex-direction:column;gap:3px}.roster-row small{font-size:12px}.row{border:0;border-bottom:1px solid #38403d;border-radius:0;background:none}.panel{display:flex;flex-direction:column;gap:9px}.person{padding:12px}.notice{background:#4b3534;border-radius:7px;padding:10px}footer{margin-top:auto;text-align:center;padding-top:18px}footer button{background:none;border:0;font-size:11px;color:#8f9991}.overlay{position:fixed;inset:0;background:#000b;display:grid;place-items:center;padding:20px}.login{width:min(400px,100%)}
  @media(max-width:500px){header{align-items:flex-start}.prayer-card{padding:18px}.prayer-card h2{font-size:29px}.card-actions button{font-size:12px;padding:10px 5px}}
`}</style>; }
