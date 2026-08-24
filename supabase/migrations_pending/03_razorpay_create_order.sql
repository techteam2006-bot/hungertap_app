-- Migration: 03_razorpay_create_order.sql
-- Seed Razorpay gateway + fail-closed create_order_v2_app.

INSERT INTO public.payment_gateways (
  code,
  display_name,
  enabled,
  is_default,
  user_selectable,
  sort_order,
  supported_methods
)
VALUES (
  'razorpay',
  'Razorpay',
  true,
  false,
  true,
  3,
  '["upi", "card", "netbanking", "wallet"]'::jsonb
)
ON CONFLICT (code) DO UPDATE SET
  display_name = EXCLUDED.display_name,
  supported_methods = EXCLUDED.supported_methods,
  updated_at = NOW();

CREATE OR REPLACE FUNCTION public.create_order_v2_app(
  p_gateway_code TEXT DEFAULT NULL,
  p_is_takeaway BOOLEAN DEFAULT false,
  p_items JSONB DEFAULT '[]'::jsonb,
  p_placed_by UUID DEFAULT NULL
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_placed_by           UUID;
  v_canteen_id          UUID;
  v_placed_by_role      TEXT;
  v_is_open             BOOLEAN;
  v_app_orders_enabled  BOOLEAN;
  v_takeaway_charge     NUMERIC(10, 2);

  v_valid_count         INT;
  v_total_quantity      INT;
  v_total_amount        NUMERIC(12, 2);

  v_order_token         TEXT;
  v_barcode             TEXT;
  v_order_id            UUID;
  v_order_status        TEXT;
  v_payment_id          UUID := NULL;
  v_gateway_code        TEXT;
BEGIN
  -- Security Check: verify placed_by identity if auth session is active
  IF auth.uid() IS NOT NULL AND p_placed_by IS NOT NULL AND p_placed_by <> auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid placed_by user');
  END IF;

  v_placed_by := COALESCE(p_placed_by, auth.uid());
  IF v_placed_by IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User ID is required');
  END IF;

  -- 1. Dynamic Gateway Resolution (Fail-Closed)
  IF p_gateway_code IS NOT NULL AND trim(p_gateway_code) <> '' THEN
    v_gateway_code := lower(trim(p_gateway_code));
    IF NOT EXISTS (
      SELECT 1 FROM public.payment_gateways
      WHERE code = v_gateway_code AND enabled = true AND user_selectable = true
    ) THEN
      RETURN jsonb_build_object('success', false, 'error', 'selected_gateway_unavailable');
    END IF;
  ELSE
    -- Fail-Closed: Strictly resolve active default (0 rows -> error, 1 row -> use it)
    SELECT code INTO v_gateway_code
    FROM public.payment_gateways
    WHERE enabled = true AND is_default = true;

    IF v_gateway_code IS NULL THEN
      RETURN jsonb_build_object('success', false, 'error', 'no_active_default_gateway_configured');
    END IF;
  END IF;

  v_order_id := gen_random_uuid();

  -- 2. Validate user canteen & role
  SELECT canteen_id, role INTO v_canteen_id, v_placed_by_role
  FROM public.validate_user_canteen_role_v2(v_placed_by);

  SELECT is_open, coalesce(takeaway_charge, 10.00), coalesce(app_orders_enabled, true)
  INTO v_is_open, v_takeaway_charge, v_app_orders_enabled
  FROM public.canteens WHERE id = v_canteen_id;

  IF v_placed_by_role <> 'canteen_admin' THEN
    IF v_is_open IS NOT TRUE THEN
      RETURN jsonb_build_object('success', false, 'error', 'Canteen is currently closed. Please try again later.');
    END IF;
    IF v_app_orders_enabled IS NOT TRUE THEN
      RETURN jsonb_build_object('success', false, 'error', 'App orders are paused for this canteen. Please order at the counter.');
    END IF;
  END IF;

  -- 3. Calculate cart totals & validate stock
  SELECT valid_count, total_quantity, total_amount
  INTO v_valid_count, v_total_quantity, v_total_amount
  FROM public.calculate_cart_totals_v2(v_canteen_id, p_items, p_is_takeaway, v_takeaway_charge);

  -- 4. Generate daily token & barcode
  v_order_token := public.generate_daily_order_token_v2(v_canteen_id);
  v_barcode := public.generate_unique_barcode_v2(v_canteen_id);

  -- 5. Insert order and items
  v_order_status := public.insert_order_and_items_v2(
    v_order_id, v_canteen_id, v_placed_by, v_placed_by_role,
    v_order_token, v_barcode, p_is_takeaway, v_total_amount, p_items, v_takeaway_charge
  );

  -- 6. Create payment record stamped with resolved gateway
  IF v_order_status = 'pending_payment' THEN
    INSERT INTO public.payments (order_id, gateway_name, amount, status, created_at)
    VALUES (v_order_id, v_gateway_code, v_total_amount, 'initiated', NOW())
    RETURNING id INTO v_payment_id;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'order_token', v_order_token,
    'barcode', v_barcode,
    'amount', v_total_amount,
    'total_amount', v_total_amount,
    'status', v_order_status,
    'payment_id', v_payment_id,
    'gateway_code', v_gateway_code
  );
END;
$$;

ALTER FUNCTION public.create_order_v2_app(TEXT, BOOLEAN, JSONB, UUID) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_order_v2_app(TEXT, BOOLEAN, JSONB, UUID) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_order_v2_app(TEXT, BOOLEAN, JSONB, UUID) TO service_role;
