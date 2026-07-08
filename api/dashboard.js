// Vercel Serverless Function — GET /api/dashboard?slug=…&key=…&range=heute|7|30
// Liefert Betrieb+Theme und die Anrufe des Zeitraums aus Supabase (crm_dashboards + crm_anrufe).
// kosten_credits wird NUR mitgeliefert, wenn zusätzlich ?admin=<DASHBOARD_ADMIN_KEY> stimmt.
// Secrets NUR als Env-Vars (SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DASHBOARD_ADMIN_KEY), nie im Repo.

module.exports = async function handler(req, res) {
  if (req.method !== "GET") {
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
    var q = req.query || {};
    var slug = String(q.slug || "").trim().toLowerCase();
    var key = String(q.key || "").trim();
    if (!slug || !key) {
      res.status(400).json({ error: "slug und key erforderlich." });
      return;
    }

    var dashRes = await fetch(base + "/rest/v1/crm_dashboards?slug=eq." +
      encodeURIComponent(slug) + "&aktiv=is.true&select=slug,key,betrieb_name,agent_id,theme", { headers: headers });
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

    var range = String(q.range || "heute");
    var since = new Date();
    if (range === "7") since.setDate(since.getDate() - 7);
    else if (range === "30") since.setDate(since.getDate() - 30);
    else { range = "heute"; since.setHours(0, 0, 0, 0); }

    var filters = "betrieb_name.eq." + encodeURIComponent(dash.betrieb_name);
    if (dash.agent_id) filters = "agent_id.eq." + encodeURIComponent(dash.agent_id) + "," + filters;

    var cols = "id,anrufer_name,anrufer_nummer,anliegen,rueckruf_wunsch,zusammenfassung," +
      "status,created_at,transkript,dauer_sekunden,selbst_beantwortet";
    var isAdmin = q.admin && process.env.DASHBOARD_ADMIN_KEY &&
      String(q.admin) === process.env.DASHBOARD_ADMIN_KEY;
    if (isAdmin) cols += ",kosten_credits";

    var anrufeRes = await fetch(base + "/rest/v1/crm_anrufe?or=(" + filters + ")" +
      "&created_at=gte." + encodeURIComponent(since.toISOString()) +
      "&select=" + cols + "&order=created_at.desc&limit=500", { headers: headers });
    if (!anrufeRes.ok) {
      var t = await anrufeRes.text();
      res.status(502).json({ error: "Anrufe nicht ladbar.", detail: t.slice(0, 200) });
      return;
    }
    var anrufe = await anrufeRes.json();

    res.setHeader("Cache-Control", "no-store");
    res.status(200).json({
      betrieb: dash.betrieb_name,
      theme: dash.theme || {},
      range: range,
      admin: !!isAdmin,
      anrufe: anrufe
    });
  } catch (err) {
    res.status(500).json({ error: "Unerwarteter Fehler.", detail: String(err).slice(0, 200) });
  }
};
