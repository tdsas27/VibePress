# Real-Chromium regression test for the guestbook plugin, under the real sandbox CSP header. Run via guestbook.e2e.js, which starts
# the server first. This is the test that would have caught both the missing allow-forms CSP token and the window.status collision.
import sys, json
from playwright.sync_api import sync_playwright
port = sys.argv[1]
B = "http://localhost:%s" % port
results = []
def ok(name, cond, extra=""):
    results.append(cond); print(("PASS " if cond else "FAIL ") + name + ("" if cond else " -> " + str(extra)[:200]))
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page(); logs = []
    pg.on("console", lambda m: logs.append(m.text))
    pg.goto(B + "/x/guestbook/"); pg.wait_for_selector("#f", timeout=8000)
    pg.fill("input[name=name]", "Ann"); pg.fill("textarea[name=message]", "Hello there!"); pg.select_option("select[name=mood]", "happy")
    pg.click("button.btn")
    pg.wait_for_selector("#status:not(:empty)", timeout=8000)
    ok("clicking Sign the guestbook shows a confirmation message", "Thanks" in pg.inner_text("#status"), pg.inner_text("#status"))
    blocked = [l for l in logs if "sandbox" in l.lower() and "blocked" in l.lower()]
    ok("no sandbox-related submission was blocked by the browser", not blocked, blocked)
    pg.fill("input[name=name]", ""); pg.fill("textarea[name=message]", ""); pg.click("button.btn"); pg.wait_for_timeout(400)
    ok("the browser's own required-field validation still stops an empty submit", pg.input_value("input[name=name]") == "")
    b.close()
print(json.dumps({"passed": sum(results), "failed": len(results) - sum(results)}))
sys.exit(0 if all(results) else 1)
