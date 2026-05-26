const SUPABASE_URL = process.env.SUPABASE_URL || 'https://otyswvsghievcnacgzit.supabase.co';
const SUPABASE_ANON = process.env.SUPABASE_ANON || 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im90eXN3dnNnaGlldmNuYWNneml0Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3Nzk2MzM3MTUsImV4cCI6MjA5NTIwOTcxNX0.OOCrJ6gbnUDylHWzDA-ArA9tMffA1PcHQPuo7PBaBJA';
const MERCADO_PAGO_ACCESS_TOKEN = process.env.MP_ACCESS_TOKEN;
exports.handler = async function(event) {
  if (event.httpMethod === 'POST') {
    try {
      const body = JSON.parse(event.body);
      const { action, data } = body;
      if (action === 'payment.created' || action === 'payment.updated') {
        const paymentId = data.id;
        const paymentInfo = await getPaymentInfo(paymentId);
        if (paymentInfo) {
          const orderNumber = parseInt(paymentInfo.external_reference) || 0;
          const status = mapMPStatus(paymentInfo.status);
          if (orderNumber) {
            await updateOrderStatus(orderNumber, status, paymentId);
            if (status === 'paid') await sendWhatsAppNotification(orderNumber);
          }
        }
      }
      return { statusCode: 200, body: 'OK' };
    } catch (e) {
      console.error('Webhook error:', e.message);
      return { statusCode: 200, body: 'OK' };
    }
  }
  return { statusCode: 200, body: 'OK' };
};
async function getPaymentInfo(paymentId) {
  const r = await fetch(`https://api.mercadopago.com/v1/payments/${paymentId}`, {
    headers: { 'Authorization': 'Bearer ' + MERCADO_PAGO_ACCESS_TOKEN }
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
async function updateOrderStatus(orderNumber, status, paymentId) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/orders?order_number=eq.${orderNumber}`, {
    method: 'PATCH',
    headers: {
      'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON,
      'Content-Type': 'application/json',
      'Prefer': 'return=representation'
    },
    body: JSON.stringify({ status, mp_payment_id: String(paymentId), payment_status: status, updated_at: new Date().toISOString() })
  });
  return r.ok;
}
async function sendWhatsAppNotification(orderNumber) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/orders?order_number=eq.${orderNumber}`, {
    headers: { 'apikey': SUPABASE_ANON, 'Authorization': 'Bearer ' + SUPABASE_ANON }
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
  const waNumber = process.env.WA_NUMBER || '525662771966';
  await fetch(`https://api.whatsapp.com/send?phone=${waNumber}&text=${waMsg}`, { method: 'GET' });
}
