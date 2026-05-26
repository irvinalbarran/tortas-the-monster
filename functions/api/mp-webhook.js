const corsHeaders = () => ({
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'Content-Type',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
});

export async function onRequest(context) {
  const { request, env } = context;
  if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers: corsHeaders() });
  if (request.method !== 'POST') return new Response('OK', { status: 200 });

  const SUPABASE_URL = env.SUPABASE_URL || 'https://otyswvsghievcnacgzit.supabase.co';
  const SUPABASE_ANON = env.SUPABASE_ANON || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90eXN3dnNnaGlldmNuYWNneml0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MzM3MTUsImV4cCI6MjA5NTIwOTcxNX0.OOCrJ6gbnUDylHWzDA-ArA9tMffA1PcHQPuo7PBaBJA';
  const MP_TOKEN = env.MP_ACCESS_TOKEN;
  const WA_NUMBER = env.WA_NUMBER || '525662771966';

  try {
    const body = await request.json();
    const { action, data } = body;
    if (action === 'payment.created' || action === 'payment.updated') {
      const paymentId = data.id;
      const paymentInfo = await getPaymentInfo(MP_TOKEN, paymentId);
      if (paymentInfo) {
        const orderNumber = parseInt(paymentInfo.external_reference) || 0;
        const status = mapMPStatus(paymentInfo.status);
        if (orderNumber) {
          await updateOrderStatus(SUPABASE_URL, SUPABASE_ANON, orderNumber, status, paymentId);
          if (status === 'paid') await sendWhatsAppNotification(SUPABASE_URL, SUPABASE_ANON, orderNumber, WA_NUMBER);
        }
      }
    }
    return new Response('OK', { status: 200 });
  } catch (e) {
    console.error('Webhook error:', e.message);
    return new Response('OK', { status: 200 });
  }
}

async function getPaymentInfo(token, paymentId) {
  if (!token) return null;
  const r = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { 'Authorization': `Bearer ${token}` }
  });
  if (!r.ok) return null;
  return await r.json();
}

function mapMPStatus(s) {
  if (s === 'approved') return 'paid';
  if (s === 'pending' || s === 'in_process') return 'pending';
  if (s === 'rejected' || s === 'cancelled' || s === 'refunded') return 'cancelled';
  return 'pending';
}

async function updateOrderStatus(url, anon, orderNumber, status, paymentId) {
  const r = await fetch(`${url}/rest/v1/orders?order_number=eq.${orderNumber}`, {
    method: 'PATCH',
    headers: {
      'apikey': anon, 'Authorization': `Bearer ${anon}`,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({ status, mp_payment_id: String(paymentId), payment_status: status, updated_at: new Date().toISOString() })
  });
  return r.ok;
}

async function sendWhatsAppNotification(url, anon, orderNumber, waNumber) {
  const r = await fetch(`${url}/rest/v1/orders?order_number=eq.${orderNumber}`, {
    headers: { 'apikey': anon, 'Authorization': `Bearer ${anon}` }
  });
  if (!r.ok) return;
  const rows = await r.json();
  if (!rows || !rows.length) return;
  const o = rows[0];
  const items = typeof o.items === 'string' ? JSON.parse(o.items) : (o.items || []);
  const itemsList = items.map(i => `• ${i.qty}x ${i.name} — $${(i.price * i.qty).toFixed(2)}`).join('\n');
  const waMsg = encodeURIComponent(
    `🦷 *THE MONSTER — PEDIDO CONFIRMADO* 🦷\n` +
    `🧾 *Pedido #${o.order_number}*\n` +
    `✅ *Estado:* PAGADO\n\n` +
    `👤 *Cliente:* ${o.user_name}\n` +
    `📞 *Tel:* ${o.user_phone}\n` +
    `🚚 *Entrega:* ${o.delivery_mode === 'domicilio' ? 'A domicilio' : 'Recoger en local'}\n` +
    (o.delivery_mode === 'domicilio' ? `📍 *Dirección:* ${o.direction || '-'}, ${o.colonia || ''}\n` : '') +
    (o.notes ? `📝 *Notas:* ${o.notes}\n` : '') +
    `\n🍔 *PRODUCTOS:*\n${itemsList}\n\n` +
    `💰 *Total:* $${o.total.toFixed(2)}\n` +
    `💳 *Pago:* Mercado Pago ✅\n` +
    `🆔 *Pago ID:* ${o.mp_payment_id || '—'}\n` +
    `\n🕐 *Hora:* ${new Date().toLocaleString('es-MX')}`
  );
  await fetch(`https://api.whatsapp.com/send?phone=${waNumber}&text=${waMsg}`, { method: 'GET' });
}
