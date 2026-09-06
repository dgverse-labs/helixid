# SP-hosted HTML pages (login + consent). Python port of the template
# functions at the bottom of sp-shared/app.ts -- byte-for-byte the same
# markup/CSS/client JS (all browser-side, language-agnostic), just emitted
# from Python f-strings instead of JS template literals. The consent page
# still loads the real @helixid/widget browser bundle from /widget/index.js
# (served as static files, unchanged) so the rendered state machine is the
# shipped one, not a reimplementation.

from __future__ import annotations

import json
from typing import Any, Dict

from helixid_config import SpDefinition


def _sp_chrome(definition: SpDefinition) -> str:
    accent = "#1f6feb" if definition.id == "airline" else "#8250df"
    return f"""
  :root{{--accent:{accent};--bg:#f6f8fa;--surface:#fff;--border:#d8dee4;--text:#1f2328;--muted:#656d76;--dim:#8c959f}}
  *{{box-sizing:border-box;margin:0;padding:0}}
  body{{background:var(--bg);color:var(--text);min-height:100vh;display:grid;place-items:center;padding:24px;
    font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Inter,system-ui,sans-serif;-webkit-font-smoothing:antialiased}}
  button{{font:inherit;cursor:pointer;border:0}}
  .card{{width:min(440px,94vw);background:var(--surface);border:1px solid var(--border);
    border-radius:16px;box-shadow:0 12px 40px #1f232814;overflow:hidden}}
  .card-head{{padding:26px 28px 20px;border-bottom:1px solid var(--border)}}
  .brand{{width:42px;height:42px;border-radius:12px;background:var(--accent);color:#fff;
    display:grid;place-items:center;font-weight:800;font-size:15px;letter-spacing:.02em}}
  h1{{font-size:19px;margin-top:16px;letter-spacing:-.01em}}
  .lede{{color:var(--muted);font-size:13.5px;margin-top:6px;line-height:1.5}}
  .card-body{{padding:22px 28px 26px}}
  .btn{{width:100%;padding:11px;border-radius:9px;background:var(--accent);color:#fff;font-weight:650;font-size:14px;
    transition:opacity .15s}}
  .btn:hover{{opacity:.92}}
  .btn:disabled{{opacity:.45;cursor:not-allowed}}
  .btn-ghost{{width:100%;padding:11px;border-radius:9px;background:transparent;color:var(--muted);
    border:1px solid var(--border);font-weight:600;font-size:14px;margin-top:9px}}
  .btn-ghost:hover{{background:var(--bg);color:var(--text)}}
  .foot{{padding:14px 28px;background:var(--bg);border-top:1px solid var(--border);
    font-size:11.5px;color:var(--dim);display:flex;align-items:center;gap:7px;line-height:1.5}}
  .lock{{flex:0 0 auto}}
  .error{{color:#cf222e;font-size:12.5px;margin-top:12px;min-height:16px}}"""


def sp_login_page_html(definition: SpDefinition, agent_did: str, user_did: str, demo: bool = False) -> str:
    initials = "HA" if definition.id == "airline" else "HS"
    focus_shadow = "#1f6feb22" if definition.id == "airline" else "#8250df22"
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" /><meta name="viewport" content="width=device-width,initial-scale=1" />
<title>Sign in · {definition.display_name}</title>
<style>{_sp_chrome(definition)}
  .field{{margin-bottom:13px}}
  .field label{{display:block;font-size:11px;text-transform:uppercase;letter-spacing:.07em;
    color:var(--dim);font-weight:650;margin-bottom:6px}}
  input{{width:100%;padding:11px 12px;border:1px solid var(--border);border-radius:9px;font:inherit;
    outline:none;transition:border-color .15s,box-shadow .15s}}
  input:focus{{border-color:var(--accent);box-shadow:0 0 0 3px {focus_shadow}}}
</style>
</head>
<body>
<form class="card" id="login">
  <div class="card-head">
    <div class="brand">{initials}</div>
    <h1>Sign in to {definition.display_name}</h1>
    <p class="lede">You need to be signed in before you can review what this agent is asking to do.</p>
  </div>
  <div class="card-body">
    <div class="field"><label for="username">Username</label><input id="username" value="ada" autocomplete="username" /></div>
    <div class="field"><label for="password">Password</label><input id="password" type="password" value="demo123" autocomplete="current-password" /></div>
    <button class="btn" type="submit">Continue</button>
    <div class="error" id="error"></div>
  </div>
  <div class="foot"><span class="lock">🔒</span><span>{definition.display_name} never shares your password with the agent.</span></div>
</form>
<script>
  document.getElementById('login').onsubmit = async (e) => {{
    e.preventDefault();
    const err = document.getElementById('error');
    err.textContent = '';
    const res = await fetch('/api/sp-login', {{
      method: 'POST',
      headers: {{ 'content-type': 'application/json' }},
      body: JSON.stringify({{
        username: document.getElementById('username').value,
        password: document.getElementById('password').value,
        agentDid: {json.dumps(agent_did)},
        userDid: {json.dumps(user_did)},
      }}),
    }});
    const body = await res.json();
    if (!res.ok) {{ err.textContent = body.error || 'Sign in failed'; return; }}
    const demo = {json.dumps(bool(demo))};
    location.href = body.redirectUrl + (demo ? '&demo=1' : '');
  }};

  if ({json.dumps(bool(demo))}) {{
    setTimeout(() => document.getElementById('login').requestSubmit(), 1600);
  }}
</script>
</body>
</html>"""


def consent_page_html(
    definition: SpDefinition,
    agent_did: str,
    user_did: str,
    service_did: str,
    demo: bool = False,
    correlation_id: str = "",
) -> str:
    initials = "HA" if definition.id == "airline" else "HS"
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>Authorize · {definition.display_name}</title>
<style>{_sp_chrome(definition)}
  .agent{{display:flex;align-items:center;gap:11px;padding:13px 14px;background:var(--bg);
    border:1px solid var(--border);border-radius:11px;margin-bottom:20px}}
  .agent .ico{{width:32px;height:32px;border-radius:9px;background:linear-gradient(135deg,#4f7cff,#7c5cff);
    color:#fff;display:grid;place-items:center;font-weight:800;font-size:12px;flex:0 0 32px}}
  .agent .nm{{font-size:13.5px;font-weight:640}}
  .agent .did{{font-size:11px;color:var(--dim);font-family:ui-monospace,Menlo,monospace;
    word-break:break-all;margin-top:2px;line-height:1.4}}
  h2{{font-size:11px;text-transform:uppercase;letter-spacing:.08em;color:var(--dim);
    font-weight:700;margin-bottom:11px}}
  .scope{{display:flex;gap:11px;align-items:flex-start;padding:12px 13px;border:1px solid var(--border);
    border-radius:10px;margin-bottom:8px;transition:border-color .15s;cursor:pointer}}
  .scope:hover{{border-color:var(--accent)}}
  .scope.locked{{background:var(--bg);cursor:default}}
  .scope input{{margin-top:2px;width:16px;height:16px;accent-color:var(--accent);flex:0 0 16px;cursor:inherit}}
  .scope .t{{font-size:13.5px;font-weight:600;display:flex;align-items:center;gap:7px;flex-wrap:wrap}}
  .scope .d{{font-size:12.5px;color:var(--muted);margin-top:3px;line-height:1.45}}
  .req{{font-size:9.5px;text-transform:uppercase;letter-spacing:.05em;font-weight:700;
    padding:2px 6px;border-radius:5px;background:var(--border);color:var(--muted)}}
  .durs{{display:grid;gap:8px;margin-bottom:22px}}
  .dur{{display:flex;gap:11px;align-items:flex-start;padding:12px 13px;border:1px solid var(--border);
    border-radius:10px;cursor:pointer;transition:border-color .15s}}
  .dur:hover{{border-color:var(--accent)}}
  .dur input{{margin-top:2px;accent-color:var(--accent);flex:0 0 auto;cursor:inherit}}
  .dur .t{{font-size:13.5px;font-weight:600}}
  .dur .d{{font-size:12.5px;color:var(--muted);margin-top:3px}}
  .state{{padding:30px 0;text-align:center;color:var(--muted);font-size:13.5px}}
  .banner{{padding:13px 14px;border-radius:10px;background:#fff5f5;border:1px solid #ffc9c9;
    color:#a4232b;font-size:13px;line-height:1.5;margin-bottom:16px}}
  .done{{text-align:center;padding:26px 0}}
  .done .tick{{width:44px;height:44px;border-radius:50%;background:#1a7f37;color:#fff;margin:0 auto 14px;
    display:grid;place-items:center;font-size:21px;font-weight:800}}
  .done .t{{font-size:16px;font-weight:650}}
  .done .d{{font-size:13px;color:var(--muted);margin-top:6px}}
</style>
</head>
<body>
<div class="card">
  <div class="card-head">
    <div class="brand">{initials}</div>
    <h1>Authorize this agent</h1>
    <p class="lede"><strong>Travel Planner Agent</strong> is asking to act on your behalf at {definition.display_name}.</p>
  </div>
  <div class="card-body">
    <div class="agent">
      <div class="ico">TP</div>
      <div>
        <div class="nm">Travel Planner Agent</div>
        <div class="did">{agent_did or 'unknown agent'}</div>
      </div>
    </div>
    <div id="root"><div class="state">Loading permissions…</div></div>
  </div>
  <div class="foot">
    <span class="lock">🔒</span>
    <span>Signed by {definition.display_name} and verified by HelixID. Revocable at any time.</span>
  </div>
</div>

<script type="module">
  import {{ createConsentController }} from '/widget/index.js';

  const root = document.getElementById('root');
  const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) =>
    ({{ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }}[c]));

  function finish(title, detail) {{
    root.innerHTML = '<div class="done"><div class="tick">✓</div>' +
      '<div class="t">' + esc(title) + '</div><div class="d">' + esc(detail) + '</div></div>';
  }}

  const controller = createConsentController({{
    agentDid: {json.dumps(agent_did)},
    agentName: 'Travel Planner Agent',
    userIdentifier: {json.dumps(user_did)},
    serviceDid: {json.dumps(service_did)},
    scopesEndpoint: '/api/consent/scopes',
    defaultDurability: 'standing',
    onAccept: async (selection) => {{
      const res = await fetch('/api/consent/accept', {{
        method: 'POST',
        headers: {{ 'content-type': 'application/json' }},
        credentials: 'same-origin',
        body: JSON.stringify({{
          agentDid: {json.dumps(agent_did)},
          userDid: {json.dumps(user_did)},
          scopes: selection.scopes,
          durability: selection.durability,
          correlationId: {json.dumps(correlation_id)} || undefined,
        }}),
      }});
      const body = await res.json();
      if (!res.ok || !body.grantVC) {{
        throw new Error((body.error && body.error.message) || 'Could not issue permission');
      }}
      (window.opener || window.parent).postMessage(
        {{ type: 'helixid:consent-accepted', grantVC: body.grantVC }}, '*');
      finish('Permission granted', 'Returning you to the Travel Planner…');
      setTimeout(() => window.close(), 900);
    }},
    onDecline: () => {{
      (window.opener || window.parent).postMessage({{ type: 'helixid:consent-declined' }}, '*');
      finish('Nothing was authorized', 'You can close this window.');
      setTimeout(() => window.close(), 900);
    }},
  }});

  function render(state) {{
    if (state.status === 'loading') {{
      root.innerHTML = '<div class="state">Loading permissions…</div>';
      return;
    }}

    if (state.status === 'error') {{
      root.innerHTML =
        '<div class="banner">We could not load the permissions this agent is requesting. ' +
        'Nothing has been authorized.<br><small>' + esc(state.error || 'unknown error') + '</small></div>' +
        '<button class="btn" disabled>Allow</button>' +
        '<button class="btn-ghost" id="decline">Close</button>';
      document.getElementById('decline').onclick = () => controller.decline();
      return;
    }}

    root.innerHTML =
      '<h2>This agent will be able to</h2>' +
      state.scopeOptions.map((o) => {{
        const on = state.selectedScopes.includes(o.scope);
        return '<label class="scope' + (o.required ? ' locked' : '') + '">' +
          '<input type="checkbox" data-scope="' + esc(o.scope) + '"' +
            (on ? ' checked' : '') + (o.required ? ' disabled' : '') + ' />' +
          '<div><div class="t">' + esc(o.label) +
            (o.required ? '<span class="req">Required</span>' : '') + '</div>' +
            (o.description ? '<div class="d">' + esc(o.description) + '</div>' : '') +
          '</div></label>';
      }}).join('') +
      '<h2 style="margin-top:22px">For how long</h2>' +
      '<div class="durs">' + state.durabilityOptions.map((d) =>
        '<label class="dur"><input type="radio" name="dur" value="' + esc(d.value) + '"' +
          (state.durability === d.value ? ' checked' : '') + ' />' +
          '<div><div class="t">' + esc(d.label) + '</div>' +
          (d.description ? '<div class="d">' + esc(d.description) + '</div>' : '') +
          '</div></label>').join('') + '</div>' +
      '<button class="btn" id="accept"' + (state.canAccept ? '' : ' disabled') + '>Allow</button>' +
      '<button class="btn-ghost" id="decline">Not now</button>';

    root.querySelectorAll('input[data-scope]').forEach((el) => {{
      el.onchange = () => controller.toggleScope(el.dataset.scope);
    }});
    root.querySelectorAll('input[name=dur]').forEach((el) => {{
      el.onchange = () => controller.setDurability(el.value);
    }});
    document.getElementById('accept').onclick = async (e) => {{
      e.target.disabled = true;
      e.target.textContent = 'Authorizing…';
      try {{ await controller.accept(); }}
      catch (err) {{
        root.innerHTML = '<div class="banner">' + esc(err.message) + '</div>' +
          '<button class="btn-ghost" id="decline">Close</button>';
        document.getElementById('decline').onclick = () => controller.decline();
      }}
    }};
    document.getElementById('decline').onclick = () => controller.decline();
  }}

  controller.subscribe(render);
  render(controller.getState());
  await controller.load();

  if ({json.dumps(bool(demo))}) {{
    setTimeout(() => {{
      const accept = document.getElementById('accept');
      if (accept && !accept.disabled) accept.click();
    }}, 3400);
  }}
</script>
</body>
</html>"""
