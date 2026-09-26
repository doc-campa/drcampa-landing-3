/* ==========================================================
   GEMA SALES HUB — Landing Laser · PONTE CHIAMATO DAL BROWSER
   ----------------------------------------------------------
   ALTERNATIVA a submission-created.mjs, non da usare insieme:
   se entrambi sono attivi, GEMA riceve lo stesso lead due volte
   (con externalId diversi, quindi NON verrebbero deduplicati).

   Quando usarla: se la funzione attivata da Netlify Forms non
   parte. In quel caso, in index.html rimettere:
       var CRM_ENABLED = true;
   e cancellare (o lasciare inattiva) submission-created.

   VARIABILI D'AMBIENTE (scope: Functions)
     GEMA_URL     https://domenicocampa.net/api/landing-leads
     GEMA_TOKEN   token di produzione (segreto)
     GEMA_SOURCE  laser   (facoltativa: se assente usa "laser")

   Il token resta sul server: il browser parla solo con questa funzione.
   ========================================================== */

const MAX_BYTES  = 16 * 1024;
const TIMEOUT_MS = 8000;

function s(v, max) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max || 160);
}

function json(obj, status) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { 'Content-Type': 'application/json' }
  });
}

export default async (req) => {
  if (req.method !== 'POST') {
    return json({ ok: false, errore: 'metodo non consentito' }, 405);
  }

  const URL_GEMA = process.env.GEMA_URL;
  const TOKEN    = process.env.GEMA_TOKEN;
  const SOURCE   = process.env.GEMA_SOURCE || 'laser';

  console.log('[GEMA/lead] chiamata ricevuta · URL:', URL_GEMA ? 'presente' : 'MANCANTE',
              '· TOKEN:', TOKEN ? 'presente' : 'MANCANTE', '· SOURCE:', SOURCE);

  if (!URL_GEMA || !TOKEN) {
    return json({ ok: false, errore: 'integrazione non configurata' }, 503);
  }

  let b;
  try {
    b = await req.json();
  } catch (e) {
    return json({ ok: false, errore: 'JSON non valido' }, 400);
  }

  // ----- campi comuni -----
  const payload = {
    source:     SOURCE,
    externalId: s(b.externalId, 160),
    firstName:  s(b.firstName, 160),
    lastName:   s(b.lastName, 160),
    email:      s(b.email, 254),
    phone:      s(b.phone, 40)
  };

  // ----- campi del modulo · consenso e sito_web NON vanno inviati -----
  const opzionali = {
    problema:     s(b.problema, 160),
    budget:       s(b.budget, 160),
    obiettivo:    s(b.obiettivo, 500),
    message:      s(b.message, 2000),
    origine:      s(b.origine, 160),
    treatment:    s(b.treatment, 160),
    utm_source:   s(b.utm_source, 160),
    utm_medium:   s(b.utm_medium, 160),
    utm_campaign: s(b.utm_campaign, 160),
    utm_content:  s(b.utm_content, 160),
    utm_term:     s(b.utm_term, 160),
    gclid:        s(b.gclid, 255),
    fbclid:       s(b.fbclid, 255),
    referrer:     s(b.referrer, 500),
    landing:      s(b.landing, 255)
  };
  for (const k in opzionali) {
    if (opzionali[k]) payload[k] = opzionali[k];
  }

  if (!payload.externalId || !payload.firstName || !payload.lastName) {
    return json({ ok: false, errore: 'campi obbligatori mancanti' }, 400);
  }
  if (!payload.email && !payload.phone) {
    return json({ ok: false, errore: 'serve almeno email o telefono' }, 400);
  }

  let raw = JSON.stringify(payload);
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) {
    if (payload.obiettivo) payload.obiettivo = payload.obiettivo.slice(0, 200);
    if (payload.message)   payload.message   = payload.message.slice(0, 500);
    raw = JSON.stringify(payload);
  }

  console.log('[GEMA/lead] payload:', raw.slice(0, 600));

  // ----- un tentativo + un ritentativo sugli errori temporanei -----
  let ultimo = null;
  for (let i = 0; i < 2; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1200));
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
      const res = await fetch(URL_GEMA, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': 'Bearer ' + TOKEN
        },
        body: raw,
        signal: ctrl.signal
      });
      clearTimeout(t);

      const testo = await res.text();
      console.log('[GEMA/lead] risposta HTTP', res.status, '·', testo.slice(0, 400));

      let dati = null;
      try { dati = JSON.parse(testo); } catch (e) { /* risposta non JSON */ }

      if (res.status === 200 || res.status === 201) {
        return json({ ok: true, stato: res.status, id: (dati && (dati.id || dati.leadId)) || null });
      }

      if ([400, 401, 413, 415].includes(res.status)) {
        return json({ ok: false, stato: res.status, errore: 'richiesta rifiutata' }, 502);
      }

      ultimo = { stato: res.status, testo: testo.slice(0, 300) };
    } catch (err) {
      ultimo = { stato: 0, testo: String(err && err.message || err) };
      console.warn('[GEMA/lead] tentativo', i + 1, 'fallito:', ultimo.testo);
    }
  }

  return json({ ok: false, errore: 'GEMA non raggiungibile', dettaglio: ultimo }, 502);
};
