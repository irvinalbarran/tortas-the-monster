const corsHeaders = () => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
});

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
  if (request.method !== 'POST') return new Response(JSON.stringify({ error: 'Method not allowed' }), { status: 405, headers: { ...corsHeaders(), 'Content-Type': 'application/json' } });

  const MP_TOKEN = env.MP_ACCESS_TOKEN;
  const SUPABASE_URL = env.SUPABASE_URL || 'https://otyswvsghievcnacgzit.supabase.co';
  const SUPABASE_ANON = env.SUPABASE_ANON || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90eXN3dnNnaGlldmNuYWNneml0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MzM3MTUsImV4cCI6MjA5NTIwOTcxNX0.OOCrJ6gbnUDylHWzDA-ArA9tMffA1PcHQPuo7PBaBJA';

  try {
    const body = await request.json();
    const { items, customer, delivery } = body;
    if (!items || !items.length) throw new Error('Carrito vacío');
    const total = items.reduce((s, i) => s + i.price * i.qty, 0);

    let orderNumber = await getNextOrderNumber(SUPABASE_URL, SUPABASE_ANON);
    if (!orderNumber) orderNumber = Math.floor(1000 + Math.random() * 90000);

    const preferenceId = await createMPPreference(MP_TOKEN, items, total, customer, delivery, orderNumber, env);
    saveOrder(SUPABASE_URL, SUPABASE_ANON, orderNumber, preferenceId, items, total, customer, delivery).catch(e => console.error('saveOrder falló:', e.message));

    return new Response(JSON.stringify({ preference_id: preferenceId.id, init_point: preferenceId.init_point, order_number: orderNumber }), {
      headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    });
  } catch (e) {
    return new Response(JSON.stringify({ error: e.message }), {
      status: 400, headers: { ...corsHeaders(), 'Content-Type': 'application/json' }
    });
  }
}

async function getNextOrderNumber(url, anon) {
  try {
    const r = await fetch(`${url}/rest/v1/orders?select=order_number&order=order_number.desc&limit=1`, {
      headers: { 'apikey': anon, 'Authorization': `Bearer ${anon}` }
    });
    if (r.ok) {
      const rows = await r.json();
      return (rows && rows.length && rows[0].order_number) ? rows[0].order_number + 1 : 1001;
    }
  } catch(e) {}
  return null;
}

async function createMPPreference(token, items, total, customer, delivery, orderNumber, env) {
  if (!token) throw new Error('MP_ACCESS_TOKEN no configurado');
  const mpItems = items.map(i => ({
    title: i.name,
    quantity: i.qty,
    currency_id: 'MXN',
    unit_price: i.price
  }));
  const description = delivery.mode === 'domicilio'
    ? `Envío a ${delivery.colonia || ''} - ${delivery.direction || ''}`
    : 'Recoger en local';
  const payer = { name: customer.name, phone: { number: customer.phone } };
  if (customer.email) payer.email = customer.email;

  const siteUrl = env.CF_PAGES_URL || `https://${env.CF_PAGES_BRANCH}.tortas-the-monster.pages.dev`;
  const webhookUrl = `${siteUrl}/api/mp-webhook`;

  const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      items: mpItems,
      payer,
      external_reference: String(orderNumber),
      notification_url: webhookUrl,
      back_urls: {
        success: `${siteUrl}/?order=${orderNumber}`,
        failure: `${siteUrl}/?order=fail`,
        pending: `${siteUrl}/?order=pending`
      },
      auto_return: 'approved',
      statement_descriptor: 'THE MONSTER DARK KITCHEN',
      metadata: { order_number: orderNumber, description }
    })
  });
  if (!r.ok) { const t = await r.text(); throw new Error('MP: ' + t.substring(0, 100)); }
  return await r.json();
}

async function saveOrder(url, anon, orderNumber, preferenceId, items, total, customer, delivery) {
  const row = {
    order_number: orderNumber,
    user_email: customer.email || '',
    user_name: customer.name,
    user_phone: customer.phone,
    delivery_mode: delivery.mode || 'domicilio',
    colonia: delivery.colonia || '',
    direction: delivery.direction || '',
    notes: delivery.notes || '',
    items: JSON.stringify(items),
    total,
    status: 'pending',
    mp_preference_id: preferenceId.id,
    payment_status: 'pending'
  };
  const r = await fetch(`${url}/rest/v1/orders`, {
    method: 'POST',
    headers: {
      'apikey': anon, 'Authorization': `Bearer ${anon}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify([row])
  });
  if (!r.ok) { const t = await r.text(); throw new Error('Save order: ' + t.substring(0, 80)); }
}
