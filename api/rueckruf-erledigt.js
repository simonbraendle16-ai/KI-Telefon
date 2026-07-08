// Vercel Serverless Function — POST /api/rueckruf-erledigt
// Body: { slug, key, anruf_id } → setzt crm_anrufe.status='erledigt'
// (nur für Anrufe, die zum Betrieb des Dashboards gehören).

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  var base = process.env.SUPABASE_URL;
  var srk = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !srk) {
    res.status(500).json({ error: "Server nicht konfiguriert." });
    return;
  }
  var headers = { "apikey": srk, "Authorization": "Bearer " + srk };

  try {
    var body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body || "{}"); } catch (e) { body = {}; }
    }
    var slug = String((body && body.slug) || "").trim().toLowerCase();
    var key = String((body && body.key) || "").trim();
    var anrufId = parseInt((body && body.anruf_id), 10);
    if (!slug || !key || !anrufId) {
      res.status(400).json({ error: "slug, key und anruf_id erforderlich." });
      return;
    }

    var dashRes = await fetch(base + "/rest/v1/crm_dashboards?slug=eq." +
      encodeURIComponent(slug) + "&aktiv=is.true&select=key,betrieb_name,agent_id", { headers: headers });
    if (!dashRes.ok) {
      res.status(502).json({ error: "Datenbank nicht erreichbar." });
      return;
    }
    var dashRows = await dashRes.json();
    var dash = dashRows && dashRows[0];
    if (!dash || dash.key !== key) {
      res.status(403).json({ error: "Kein Zugriff." });
      return;
    }

    var filters = "betrieb_name.eq." + encodeURIComponent(dash.betrieb_name);
    if (dash.agent_id) filters = "agent_id.eq." + encodeURIComponent(dash.agent_id) + "," + filters;

    var patchRes = await fetch(base + "/rest/v1/crm_anrufe?id=eq." + anrufId +
      "&or=(" + filters + ")", {
      method: "PATCH",
      headers: Object.assign({ "Content-Type": "application/json", "Prefer": "return=representation" }, headers),
      body: JSON.stringify({ status: "erledigt" })
    });
    if (!patchRes.ok) {
      res.status(502).json({ error: "Update fehlgeschlagen." });
      return;
    }
    var updated = await patchRes.json();
    if (!updated || !updated.length) {
      res.status(404).json({ error: "Anruf nicht gefunden." });
      return;
    }
    res.status(200).json({ ok: true, id: anrufId, status: "erledigt" });
  } catch (err) {
    res.status(500).json({ error: "Unerwarteter Fehler.", detail: String(err).slice(0, 200) });
  }
};
