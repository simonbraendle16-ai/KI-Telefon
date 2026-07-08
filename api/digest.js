// Vercel Serverless Function — POST /api/digest
// Fasst ein Demo-Telefongespraech in eine strukturierte Zusammenfassung (4 Felder).
// Secret NUR als Env-Var MISTRAL_API_KEY (Vercel-Projekt-Settings), nie im Repo.

module.exports = async function handler(req, res) {
  if (req.method !== "POST") {
    res.status(405).json({ error: "Method not allowed" });
    return;
  }

  var apiKey = process.env.MISTRAL_API_KEY;
  if (!apiKey) {
    res.status(500).json({ error: "Server nicht konfiguriert (MISTRAL_API_KEY fehlt)." });
    return;
  }

  try {
    var body = req.body;
    if (typeof body === "string") {
      try { body = JSON.parse(body || "{}"); } catch (e) { body = {}; }
    }
    var transcript = (body && body.transcript) ? String(body.transcript).trim() : "";

    if (transcript.length < 20) {
      res.status(400).json({ error: "Kein verwertbares Gespraech." });
      return;
    }
    if (transcript.length > 12000) transcript = transcript.slice(0, 12000);

    var system =
      "Du fasst ein Telefongespraech zwischen einem KI-Assistenten ('Assistent') und einem " +
      "Anrufer fuer den Betriebsinhaber zusammen. Antworte AUSSCHLIESSLICH mit einem JSON-Objekt " +
      "mit genau diesen Feldern. " +
      "Vier Zusammenfassungs-Felder, jeweils 1-2 nuechterne deutsche Saetze: " +
      "'anlass' (worum ging es), " +
      "'reaktion' (was der Assistent gesagt/getan hat; nenne ausdruecklich, wenn er etwas NICHT " +
      "zugesagt oder an einen Menschen uebergeben hat), " +
      "'ergebnis' (was konkret daraus wurde), " +
      "'auffaelligkeit' (was der Inhaber wissen sollte; '-' wenn nichts Besonderes). " +
      "Dazu 'erfasst': ein Objekt mit den im Gespraech GENANNTEN Daten des Anrufers — " +
      "'name', 'rueckrufnummer', 'anliegen' (max. 8 Woerter), 'dringlichkeit' ('hoch', 'normal' " +
      "oder '-'); nicht genannte Felder als '-', NIE erfinden. " +
      "Dazu 'termin': NUR wenn im Gespraech ein konkreter Termin oder Terminwunsch besprochen " +
      "wurde, ein Objekt mit 'beschreibung' (kurz, z. B. 'Besichtigung Lindauer Str. 12'), " +
      "'start_iso' (ISO 8601 lokal, z. B. 2026-07-10T14:00 — nur wenn Datum UND Uhrzeit klar " +
      "sind, sonst null) und 'dauer_minuten' (Zahl, Standard 30); sonst ist 'termin' null. " +
      "Kein Text ausserhalb des JSON, kein Markdown. Schreibe Umlaute (ae->ä, oe->ö, ue->ü, ss->ß) korrekt.";

    var mistralRes = await fetch("https://api.mistral.ai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": "Bearer " + apiKey,
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        model: "mistral-small-latest",
        temperature: 0.2,
        max_tokens: 600,
        response_format: { type: "json_object" },
        messages: [
          { role: "system", content: system },
          { role: "user", content: "Heute ist der " + new Date().toISOString().slice(0, 10) +
            " (fuer relative Datumsangaben wie 'morgen'). Hier das Transkript:\n\n" + transcript }
        ]
      })
    });

    if (!mistralRes.ok) {
      var errText = await mistralRes.text();
      res.status(502).json({ error: "Zusammenfassung fehlgeschlagen.", detail: errText.slice(0, 300) });
      return;
    }

    var data = await mistralRes.json();
    var content = (data && data.choices && data.choices[0] && data.choices[0].message)
      ? data.choices[0].message.content : "";

    var digest;
    try { digest = JSON.parse(content); } catch (e) {
      res.status(502).json({ error: "Antwort nicht lesbar." });
      return;
    }

    var erfasst = (digest.erfasst && typeof digest.erfasst === "object") ? digest.erfasst : {};
    var termin = null;
    if (digest.termin && typeof digest.termin === "object" && digest.termin.beschreibung) {
      termin = {
        beschreibung: String(digest.termin.beschreibung).slice(0, 120),
        start_iso: digest.termin.start_iso ? String(digest.termin.start_iso).slice(0, 16) : null,
        dauer_minuten: Number(digest.termin.dauer_minuten) || 30
      };
    }
    res.status(200).json({
      anlass: digest.anlass || "",
      reaktion: digest.reaktion || "",
      ergebnis: digest.ergebnis || "",
      auffaelligkeit: digest.auffaelligkeit || "-",
      erfasst: {
        name: erfasst.name || "-",
        rueckrufnummer: erfasst.rueckrufnummer || "-",
        anliegen: erfasst.anliegen || "-",
        dringlichkeit: erfasst.dringlichkeit || "-"
      },
      termin: termin
    });
  } catch (err) {
    res.status(500).json({ error: "Unerwarteter Fehler.", detail: String(err).slice(0, 200) });
  }
};
