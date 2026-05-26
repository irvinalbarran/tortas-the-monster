const MERCADO_PAGO_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
const SUPABASE_URL = process.env.SUPABASE_URL || 'https://otyswvsghievcnacgzit.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90eXN3dnNnaGlldmNuYWNneml0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MzM3MTUsImV4cCI6MjA5NTIwOTcxNX0.OOCrJ6gbnUDylHWzDA-ArA9tMffA1PcHQPuo7PBaBJA';
exports.handler = async function(event) {
  const headers = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (event.httpMethod === 'OPTIONS') return { statusCode: 204, headers, body: '' };
  if (event.httpMethod !== 'POST') return { statusCode: 405, headers, body: JSON.stringify({ error: 'Method not allowed' }) };
  try {
    const body = JSON.parse(event.body);
    const { items, customer, delivery } = body;
    if (!items || !items.length) throw new Error('Carrito vacío');
    const total = items.reduce((s, i) => s + i.price * i.qty, 0);
    let orderNumber = await getNextOrderNumber();
    if (!orderNumber) orderNumber = Math.floor(1000 + Math.random() * 90000);
    const preferenceId = await createMPPreference(items, total, customer, delivery, orderNumber);
    saveOrder(orderNumber, preferenceId, items, total, customer, delivery).catch(e => console.error('saveOrder falló (no crítico):', e.message));
    return {
      statusCode: 200, headers,
      body: JSON.stringify({ preference_id: preferenceId.id, init_point: preferenceId.init_point, order_number: orderNumber })
    };
  } catch (e) {
    return { statusCode: 400, headers, body: JSON.stringify({ error: e.message }) };
  }
};
async function getNextOrderNumber() {
  try {
    const r = await fetch(SUPABASE_URL + '/rest/v1/orders?select=order_number&order=order_number.desc&limit=1', {
      headers: { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON }
    });
    if (r.ok) {
      const rows = await r.json();
      return (rows && rows.length && rows[0].order_number) ? rows[0].order_number + 1 : 1001;
    }
  } catch(e) {}
  return Math.floor(1000 + Math.random() * 90000);
}
async function createMPPreference(items, total, customer, delivery, orderNumber) {
  if (!MERCADO_PAGO_ACCESS_TOKEN) throw new Error('MP_ACCESS_TOKEN no configurado');
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
  const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + MERCADO_PAGO_ACCESS_TOKEN,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      items: mpItems,
      payer,
      external_reference: String(orderNumber),
      notification_url: process.env.URL + '/.netlify/functions/mp-webhook',
      back_urls: {
        success: process.env.URL + '/?order=' + orderNumber,
        failure: process.env.URL + '/?order=fail',
        pending: process.env.URL + '/?order=pending'
      },
      auto_return: 'approved',
      statement_descriptor: 'THE MONSTER DARK KITCHEN',
      metadata: { order_number: orderNumber, description }
    })
  });
  if (!r.ok) { const t = await r.text(); throw new Error('MP: ' + t.substring(0, 100)); }
  return await r.json();
}
async function saveOrder(orderNumber, preferenceId, items, total, customer, delivery) {
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
  const r = await fetch(SUPABASE_URL + '/rest/v1/orders', {
    method: 'POST',
    headers: {
      'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify([row])
  });
  if (!r.ok) { const t = await r.text(); throw new Error('Save order: ' + t.substring(0, 80)); }
}
