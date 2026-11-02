// Seeds HAE LMS (SaaS): the HAE company with the owner, demo logins and sample data, plus one example customer company.
// Usage: npm run seed            (only seeds an empty database)
//        npm run seed -- --reset (wipes everything first)
require("./env");
const bcrypt = require("bcryptjs");
const db = require("./db");
const { createOrg } = require("./tenant");

const reset = process.argv.includes("--reset");
const now = Date.now(), H = 3600e3, D = 24 * H;
const hash = pw => bcrypt.hashSync(pw, 10);

if (reset) {
  const tables = ["alert_recipients","alerts","lead_history","leads","customers","templates","status_products","statuses","sources","staff_products","staff_projects","product_projects","products","projects","staff_log","staff","roles","payments","orgs"];
  db.exec("PRAGMA foreign_keys = OFF;" + tables.map(t => `DELETE FROM ${t};`).join("") + "PRAGMA foreign_keys = ON;");
  console.log("Database cleared.");
} else if (db.prepare("SELECT COUNT(*) n FROM orgs").get().n > 0) {
  console.log("Database already has data. Run `npm run seed -- --reset` to start over.");
  process.exit(0);
}

const DEMO = (process.env.SEED_DEMO || "true") !== "false";
const ownerEmail = (process.env.OWNER_EMAIL || "navjot@haedigital.com").toLowerCase();
const ownerPw = process.env.OWNER_PASSWORD || "ChangeMe@123";

db.transaction(() => {
  /* ================= HAE Digital Marketing (platform owner company) ================= */
  const hae = createOrg(process.env.OWNER_COMPANY || "HAE Digital Marketing", { id: "org_hae", plan: "business", code: "HAE-0001" });
  const O = hae.orgId, R = hae.roles, ST = hae.statuses, SRC = hae.sources;
  db.prepare("UPDATE orgs SET paid_until=NULL WHERE id=?").run(O);

  const staff = db.prepare(`INSERT INTO staff (id,org_id,name,mobile,email,password_hash,demo_password,role_id,reports_to,on_time,off_time,active,platform_admin,sample,created_at)
    VALUES (@id,@org,@name,@mobile,@email,@hash,@demo,@role,@rt,@on,@off,@active,@pa,@sample,@at)`);
  const slog = db.prepare("INSERT INTO staff_log (staff_id,at,by_id,action,reason) VALUES (?,?,?,?,?)");
  staff.run({ id: "st_owner", org: O, name: process.env.OWNER_NAME || "Navjot Kaur", mobile: "", email: ownerEmail, hash: hash(ownerPw), demo: null, role: R.superadmin, rt: null, on: "09:30", off: "18:30", active: 1, pa: 1, sample: 0, at: now });
  slog.run("st_owner", now, null, "Created as owner and platform admin", "");
  if (!DEMO) return;

  const pj = db.prepare("INSERT INTO projects (id,org_id,name,industry,sample,created_at) VALUES (?,?,?,?,1,?)");
  pj.run("pj_edu", O, "Study Abroad Counselling", "Education", now); pj.run("pj_imm", O, "Canada PR Visa", "Immigration", now); pj.run("pj_web", O, "Digital Services", "Digital Marketing", now);
  const pr = db.prepare("INSERT INTO products (id,org_id,name,description,active,sample,created_at) VALUES (?,?,?,'',1,1,?)");
  const pp = db.prepare("INSERT INTO product_projects (product_id,project_id) VALUES (?,?)");
  const prods = [["pr_uk","UK Admissions Package","pj_edu"],["pr_ca","Canada Express Entry","pj_imm"],["pr_shop","Shopify Store Build","pj_web"],["pr_seo","SEO Retainer","pj_web"],["pr_meta","Meta Ads Management","pj_web"]];
  prods.forEach(([id, n, p]) => { pr.run(id, O, n, now); pp.run(id, p); });

  const t0 = now - 30 * D;
  const sp = db.prepare("INSERT INTO staff_projects (staff_id,project_id) VALUES (?,?)");
  const sd = db.prepare("INSERT INTO staff_products (staff_id,product_id) VALUES (?,?)");
  const demo = (id, name, mobile, email, pw, lvl, rt, products = [], projects = [], on = "09:30", off = "18:30", active = 1) => {
    staff.run({ id, org: O, name, mobile, email, hash: hash(pw), demo: pw, role: R[lvl], rt, on, off, active, pa: 0, sample: 1, at: t0 });
    products.forEach(p => sd.run(id, p)); projects.forEach(p => sp.run(id, p));
    slog.run(id, t0, "st_owner", "Created as demo login", "");
  };
  demo("st_demosuper","Demo Super Admin","9810000000","superadmin@hae.demo","Super@123","superadmin",null,[],[],"00:00","23:59");
  demo("st_simran","Simran Bedi","9810000002","admin@hae.demo","Admin@123","admin","st_owner");
  demo("st_arjun","Arjun Malhotra","9810000003","manager@hae.demo","Manager@123","manager","st_simran");
  demo("st_priya","Priya Nair","9810000004","teamlead@hae.demo","Leader@123","tl","st_arjun",["pr_shop","pr_seo","pr_meta"],["pj_web"]);
  demo("st_karan","Karan Sethi","9810000005","teamlead2@hae.demo","Leader@123","tl","st_arjun",["pr_uk","pr_ca"],["pj_edu","pj_imm"]);
  demo("st_neha","Neha Gupta","9810000006","coordinator@hae.demo","Coord@123","coordinator","st_arjun");
  demo("st_aman","Aman Verma","9810000007","telecaller@hae.demo","Caller@123","telecaller","st_priya",["pr_shop","pr_seo"],["pj_web"]);
  demo("st_riya","Riya Sharma","9810000008","telecaller2@hae.demo","Caller@123","telecaller","st_priya",["pr_meta","pr_seo"],["pj_web"],"12:00","21:00");
  demo("st_vikas","Vikas Yadav","9810000009","telecaller3@hae.demo","Caller@123","telecaller","st_karan",["pr_uk"],["pj_edu"]);
  demo("st_sana","Sana Khan","9810000010","telecaller4@hae.demo","Caller@123","telecaller","st_karan",["pr_ca","pr_uk"],["pj_imm","pj_edu"]);
  demo("st_deepak","Deepak Jain","9810000011","accounts@hae.demo","Accounts@123","accounts","st_simran");
  demo("st_mohit","Mohit Rana","9810000012","mohit@hae.demo","Caller@123","telecaller","st_karan",["pr_ca"],["pj_imm"],"09:30","18:30",0);
  slog.run("st_mohit", now - 4 * D, "st_simran", "Deactivated", "Resigned, last working day 17 Oct");

  // sample customers & leads
  let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647;
  const pick = a => a[Math.floor(rnd() * a.length)];
  const prodStaff = { pr_shop: ["st_aman"], pr_seo: ["st_aman","st_riya"], pr_meta: ["st_riya"], pr_uk: ["st_vikas","st_sana"], pr_ca: ["st_sana"] };
  const srcNames = ["Manual","Website","Website","PPC","Meta Ads","Meta Ads","Meta Ads","WhatsApp","WhatsApp","Reference","Landing Page"];
  const people = [["Rahul Khanna","Khanna Exports"],["Ananya Iyer",""],["Harpreet Gill","Gill Foods"],["Sneha Reddy",""],["Mohammed Faiz","Faiz Logistics"],["Ishaan Kapoor",""],["Pooja Bansal","Bansal Jewellers"],["Gurpreet Sandhu",""],["Kavya Menon","Menon Organics"],["Rohan Desai","Desai Motors"],["Tanvi Joshi",""],["Aditya Rao","RaoTech Solutions"],["Meera Pillai",""],["Sahil Arora","Arora Fabrics"],["Nikita Chawla",""],["Varun Bhatia","Bhatia Sweets"],["Simran Kohli",""],["Yash Agarwal","Agarwal Traders"],["Divya Saxena",""],["Kunal Mehta","Mehta Interiors"],["Aisha Siddiqui",""],["Manpreet Dhillon","Dhillon Transport"],["Ritika Sood",""],["Abhinav Tyagi","Tyagi Pharma"]];
  const plan = ["new","new","new","cont","int","fu","fu","fu","prop","prop","quote","conv","conv","conv","ni","inv","new","int","fu","quote","conv","ni","cont","fu"];
  const stName = { new:"New",cont:"Contacted",int:"Interested",fu:"Follow-up",prop:"Proposal Sent",quote:"Quotation Sent",conv:"Converted",ni:"Not Interested",inv:"Invalid Number" };
  const pids = prods.map(p => p[0]), projOf = Object.fromEntries(prods.map(([k,,p]) => [k, p]));
  const notes = ["Called, client wants pricing for 3 months","Spoke to client, sharing details on WhatsApp","Asked for a callback after 5 pm","Client comparing with two other vendors","Requirement call done, budget confirmed"];
  const localDT = ms => { const d = new Date(ms); const p = n => String(n).padStart(2, "0"); return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes() < 30 ? 0 : 30)}`; };
  const cust = db.prepare("INSERT INTO customers (id,org_id,code,name,mobile,mobile_digits,email,company,sample,created_at) VALUES (?,?,?,?,?,?,?,?,1,?)");
  const lead = db.prepare(`INSERT INTO leads (id,org_id,code,name,mobile,email,company,product_id,source_id,project_id,assigned_to,status_id,follow_up_at,customer_id,created_by,created_at,sample)
    VALUES (@id,@org,@code,@name,@mobile,@email,@company,@pid,@src,@proj,@ass,@st,@fu,@cid,@by,@at,1)`);
  const hist = db.prepare("INSERT INTO lead_history (lead_id,at,by_id,kind,text) VALUES (?,?,?,?,?)");
  people.forEach(([name, company], i) => {
    const pid = pids[i % 5]; const ass = i === 5 ? null : pick(prodStaff[pid]);
    const days = i < 4 ? 0 : 1 + Math.floor(rnd() * 12);
    const at = days === 0 ? now - (20 + Math.floor(rnd() * 280)) * 60e3 : now - days * D - Math.floor(rnd() * 5) * H;
    const s = plan[i]; let fu = "";
    if (["fu","prop","quote","int","cont"].includes(s)) fu = localDT(now + pick([-26,-3,1,2,20,44,70]) * H);
    const mobile = "98" + String(70000000 + i * 37311).slice(0, 8);
    const email = i % 3 ? `${name.split(" ")[0].toLowerCase()}.${name.split(" ")[1].toLowerCase()}@example.com` : "";
    const cid = "c_" + String(i).padStart(2, "0"); cust.run(cid, O, "CUS-" + (1001 + i), name, mobile, mobile, email, company, at);
    const sn = pick(srcNames); const by = i % 2 ? "st_neha" : (ass || "st_neha"); const id = "l_" + String(i).padStart(2, "0");
    lead.run({ id, org: O, code: "LD-" + (2001 + i), name, mobile, email, company, pid, src: SRC[sn], proj: projOf[pid], ass, st: ST[s], fu, cid, by, at });
    hist.run(id, at, by, "create", `Lead created from ${sn}${ass ? " and assigned" : ""}`);
    if (s !== "new") hist.run(id, at + 3 * H, ass || "st_neha", "update", `Status → ${stName[s]} · ${pick(notes)}`);
  });
  const old = now - 95 * D, m2 = db.prepare("SELECT mobile FROM customers WHERE id='c_02'").get().mobile;
  lead.run({ id: "l_old1", org: O, code: "LD-1990", name: "Harpreet Gill", mobile: m2, email: "", company: "Gill Foods", pid: "pr_seo", src: SRC.Reference, proj: "pj_web", ass: "st_aman", st: ST.conv, fu: "", cid: "c_02", by: "st_aman", at: old });
  hist.run("l_old1", old, "st_aman", "create", "Lead created from Reference");
  hist.run("l_old1", old + 6 * D, "st_aman", "update", "Status → Converted · 6-month SEO retainer signed");

  const tp = db.prepare("INSERT INTO templates (id,org_id,name,channel,type,product_id,subject,body,sample,created_at) VALUES (?,?,?,?,?,?,?,?,1,?)");
  tp.run("t_prop", O, "Shopify proposal", "email", "Proposal", "pr_shop", "Proposal: Shopify store for {company}", "Hi {name},\n\nThanks for your time on the call. Attached is our proposal for building your Shopify store, covering design, product setup, payment gateway and launch support.\n\nTimeline: 4 to 6 weeks from kickoff.\n\nReply to this email or call me on {staff_mobile} with any questions.\n\nRegards,\n{staff}\nHAE Digital Marketing", now);
  tp.run("t_quote", O, "Standard quotation", "email", "Quotation", null, "Quotation for {product} · {lead_id}", "Hi {name},\n\nPlease find the quotation for {product} below. Prices are valid for 15 days.\n\n[Add line items here]\n\nRegards,\n{staff}\n{staff_mobile}", now);
  tp.run("t_req", O, "Requirement checklist", "email", "Requirement", null, "Next step: a few details for {product}", "Hi {name},\n\nTo prepare your plan for {product}, please share:\n1. Your goals for the next 3 months\n2. Budget range\n3. Preferred start date\n\nRegards,\n{staff}", now);
  tp.run("t_wa", O, "Follow-up nudge", "whatsapp", "Follow-up", null, "", "Hi {name}, this is {staff} from HAE Digital. Following up on {product}. Is now a good time for a quick call?", now);
  tp.run("t_sms", O, "Missed call", "sms", "Follow-up", null, "", "Hi {name}, we tried reaching you about {product}. Call {staff} on {staff_mobile}. Ref {lead_id}", now);

  const al = db.prepare("INSERT INTO alerts (id,org_id,type,title,msg,lead_id,from_id,at,sample) VALUES (?,?,?,?,?,NULL,?,?,1)");
  const ar = db.prepare("INSERT INTO alert_recipients (alert_id,staff_id,read_at) VALUES (?,?,?)");
  al.run("a_1", O, "admin", "Update every follow-up before 6 pm", "Weekly review starts Thursday. Leads without a remark in 48 hours will be reassigned.", "st_simran", now - 5 * H);
  db.prepare("SELECT id FROM staff WHERE org_id=? AND active=1 AND id<>'st_simran'").all(O).forEach(r => ar.run("a_1", r.id, null));
  al.run("a_2", O, "tl", "Push quotations on SEO leads today", "Two SEO leads are waiting on pricing.", "st_priya", now - 2 * H);
  ar.run("a_2", "st_aman", null); ar.run("a_2", "st_riya", null);

  /* ================= Example customer company (shows how other businesses use the SaaS) ================= */
  const sky = createOrg("Skyline Realty", { id: "org_skyline", plan: "trial", now: now - 6 * D });
  staff.run({ id: "st_sky_owner", org: sky.orgId, name: "Rohit Sharma", mobile: "9811100001", email: "owner@skyline.demo", hash: hash("Skyline@123"), demo: null, role: sky.roles.superadmin, rt: null, on: "09:30", off: "18:30", active: 1, pa: 0, sample: 0, at: now - 6 * D });
  db.prepare("INSERT INTO products (id,org_id,name,description,active,sample,created_at) VALUES ('pr_sky_2bhk',?,'2BHK Apartments','',1,0,?)").run(sky.orgId, now);
  [["Amit Bhalla","9822200001"],["Neelam Kaur","9822200002"],["Sunil Rawat","9822200003"]].forEach(([n, m], i) => {
    const cid = "c_sky_" + i, at = now - (i + 1) * D;
    db.prepare("INSERT INTO customers (id,org_id,code,name,mobile,mobile_digits,email,company,created_at) VALUES (?,?,?,?,?,?,'','',?)").run(cid, sky.orgId, "CUS-" + (1001 + i), n, m, m, at);
    lead.run({ id: "l_sky_" + i, org: sky.orgId, code: "LD-" + (2001 + i), name: n, mobile: m, email: "", company: "", pid: "pr_sky_2bhk", src: sky.sources["Meta Ads"], proj: null, ass: "st_sky_owner", st: sky.statuses.new, fu: "", cid, by: "st_sky_owner", at });
  });
  db.prepare("UPDATE leads SET sample=0 WHERE org_id=?").run(sky.orgId);
})();

console.log("Seeded HAE LMS (SaaS).");
console.log(`Owner + platform admin: ${ownerEmail} / ${ownerPw}${process.env.OWNER_PASSWORD ? "" : "  <- change this after first login"}`);
if (DEMO) {
  console.log("Example customer company: owner@skyline.demo / Skyline@123");
  console.log("Demo logins are listed on the login page. Remove them with Clear sample data.");
}
