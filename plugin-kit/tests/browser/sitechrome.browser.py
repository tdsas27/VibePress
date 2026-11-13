# Real-Chromium regression test for the shared header and footer (tds.js). Run via sitechrome.e2e.js, which starts the server first.
# Covers: the "Back To" link on plugin pages (it used to go to /x/ and answer 403), the "Powered by VibePress" credit (right address,
# present on every kind of page, and not wiped out by a custom copyright line), and the site name shown in header and footer.
import sys, json
from playwright.sync_api import sync_playwright
port, NAME = sys.argv[1], sys.argv[2]
B = "http://localhost:%s" % port
CREDIT = "https://vibepress.tiedyesasquatch.online"
results = []
def ok(name, cond, extra=""):
    results.append(cond); print(("PASS " if cond else "FAIL ") + name + ("" if cond else " -> " + str(extra)[:200]))
with sync_playwright() as p:
    b = p.chromium.launch(); pg = b.new_page()
    # --- plugin page (runs under the real sandbox CSP, so it has no cookies and a private origin)
    r = pg.goto(B + "/x/hello-world/"); pg.wait_for_selector(".tds-header", timeout=8000)
    back = pg.locator("a.tds-back")
    ok("plugin page: the Back To link is on the page", back.count() == 1)
    href = back.get_attribute("href")
    ok("plugin page: the Back To link goes to the home page, not up to /x/", href == "/", href)
    ok("plugin page: the link says the site name", NAME in back.inner_text(), back.inner_text())
    back.click(); pg.wait_for_load_state()
    ok("plugin page: clicking it lands on the home page (no 403)", pg.url.rstrip("/") == B and "Forbidden" not in pg.content(), pg.url)
    # --- the credit on every kind of page
    for label, path in [("home page", "/"), ("section page", "/games/"), ("plugin page", "/x/hello-world/")]:
        pg.goto(B + path); pg.wait_for_selector(".tds-copy", timeout=8000); pg.wait_for_timeout(500)   # site.json is fetched after the page draws
        c = pg.locator("a.tds-credit")
        ok(label + ": the Powered by VibePress link is shown", c.count() == 1, pg.inner_text(".tds-copy"))
        if c.count() == 1:
            ok(label + ": it points to " + CREDIT, c.get_attribute("href") == CREDIT, c.get_attribute("href"))
        ok(label + ": the custom copyright text is shown too", "All rights reserved" in pg.inner_text(".tds-copy"), pg.inner_text(".tds-copy"))
    # --- the 404 page has the footer as well
    pg.goto(B + "/nope-not-here/"); pg.wait_for_selector(".tds-copy", timeout=8000) if pg.locator(".tds-copy").count() else None
    # --- site name
    pg.goto(B + "/"); pg.wait_for_selector(".tds-foot-logo .bubble", timeout=8000); pg.wait_for_timeout(300)
    ok("home page: header shows the site name", NAME in pg.inner_text("a.tds-back"), pg.inner_text("a.tds-back"))
    ok("home page: footer shows the site name", NAME in pg.inner_text(".tds-foot-logo .bubble"), pg.inner_text(".tds-foot-logo .bubble"))
    ok("home page: the big title shows the site name", NAME in pg.inner_text("h1.bubble"), pg.inner_text("h1.bubble"))
    b.close()
print(json.dumps({"passed": sum(results), "failed": len(results) - sum(results)}))
sys.exit(0 if all(results) else 1)
