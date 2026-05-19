"""
TOS Frontend — Flask host reference implementation.

Shows the minimal contract a Flask app must satisfy to embed
the TOS Frontend bundle on any page.

Setup:
    pip install flask python-dotenv
    cp .env.example .env   # fill in your values
    flask run              # http://localhost:5000
"""

import os
from flask import Flask, render_template, request, jsonify
from dotenv import load_dotenv

load_dotenv()

app = Flask(__name__)

# ── Config pulled from environment ────────────────────────────────────────────
TOS_API_BASE = os.getenv("TOS_API_BASE", "http://localhost:3000")
TOS_API_KEY  = os.getenv("TOS_API_KEY",  "")          # partner API key
TOS_TENANT   = os.getenv("TOS_TENANT_ID", "")

# ── Branding (override per partner) ───────────────────────────────────────────
BRANDING = {
    "primaryColor": os.getenv("TOS_PRIMARY_COLOR", "#0D3B6E"),
    "logoUrl":      os.getenv("TOS_LOGO_URL",      None),
    "fontFamily":   os.getenv("TOS_FONT_FAMILY",   "Inter"),
}


# ── Helper: build TOS_CONFIG dict for templates ───────────────────────────────
def tos_config(page_slug=None, auth_token=None):
    """Return the TOS_CONFIG dict that will be JSON-serialised into <script>."""
    return {
        "apiBase":  TOS_API_BASE,
        "tenantId": TOS_TENANT,
        "pageSlug": page_slug,          # None → router mode (hash/history routing)
        "branding": BRANDING,
        "auth": {
            "token": auth_token or TOS_API_KEY or None,
        },
    }


# ── Routes ─────────────────────────────────────────────────────────────────────

@app.route("/")
def home():
    """Full-site router mode — TOS Frontend manages all routing."""
    return render_template("travel_site.html", tos=tos_config())


@app.route("/travel")
def travel_page():
    """
    Single-page manifest mode — loads the 'home' manifest from the hub.
    Use this when you only want to embed one TOS page inside a larger site.
    """
    return render_template("travel_page.html", tos=tos_config(page_slug="home"))


@app.route("/destinations/<city>")
def destination(city):
    """
    Dynamic manifest mode — loads a city-specific page manifest.
    Manifests can be pre-created in the Partner Dashboard.
    """
    slug = f"city-{city.lower().replace(' ', '-')}"
    return render_template("travel_page.html", tos=tos_config(page_slug=slug))


@app.route("/health")
def health():
    return jsonify({"ok": True})


if __name__ == "__main__":
    app.run(debug=True, port=5000)
