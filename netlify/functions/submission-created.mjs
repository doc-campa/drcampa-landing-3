/* ==========================================================
   GEMA SALES HUB — Landing Laser
   ----------------------------------------------------------
   Funzione attivata da Netlify Forms (evento submission-created):
   parte DOPO che Netlify ha registrato l'invio, legge i campi dalla
   submission e inoltra a GEMA con il token preso dalle variabili
   d'ambiente. Il browser non chiama nulla e il token non transita
   mai dal client.

   VARIABILI D'AMBIENTE da impostare su Netlify (scope: Functions)
     GEMA_URL     https://domenicocampa.net/api/landing-leads
     GEMA_TOKEN   token di produzione (segreto)
     GEMA_SOURCE  laser        (facoltativa: se assente usa "laser")

   Se GEMA_TOKEN manca, la funzione esce senza inviare nulla:
   la submission resta comunque su Netlify Forms.
   ========================================================== */

const MAX_BYTES  = 16 * 1024;
const TIMEOUT_MS = 8000;
const TENTATIVI  = 3;

function s(v, max) {
  if (v === undefined || v === null) return '';
  return String(v).trim().slice(0, max || 160);
}

export const handler = async (event) => {
  /* ---- DIAGNOSTICA: questa riga deve comparire a ogni invio del form ---- */
  console.log('[GEMA] === funzione attivata ===');

  const URL_GEMA = process.env.GEMA_URL;
  const TOKEN    = process.env.GEMA_TOKEN;
  const SOURCE   = process.env.GEMA_SOURCE || 'laser';

  console.log('[GEMA] config · URL:', URL_GEMA ? 'presente' : 'MANCANTE',
              '· TOKEN:', TOKEN ? ('presente (' + String(TOKEN).length + ' caratteri)') : 'MANCANTE',
              '· SOURCE:', SOURCE);

  if (!URL_GEMA || !TOKEN) {
    console.warn('[GEMA] variabili mancanti: invio saltato, la submission resta su Netlify Forms');
    return { statusCode: 200, body: 'skip' };
  }

  let d = {};
  try {
    const body = JSON.parse(event.body || '{}');
    d = (body.payload && body.payload.data) || body.data || {};
    console.log('[GEMA] campi ricevuti da Netlify:', Object.keys(d).join(', ') || '(nessuno)');
  } catch (e) {
    console.error('[GEMA] payload Netlify non leggibile:', e.message);
    console.error('[GEMA] primi 400 caratteri del body:', String(event.body || '').slice(0, 400));
    return { statusCode: 200, body: 'bad payload' };
  }

  // ----- campi comuni -----
  const payload = {
    source:     SOURCE,
    externalId: s(d.externalId, 160) || ('laser-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10)),
    firstName:  s(d.firstName, 160),
    lastName:   s(d.lastName, 160),
    email:      s(d.email, 254),
    phone:      s(d.phone, 40)
  };

  // ----- campi del modulo -----
  // consenso e sito_web NON vanno inviati: restano gestiti dal sito
  const opzionali = {
    problema:   s(d.problema, 160),
    budget:     s(d.budget, 160),
    obiettivo:  s(d.obiettivo, 500),
    message:    s(d.message, 2000),
    origine:    s(d.origine, 160),
    treatment:  s(d.treatment, 160),
    utm_source: s(d.utm_source, 160),
    utm_medium: s(d.utm_medium, 160),
    utm_campaign: s(d.utm_campaign, 160),
    utm_content:  s(d.utm_content, 160),
    utm_term:     s(d.utm_term, 160),
    gclid:      s(d.gclid, 255),
    fbclid:     s(d.fbclid, 255),
    referrer:   s(d.referrer, 500),
    landing:    s(d.landing, 255)
  };
  for (const k in opzionali) {
    if (opzionali[k]) payload[k] = opzionali[k];
  }

  if (!payload.firstName || !payload.lastName) {
    console.error('[GEMA] nome o cognome mancanti, invio annullato');
    return { statusCode: 200, body: 'campi mancanti' };
  }

  let raw = JSON.stringify(payload);
  if (Buffer.byteLength(raw, 'utf8') > MAX_BYTES) {
    // taglia i campi lunghi invece di perdere il lead
    if (payload.obiettivo) payload.obiettivo = payload.obiettivo.slice(0, 200);
    if (payload.message)   payload.message   = payload.message.slice(0, 500);
    raw = JSON.stringify(payload);
    console.warn('[GEMA] payload accorciato per rientrare nei 16 KB');
  }

  console.log('[GEMA] payload in partenza:', raw.slice(0, 600));

  // ----- invio, con ritentativi sugli errori temporanei -----
  for (let i = 0; i < TENTATIVI; i++) {
    if (i > 0) await new Promise(r => setTimeout(r, 1500 * i));
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

      console.log('[GEMA] risposta HTTP', res.status, '·', testo.slice(0, 400));

      if (res.status === 201 || res.status === 200) {
        console.log('[GEMA] ok', res.status, '· externalId', payload.externalId, '· origine', payload.origine || '-');
        return { statusCode: 200, body: 'ok' };
      }

      if ([400, 401, 413, 415].includes(res.status)) {
        console.error('[GEMA] errore non ritentabile', res.status, '·', testo.slice(0, 300));
        return { statusCode: 200, body: 'errore dati' };
      }

      console.warn('[GEMA] temporaneo', res.status, '· tentativo', i + 1, '/', TENTATIVI);
    } catch (err) {
      console.warn('[GEMA] invio fallito · tentativo', i + 1, '/', TENTATIVI, '·', String(err && err.message || err));
    }
  }

  console.error('[GEMA] non inviato dopo', TENTATIVI, 'tentativi · externalId', payload.externalId);
  return { statusCode: 200, body: 'non inviato' };
};
