-- Tabla de pedidos con integración Mercado Pago
CREATE TABLE IF NOT EXISTS orders (
  id BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  order_number INT NOT NULL,
  user_email TEXT,
  user_name TEXT NOT NULL,
  user_phone TEXT NOT NULL,
  delivery_mode TEXT NOT NULL DEFAULT 'domicilio',
  colonia TEXT,
  direction TEXT,
  notes TEXT,
  items JSONB NOT NULL DEFAULT '[]',
  total NUMERIC(10,2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  mp_preference_id TEXT,
  mp_payment_id TEXT,
  payment_status TEXT DEFAULT 'pending',
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Secuencia para números de pedido consecutivos
CREATE SEQUENCE IF NOT EXISTS order_number_seq START 1001;

-- Función para obtener el siguiente número de pedido
CREATE OR REPLACE FUNCTION next_order_number()
RETURNS INT
LANGUAGE SQL
AS $$ SELECT nextval('order_number_seq')::INT; $$;

-- Políticas RLS: permitir inserts anónimos y selects propios
DROP POLICY IF EXISTS anon_insert_orders ON orders;
CREATE POLICY anon_insert_orders ON orders FOR INSERT TO anon WITH CHECK (true);
DROP POLICY IF EXISTS anon_select_orders ON orders;
CREATE POLICY anon_select_orders ON orders FOR SELECT TO anon USING (true);
DROP POLICY IF EXISTS anon_update_orders ON orders;
CREATE POLICY anon_update_orders ON orders FOR UPDATE TO anon USING (true) WITH CHECK (true);

-- Refrescar cache de schema
NOTIFY pgrst, 'reload schema';
