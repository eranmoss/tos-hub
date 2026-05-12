from playwright.sync_api import sync_playwright
import json

with sync_playwright() as p:
    browser = p.chromium.launch(headless=True)
    page = browser.new_page()

    errors = []
    page.on("console", lambda msg: errors.append(f"[{msg.type}] {msg.text}") if msg.type in ("error", "warning") else None)
    page.on("pageerror", lambda err: errors.append(f"[PAGE ERROR] {err.message}"))

    # First, auto-login
    page.goto("http://localhost:5173/dashboard")
    page.wait_for_load_state("networkidle")
    page.wait_for_timeout(2000)

    # Check if we got redirected or if we're on dashboard
    print(f"After load: {page.url()}")

    # Now navigate to integrations
    page.goto("http://localhost:5173/dashboard/integrations")
    page.wait_for_timeout(3000)

    print(f"After integrations nav: {page.url()}")
    print(f"Page title: {page.title()}")

    # Check what's on the page
    content = page.text_content("body")
    print(f"Body text (first 500): {content[:500] if content else 'EMPTY'}")

    if errors:
        print("\n--- Console errors ---")
        for e in errors:
            print(e)
    else:
        print("\nNo console errors")

    page.screenshot(path="/tmp/integrations_test.png", full_page=True)
    print("\nScreenshot saved to /tmp/integrations_test.png")

    browser.close()
