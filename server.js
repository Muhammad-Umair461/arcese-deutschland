// Staff Roster server - sirf Node.js chahiye, npm install nahi.
const http = require("http"), fs = require("fs"), path = require("path"), os = require("os"), crypto = require("crypto");
const PORT = process.env.PORT || 3000;
const PASSWORD = process.env.ADMIN_PASSWORD || "admin123"; // isay zaroor badlein
const FILE = path.join(__dirname, "roster.json");
const CODES = ["Früh", "Spät", "Tag", "Frei", "U", "Krank", "SU", "Feiert."];
const RURL = process.env.UPSTASH_REDIS_REST_URL, RTOK = process.env.UPSTASH_REDIS_REST_TOKEN; // online hosting ke liye
let db = { emps: [], shifts: {} };
const fix = () => { db.emps = db.emps || []; db.shifts = db.shifts || {}; };
const hashPw = (pw, salt) => crypto.scryptSync(String(pw), salt, 32).toString("hex");
function checkPw(pw) {
  if (db.pw) { try { return crypto.timingSafeEqual(Buffer.from(hashPw(pw, db.pw.salt), "hex"), Buffer.from(db.pw.hash, "hex")); } catch (e) { return false; } }
  const a = Buffer.from(String(pw)), b = Buffer.from(PASSWORD);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const fails = {};
const save = () => {
  if (RURL) {
    fetch(RURL, { method: "POST", headers: { Authorization: "Bearer " + RTOK }, body: JSON.stringify(["SET", "roster", JSON.stringify(db)]) })
      .catch(e => console.log("Save error:", e.message));
  } else { fs.writeFileSync(FILE + ".tmp", JSON.stringify(db)); fs.renameSync(FILE + ".tmp", FILE); }
};
const uid = () => crypto.randomBytes(5).toString("hex");
const send = (res, code, obj) => { res.writeHead(code, { "Content-Type": "application/json" }); res.end(JSON.stringify(obj)); };
const okDate = d => /^\d{4}-\d{2}-\d{2}$/.test(d);
function setShift(eid, date, code) {
  if (!okDate(date) || !db.emps.some(e => e.id === eid)) return;
  if (CODES.includes(code)) db.shifts[eid + "|" + date] = code; else delete db.shifts[eid + "|" + date];
}
async function start() {
  if (RURL) {
    try {
      const r = await fetch(RURL + "/get/roster", { headers: { Authorization: "Bearer " + RTOK } });
      const j = await r.json(); if (j.result) db = JSON.parse(j.result);
      console.log("Data online database se load hua");
    } catch (e) { console.log("Online database error:", e.message); }
  } else { try { db = JSON.parse(fs.readFileSync(FILE, "utf8")); } catch (e) {} }
  fix();
  if (process.env.FORCE_ADMIN_PASSWORD === "1" && db.pw) { delete db.pw; save(); console.log("Gespeichertes Passwort entfernt: ADMIN_PASSWORD gilt wieder"); }
http.createServer((req, res) => {
  const url = req.url.split("?")[0];
  if (req.method === "GET" && url === "/api/data") return send(res, 200, { emps: db.emps, shifts: db.shifts });
  if (url.startsWith("/api/")) {
    const ip = String(req.headers["x-forwarded-for"] || req.socket.remoteAddress || "").split(",")[0].trim();
    const f = fails[ip] || { n: 0, t: Date.now() };
    if (Date.now() - f.t > 600000) { f.n = 0; f.t = Date.now(); }
    if (f.n >= 10) return send(res, 429, { error: "zu viele Versuche" });
    if (!checkPw(req.headers["x-key"])) { f.n++; fails[ip] = f; return send(res, 401, { error: "password" }); }
    const p = url.split("/");
    if (req.method === "DELETE" && p[2] === "emps") {
      db.emps = db.emps.filter(e => e.id !== p[3]);
      for (const k of Object.keys(db.shifts)) if (k.startsWith(p[3] + "|")) delete db.shifts[k];
      save(); return send(res, 200, { ok: true });
    }
    let body = "";
    req.on("data", c => { body += c; if (body.length > 2e6) req.destroy(); });
    req.on("end", () => {
      let b; try { b = JSON.parse(body); } catch (e) { return send(res, 400, {}); }
      if (p[2] === "emps" && b.name) db.emps.push({ id: uid(), name: String(b.name).slice(0, 80) });
      else if (p[2] === "shift") setShift(b.eid, b.date, b.code);
      else if (p[2] === "password") {
        const np = String(b.password || ""); if (np.length < 8 || np.length > 100) return send(res, 400, {});
        const salt = crypto.randomBytes(16).toString("hex"); db.pw = { salt, hash: hashPw(np, salt) };
      }
      else if (p[2] === "bulk" && Array.isArray(b.rows)) {
        for (const r of b.rows) {
          const name = String(r.name || "").trim().slice(0, 80); if (!name) continue;
          let e = db.emps.find(x => x.name.toLowerCase() === name.toLowerCase());
          if (!e) { e = { id: uid(), name }; db.emps.push(e); }
          for (const [d, c] of Object.entries(r.shifts || {})) setShift(e.id, d, c);
        }
      } else return send(res, 400, {});
      save(); send(res, 200, { ok: true });
    });
    return;
  }
  fs.readFile(path.join(__dirname, "index.html"), (err, html) => {
    if (err) { res.writeHead(500); return res.end("index.html nahi mili"); }
    res.writeHead(200, { "Content-Type": "text/html; charset=utf-8" }); res.end(html);
  });
}).listen(PORT, "0.0.0.0", () => {
  console.log("Laptop par:        http://localhost:" + PORT);
  Object.values(os.networkInterfaces()).flat().filter(i => i.family === "IPv4" && !i.internal)
    .forEach(i => console.log("Same WiFi walon ke liye: http://" + i.address + ":" + PORT));
  console.log("Admin password:", PASSWORD === "admin123" ? "admin123 (badal lein!)" : "set hai");
});
}
start();
