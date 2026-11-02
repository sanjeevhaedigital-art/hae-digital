"""Builds demo/hae-lms-demo.html: the real HAE LMS server code + SQLite (sql.js) + the app, in one page.
Usage: python3 demo/build.py <path to sql-asm.js> <path to bcrypt.min.js>"""
import json, re, sys, pathlib

root = pathlib.Path(__file__).resolve().parent.parent
sql_js = pathlib.Path(sys.argv[1]).read_text()
bcrypt_js = pathlib.Path(sys.argv[2]).read_text()
runtime = (root / "demo" / "runtime.js").read_text()

# schema = the CREATE statements from src/db.js
db_src = (root / "src" / "db.js").read_text()
schema = re.search(r"db\.exec\(`(.*?)`\);", db_src, re.S).group(1)

# real server modules, wrapped as CommonJS factories
mods = []
for name in ["plans", "tenant", "seed", "server"]:
    src = (root / "src" / f"{name}.js").read_text()
    mods.append(f'"{name}": function (module, exports, require, process, setInterval, __dirname) {{\n{src}\n}}')
modules_js = "window.__HAE_MODULES__ = {\n" + ",\n".join(mods) + "\n};\n"

bootstrap = (
    f"window.__HAE_SCHEMA__ = {json.dumps(schema)};\n"
    # bcryptjs UMD -> global; cap cost so seeding is quick in the browser (still real bcrypt)
    "(function(){var b=(self.dcodeIO&&self.dcodeIO.bcrypt);window.__bcrypt=Object.assign({},b,{hashSync:function(p,r){return b.hashSync(p,Math.min(r||10,8))}});})();\n"
)

page = (root / "public" / "index.html").read_text()
start = page.index("<title>")
end = page.index("</body>")
body = page[start:end]
body = body.replace("</head>\n<body>", "")
body = body.replace("<title>HAE LMS</title>", '<title>HAE LMS SaaS</title>\n<meta name="claude:viewport-fit-sides" content="cover">', 1)

# demo chip (bottom-left): explains where data lives and offers a reset
chip = """
<style>
.demo-chip{position:fixed;left:max(12px,env(safe-area-inset-left,0px));bottom:calc(12px + env(safe-area-inset-bottom,0px));z-index:60;display:flex;gap:8px;align-items:center;background:var(--panel);border:1px solid var(--line);border-radius:999px;padding:6px 8px 6px 12px;font-size:12px;box-shadow:var(--shadow);max-width:calc(100vw - 24px)}
.demo-chip b{color:var(--accent)}
.demo-chip button{border:1px solid var(--line);background:var(--bg);border-radius:999px;padding:3px 10px;cursor:pointer;font:inherit;color:var(--fg)}
.demo-chip button:focus-visible{outline:2px solid var(--accent)}
@media (max-width:760px){.demo-chip span.long{display:none}}
</style>
<div class="demo-chip" role="note"><span><b>Live demo</b><span class="long"> · runs in your browser, data saved on this device</span></span><button type="button" id="demoReset">Reset demo</button></div>
<script>
document.getElementById("demoReset").addEventListener("click",function(){var b=this;if(b.dataset.c){window.__HAE_DEMO__.reset()}else{b.dataset.c=1;b.textContent="Tap again to reset";setTimeout(function(){delete b.dataset.c;b.textContent="Reset demo"},3000)}});
</script>
"""

first_script = body.index("<script>")
scripts = (
    f"<script>\n{sql_js}\n</script>\n"
    f"<script>\n{bcrypt_js}\n</script>\n"
    f"<script>\n{bootstrap}{modules_js}</script>\n"
    f"<script>\n{runtime}\n</script>\n"
)
for s in (sql_js, bcrypt_js, modules_js, runtime):
    assert "</script" not in s.lower(), "inline script contains </script"
out = body[:first_script] + scripts + body[first_script:] + chip
(root / "demo" / "hae-lms-demo.html").write_text(out)
print("wrote", root / "demo" / "hae-lms-demo.html", f"{len(out)/1024:.0f} KB")
