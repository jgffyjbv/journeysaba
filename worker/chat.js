/**
 * Journeys ABA chat proxy — Cloudflare Worker.
 * Holds the OpenAI key as a secret; the static site never sees it.
 * Rate-limited per-IP and per-day via KV so a bad actor can't drain credit.
 */

const ALLOWED_ORIGINS = [
  'https://jgffyjbv.github.io',
  'https://journeysaba.org',
  'https://www.journeysaba.org',
];

const SYSTEM_PROMPT = `You are the friendly virtual assistant on the Journeys ABA Therapy website (New Jersey).

About Journeys ABA:
- ABA (Applied Behavior Analysis) therapy for children with autism, serving New Jersey families.
- Services: In-Home ABA Therapy, School-Based Support, Community-Based Therapy, and Parent & Caregiver Training.
- Getting started is a 4-step process: 1) Free Consultation, 2) Insurance Verification, 3) BCBA Assessment, 4) Therapy Begins.
- Phone: (732) 305-2619. Email: info@journeysaba.org.
- The Contact page has a free-consultation form; the Resources page has parent guides and an FAQ; the Careers page lists open positions for BCBAs and behavior technicians.

How to answer:
- Be warm, encouraging, and concise — 2 to 4 short sentences. Plain text only, no markdown.
- Answer questions about ABA therapy, the services above, insurance, and how to get started.
- You may explain general concepts about ABA and autism supportively, but do NOT give medical, diagnostic, or treatment advice for a specific child — instead warmly suggest scheduling the free consultation.
- When someone seems interested or asks about next steps, guide them to the free-consultation form on the Contact page or the phone number (732) 305-2619.
- If asked something unrelated to Journeys ABA or autism services, politely steer the conversation back.
- Never invent prices, staff names, locations, or policies that are not listed above.`;

const FALLBACK =
  "I'm having a little trouble answering right now. Please call us at (732) 305-2619 or use the consultation form on our Contact page — we'd love to help!";

const RATE_MSG =
  "You've reached the chat limit for now. We'd still love to talk — call (732) 305-2619 or send the consultation form on our Contact page!";

function json(obj, status, cors) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { 'Content-Type': 'application/json', ...cors },
  });
}

export default {
  async fetch(request, env) {
    const origin = request.headers.get('Origin') || '';
    const okOrigin = ALLOWED_ORIGINS.includes(origin);
    const cors = {
      'Access-Control-Allow-Origin': okOrigin ? origin : ALLOWED_ORIGINS[0],
      'Access-Control-Allow-Methods': 'POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
      'Vary': 'Origin',
    };

    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: cors });
    if (request.method !== 'POST') return json({ error: 'POST only' }, 405, cors);
    if (!okOrigin) return json({ error: 'forbidden' }, 403, cors);

    // rate limits: 20/hour per IP, 400/day site-wide
    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const hourBucket = Math.floor(Date.now() / 3600000);
    const dayBucket = new Date().toISOString().slice(0, 10);
    const ipKey = 'ip:' + ip + ':' + hourBucket;
    const dayKey = 'day:' + dayBucket;
    const [ipN, dayN] = await Promise.all([env.RATE.get(ipKey), env.RATE.get(dayKey)]);
    if ((Number(ipN) || 0) >= 20 || (Number(dayN) || 0) >= 400) {
      return json({ reply: RATE_MSG }, 429, cors);
    }
    await Promise.all([
      env.RATE.put(ipKey, String((Number(ipN) || 0) + 1), { expirationTtl: 3900 }),
      env.RATE.put(dayKey, String((Number(dayN) || 0) + 1), { expirationTtl: 90000 }),
    ]);

    let body;
    try { body = await request.json(); } catch (e) { return json({ error: 'bad json' }, 400, cors); }

    let messages = Array.isArray(body.messages) ? body.messages : [];
    messages = messages
      .filter(m => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string')
      .slice(-10)
      .map(m => ({ role: m.role, content: m.content.slice(0, 1500) }));
    if (!messages.length || messages[messages.length - 1].role !== 'user') {
      return json({ error: 'no message' }, 400, cors);
    }

    try {
      const r = await fetch('https://api.openai.com/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + env.OPENAI_API_KEY,
        },
        body: JSON.stringify({
          model: 'gpt-4o-mini',
          max_tokens: 350,
          temperature: 0.5,
          messages: [{ role: 'system', content: SYSTEM_PROMPT }].concat(messages),
        }),
      });
      if (!r.ok) return json({ reply: FALLBACK }, 200, cors);
      const j = await r.json();
      const reply = (j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content) || FALLBACK;
      return json({ reply }, 200, cors);
    } catch (e) {
      return json({ reply: FALLBACK }, 200, cors);
    }
  },
};
