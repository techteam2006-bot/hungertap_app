-- Migration: 02_stock_after_payment.sql
-- Students: soft-check stock at create (no deduct). Deduct on payment success.
-- Restore stock only preparing -> cancelled_by_vendor.
-- Hardened void_failed_checkout_order (service_role, no manual stock restore).

-- 1. insert_order_and_items_v2: admin reserves; students soft-check only
CREATE OR REPLACE FUNCTION public.insert_order_and_items_v2(
  p_order_id uuid,
  p_canteen_id uuid,
  p_placed_by uuid,
  p_placed_by_role text,
  p_order_token text,
  p_barcode text,
  p_is_takeaway boolean,
  p_total_amount numeric,
  p_items jsonb,
  p_takeaway_charge numeric,
  OUT p_order_status text
) RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  c_beverage_category_id CONSTANT UUID := '728f2bff-1065-400e-9885-bcc9a8d1e491'::UUID;
  v_reserved_item_count  INT;
  v_expected_item_count  INT;
  v_ok_item_count        INT;
  v_failed_items         TEXT;
  v_auto_ready           BOOLEAN := false;
BEGIN
  SELECT COALESCE(auto_ready, false) INTO v_auto_ready
  FROM public.canteens WHERE id = p_canteen_id;

  IF p_placed_by_role = 'canteen_admin' THEN
    p_order_status := 'preparing';
  ELSE
    p_order_status := 'pending_payment';
  END IF;

  INSERT INTO public.orders (
    id, canteen_id, placed_by, placed_by_role,
    order_token, barcode, status, is_takeaway,
    total_amount, token_date, created_at
  )
  VALUES (
    p_order_id, p_canteen_id, p_placed_by, p_placed_by_role,
    p_order_token, p_barcode, p_order_status,
    coalesce(p_is_takeaway, false), p_total_amount,
    (NOW() AT TIME ZONE 'Asia/Kolkata')::date, NOW()
  );

  SELECT count(DISTINCT coalesce((item->>'item_id')::uuid, (item->>'itemId')::uuid))::int
  INTO v_expected_item_count
  FROM jsonb_array_elements(p_items) AS item;

  IF p_placed_by_role = 'canteen_admin' THEN
    WITH cart AS (
      SELECT
        coalesce((item->>'item_id')::uuid, (item->>'itemId')::uuid) AS item_id,
        SUM(GREATEST(1, (item->>'quantity')::int))::int AS quantity
      FROM jsonb_array_elements(p_items) AS item
      GROUP BY coalesce((item->>'item_id')::uuid, (item->>'itemId')::uuid)
    ),
    reserved AS (
      UPDATE public.items
      SET available_stock = available_stock - cart.quantity
      FROM cart
      WHERE public.items.id = cart.item_id
        AND public.items.canteen_id = p_canteen_id
        AND coalesce(public.items.is_available, false) = true
        AND public.items.available_stock >= cart.quantity
      RETURNING public.items.id
    )
    SELECT count(*)::int INTO v_reserved_item_count FROM reserved;

    IF v_reserved_item_count <> v_expected_item_count THEN
      SELECT string_agg(i.name, ', ')
      INTO v_failed_items
      FROM (
        SELECT coalesce((item->>'item_id')::uuid, (item->>'itemId')::uuid) AS item_id,
               SUM(GREATEST(1, (item->>'quantity')::int))::int AS quantity
        FROM jsonb_array_elements(p_items) AS item
        GROUP BY coalesce((item->>'item_id')::uuid, (item->>'itemId')::uuid)
      ) c
      INNER JOIN public.items i ON i.id = c.item_id AND i.canteen_id = p_canteen_id
      WHERE coalesce(i.available_stock, 0) < c.quantity
         OR coalesce(i.is_available, false) = false;

      RAISE EXCEPTION 'Insufficient stock or unavailable items: %. Please refresh and try again.', coalesce(v_failed_items, 'some items');
    END IF;
  ELSE
    -- Students: soft-check only (no stock deduction until payment success)
    WITH cart AS (
      SELECT
        coalesce((item->>'item_id')::uuid, (item->>'itemId')::uuid) AS item_id,
        SUM(GREATEST(1, (item->>'quantity')::int))::int AS quantity
      FROM jsonb_array_elements(p_items) AS item
      GROUP BY coalesce((item->>'item_id')::uuid, (item->>'itemId')::uuid)
    )
    SELECT count(*)::int INTO v_ok_item_count
    FROM cart
    INNER JOIN public.items i
      ON i.id = cart.item_id
     AND i.canteen_id = p_canteen_id
     AND coalesce(i.is_available, false) = true
     AND i.available_stock >= cart.quantity;

    IF v_ok_item_count <> v_expected_item_count THEN
      SELECT string_agg(i.name, ', ')
      INTO v_failed_items
      FROM (
        SELECT coalesce((item->>'item_id')::uuid, (item->>'itemId')::uuid) AS item_id,
               SUM(GREATEST(1, (item->>'quantity')::int))::int AS quantity
        FROM jsonb_array_elements(p_items) AS item
        GROUP BY coalesce((item->>'item_id')::uuid, (item->>'itemId')::uuid)
      ) c
      INNER JOIN public.items i ON i.id = c.item_id AND i.canteen_id = p_canteen_id
      WHERE coalesce(i.available_stock, 0) < c.quantity
         OR coalesce(i.is_available, false) = false;

      RAISE EXCEPTION 'Insufficient stock or unavailable items: %. Please refresh and try again.', coalesce(v_failed_items, 'some items');
    END IF;
  END IF;

  INSERT INTO public.order_items (
    order_id, item_id, item_name, quantity, ready_count, status,
    unit_price, line_total
  )
  SELECT
    p_order_id,
    i.id,
    i.name,
    x.quantity,
    CASE
      WHEN p_placed_by_role = 'canteen_admin' AND (i.auto_ready OR v_auto_ready) THEN x.quantity
      ELSE 0
    END,
    CASE
      WHEN p_placed_by_role = 'canteen_admin' AND (i.auto_ready OR v_auto_ready) THEN 'ready'
      ELSE p_order_status
    END,
    i.price,
    round(
      (
        x.quantity * i.price
        + CASE
            WHEN coalesce(p_is_takeaway, false)
                 AND i.category_id <> c_beverage_category_id
            THEN x.quantity * coalesce(p_takeaway_charge, 10.00)
            ELSE 0
          END
      )::numeric, 2
    )
  FROM (
    SELECT
      coalesce((item->>'item_id')::uuid, (item->>'itemId')::uuid) AS item_id,
      SUM(GREATEST(1, (item->>'quantity')::int))::int AS quantity
    FROM jsonb_array_elements(p_items) AS item
    GROUP BY coalesce((item->>'item_id')::uuid, (item->>'itemId')::uuid)
  ) x
  INNER JOIN public.items i
     ON i.id = x.item_id
    AND i.canteen_id = p_canteen_id
    AND coalesce(i.is_available, false) = true;

  IF p_placed_by_role = 'canteen_admin' THEN
    SELECT
      CASE
        WHEN count(*) = count(*) FILTER (WHERE status = 'ready') THEN 'ready'
        WHEN count(*) FILTER (WHERE status = 'ready') > 0 THEN 'partially_ready'
        ELSE 'preparing'
      END
    INTO p_order_status
    FROM public.order_items
    WHERE order_id = p_order_id;

    UPDATE public.orders SET status = p_order_status WHERE id = p_order_id;
  END IF;

END;
$$;

-- 2. restore_stock_on_cancel: only preparing -> cancelled_by_vendor
CREATE OR REPLACE FUNCTION public.restore_stock_on_cancel() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_qty integer;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  -- Stock is reserved for admin at create (preparing) and for students only after payment success.
  -- Do NOT restore on pending_payment -> payment_failed (never deducted for students).
  IF COALESCE(OLD.status, '') = 'preparing'
     AND COALESCE(NEW.status, '') = 'cancelled_by_vendor'
     AND OLD.status IS DISTINCT FROM NEW.status
  THEN
    v_qty := COALESCE(OLD.quantity, 1);

    UPDATE public.items
    SET available_stock = available_stock + v_qty
    WHERE id = OLD.item_id;
  END IF;

  RETURN NEW;
END;
$$;

-- 3. Trigger WHEN: preparing -> cancelled_by_vendor only
DROP TRIGGER IF EXISTS trg_restore_stock_on_cancel ON public.order_items;
CREATE TRIGGER trg_restore_stock_on_cancel
  AFTER UPDATE OF status ON public.order_items
  FOR EACH ROW
  WHEN (
    (OLD.status IS DISTINCT FROM NEW.status)
    AND OLD.status = 'preparing'
    AND NEW.status = 'cancelled_by_vendor'
  )
  EXECUTE FUNCTION public.restore_stock_on_cancel();

-- 4. void_failed_checkout_order (hardened: service_role only, no manual stock restore)
CREATE OR REPLACE FUNCTION public.void_failed_checkout_order(
  p_order_id UUID,
  p_payment_id UUID DEFAULT NULL,
  p_reason TEXT DEFAULT 'Provider checkout initialization failed'::TEXT
) RETURNS JSONB
LANGUAGE plpgsql SECURITY DEFINER
SET search_path TO 'public', 'extensions', 'pg_temp'
AS $$
DECLARE
  v_order         public.orders%ROWTYPE;
  v_payment       public.payments%ROWTYPE;
  v_has_success   BOOLEAN := false;
  v_now           timestamptz := NOW();
BEGIN
  IF auth.role() IS DISTINCT FROM 'service_role' THEN
    RETURN jsonb_build_object('success', false, 'error', 'forbidden');
  END IF;

  IF p_order_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_id_required');
  END IF;

  -- 1. Lock ORDER row
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_found');
  END IF;

  -- 2. Check if order is already paid/active
  IF v_order.status IN ('preparing', 'partially_ready', 'ready', 'delivered') THEN
    RETURN jsonb_build_object('success', true, 'action', 'no_op', 'reason', 'order_already_active', 'order_status', v_order.status);
  END IF;

  -- 3. Check if ANY payment for this order already succeeded
  SELECT EXISTS (
    SELECT 1 FROM public.payments
    WHERE order_id = p_order_id AND status = 'success'
  ) INTO v_has_success;

  IF v_has_success THEN
    RETURN jsonb_build_object('success', true, 'action', 'no_op', 'reason', 'order_has_successful_payment');
  END IF;

  -- 4. Lock specific payment if provided
  IF p_payment_id IS NOT NULL THEN
    SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
    IF FOUND AND v_payment.status NOT IN ('initiated') THEN
      RETURN jsonb_build_object('success', true, 'action', 'no_op', 'reason', 'payment_not_in_initiated_state', 'payment_status', v_payment.status);
    END IF;
  END IF;

  -- 5. Only void if order is still strictly in pending_payment
  IF v_order.status = 'pending_payment' THEN
    UPDATE public.orders
    SET status = 'payment_failed', updated_at = v_now
    WHERE id = p_order_id AND status = 'pending_payment';

    UPDATE public.order_items
    SET status = 'payment_failed', updated_at = v_now
    WHERE order_id = p_order_id AND status = 'pending_payment';

    IF p_payment_id IS NOT NULL THEN
      UPDATE public.payments
      SET status = 'failed', updated_at = v_now
      WHERE id = p_payment_id AND order_id = p_order_id AND status = 'initiated';
    ELSE
      UPDATE public.payments
      SET status = 'failed', updated_at = v_now
      WHERE order_id = p_order_id AND status = 'initiated';
    END IF;

    RETURN jsonb_build_object(
      'success', true,
      'action', 'voided_stock_via_trigger',
      'order_id', p_order_id,
      'reason', p_reason
    );
  END IF;

  RETURN jsonb_build_object('success', true, 'action', 'no_op', 'current_status', v_order.status);
END;
$$;

ALTER FUNCTION public.void_failed_checkout_order(UUID, UUID, TEXT) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.void_failed_checkout_order(UUID, UUID, TEXT) FROM PUBLIC;
GRANT ALL ON FUNCTION public.void_failed_checkout_order(UUID, UUID, TEXT) TO service_role;

-- 5. apply_payment_success: PATH 2 deducts stock before kitchen promote
CREATE OR REPLACE FUNCTION public.apply_payment_success(
  p_payment_id uuid,
  p_order_id uuid,
  p_gateway_payment_id text,
  p_gateway_response jsonb,
  p_gateway_name text,
  p_verify_amount numeric,
  p_verify_currency text DEFAULT 'INR'::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_payment                public.payments%ROWTYPE;
  v_order                  public.orders%ROWTYPE;
  v_now                    timestamptz   := NOW();
  v_line                   record;
  v_stock                  integer;
  v_refund_id              uuid;
  v_provider_refund_id     text;
  v_email                  text;
  v_refund_amount          numeric(12,2);
  v_total_already_refunded numeric(12,2);
  v_remaining_refundable   numeric(12,2);
  v_existing_refund        uuid;
  v_auto_ready             boolean       := false;
  v_kitchen_status         text          := 'preparing';
  v_resolved_gateway       text;
  v_incoming_gateway       text;
BEGIN
  IF p_gateway_name IS NULL OR length(trim(p_gateway_name)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_incoming_gateway_name');
  END IF;
  v_incoming_gateway := lower(trim(p_gateway_name));

  -- MANDATORY AMOUNT CHECK
  IF p_verify_amount IS NULL OR p_verify_amount <= 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_or_invalid_verify_amount');
  END IF;

  -- 1. LOCK ORDERS ROW FIRST (Canonical Lock Hierarchy)
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_not_found');
  END IF;

  -- 2. LOCK PAYMENTS ROW SECOND
  SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'payment_not_found');
  END IF;
  IF v_payment.order_id IS DISTINCT FROM p_order_id THEN
    RETURN jsonb_build_object('success', false, 'error', 'order_mismatch');
  END IF;
  IF v_payment.gateway_name IS NULL OR length(trim(v_payment.gateway_name)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'db_payment_gateway_missing');
  END IF;

  v_resolved_gateway := lower(trim(v_payment.gateway_name));
  IF v_resolved_gateway <> v_incoming_gateway THEN
    RETURN jsonb_build_object('success', false, 'error', 'gateway_mismatch',
      'db_gateway', v_resolved_gateway, 'incoming_gateway', v_incoming_gateway);
  END IF;

  -- 3. HARD DB-LEVEL MANDATORY AMOUNT AND CURRENCY BOUNDARY VERIFICATION
  IF p_verify_currency IS NOT NULL AND upper(trim(p_verify_currency)) <> 'INR' THEN
    RETURN jsonb_build_object('success', false, 'error', 'currency_mismatch',
      'expected', 'INR', 'received', p_verify_currency);
  END IF;

  IF ABS(p_verify_amount - v_payment.amount) > 0.01 THEN
    RETURN jsonb_build_object('success', false, 'error', 'db_amount_mismatch',
      'expected', v_payment.amount, 'received', p_verify_amount);
  END IF;

  SELECT COALESCE(SUM(amount), 0) INTO v_total_already_refunded
  FROM public.refunds
  WHERE payment_id = v_payment.id AND status IN ('success', 'scheduled', 'initiated', 'processing');
  v_remaining_refundable := GREATEST(0, v_payment.amount - v_total_already_refunded);

  SELECT COALESCE(c.auto_ready, false) INTO v_auto_ready
  FROM public.canteens c WHERE c.id = v_order.canteen_id;

  -- Refund flow protection
  IF v_payment.status IN ('refund_pending', 'refunded', 'refund_failed') THEN
    SELECT id INTO v_existing_refund FROM public.refunds
    WHERE payment_id = v_payment.id AND status IN ('scheduled', 'initiated', 'processing')
    ORDER BY created_at DESC LIMIT 1;
    RETURN jsonb_build_object('success', true, 'action', 'refund_required',
      'refund_id', v_existing_refund, 'payment_id', v_payment.id, 'reason', 'already_in_refund_flow');
  END IF;

  -- PATH 1: Order already active → IDEMPOTENT or duplicate payment
  IF v_order.status IN ('preparing', 'partially_ready', 'ready', 'delivered') THEN
    IF v_payment.status = 'success' THEN
      RETURN jsonb_build_object('success', true, 'action', 'idempotent');
    END IF;

    UPDATE public.payments SET status = 'refund_pending',
      gateway_name = v_resolved_gateway,
      gateway_payment_id = COALESCE(p_gateway_payment_id, gateway_payment_id),
      gateway_response = COALESCE(p_gateway_response, gateway_response), updated_at = v_now
    WHERE id = v_payment.id AND status NOT IN ('refunded', 'refund_pending');

    v_refund_amount := LEAST(v_payment.amount, v_remaining_refundable);
    IF v_refund_amount <= 0 THEN
      RETURN jsonb_build_object('success', true, 'action', 'idempotent', 'reason', 'already_fully_refunded');
    END IF;
    SELECT au.email INTO v_email FROM auth.users au WHERE au.id = v_order.placed_by;
    SELECT id INTO v_existing_refund FROM public.refunds
    WHERE payment_id = v_payment.id AND status IN ('scheduled', 'initiated', 'processing')
    ORDER BY created_at DESC LIMIT 1;

    IF v_existing_refund IS NULL THEN
      v_refund_id := gen_random_uuid();
      v_provider_refund_id := CASE WHEN v_resolved_gateway = 'cashfree' THEN 'htrfnd' || replace(v_refund_id::text, '-', '') ELSE NULL END;
      INSERT INTO public.refunds (id, order_id, payment_id, amount, status, reason, retry_count,
        customer_email, process_after, gateway_name, gateway_refund_id)
      VALUES (v_refund_id, v_order.id, v_payment.id, v_refund_amount, 'scheduled',
              'Duplicate payment on already paid order', 0, v_email,
              v_now + interval '3 minutes', v_resolved_gateway, v_provider_refund_id);
    ELSE
      v_refund_id := v_existing_refund;
      v_provider_refund_id := CASE WHEN v_resolved_gateway = 'cashfree' THEN 'htrfnd' || replace(v_refund_id::text, '-', '') ELSE NULL END;
      UPDATE public.refunds SET amount = v_refund_amount,
        customer_email = COALESCE(customer_email, v_email),
        gateway_name = v_resolved_gateway,
        gateway_refund_id = COALESCE(gateway_refund_id, v_provider_refund_id)
      WHERE id = v_refund_id;
    END IF;
    RETURN jsonb_build_object('success', true, 'action', 'refund_required',
      'refund_id', v_refund_id, 'amount', v_refund_amount,
      'reason', 'duplicate_payment_on_already_paid_order');
  END IF;

  -- PATH 2: Normal new payment — deduct stock before promoting kitchen
  IF v_order.status = 'pending_payment' THEN
    UPDATE public.payments SET status = 'success',
      gateway_name = v_resolved_gateway,
      gateway_payment_id = COALESCE(p_gateway_payment_id, gateway_payment_id),
      gateway_response = COALESCE(p_gateway_response, gateway_response), updated_at = v_now
    WHERE id = v_payment.id;

    -- Soft hold ended: deduct stock now. If any line OOS → schedule refund, do not promote kitchen.
    FOR v_line IN
      SELECT oi.id AS oi_id, oi.item_id, oi.quantity, oi.status
      FROM public.order_items oi WHERE oi.order_id = v_order.id FOR UPDATE OF oi
    LOOP
      IF v_line.status = 'delivered' THEN CONTINUE; END IF;
      SELECT available_stock INTO v_stock FROM public.items WHERE id = v_line.item_id FOR UPDATE;

      IF v_stock IS NULL OR v_stock < v_line.quantity THEN
        UPDATE public.payments SET status = 'refund_pending',
          gateway_name = v_resolved_gateway,
          gateway_payment_id = COALESCE(p_gateway_payment_id, gateway_payment_id),
          gateway_response = COALESCE(p_gateway_response, gateway_response), updated_at = v_now
        WHERE id = v_payment.id;

        v_refund_amount := LEAST(v_payment.amount, v_remaining_refundable);
        IF v_refund_amount <= 0 THEN
          RETURN jsonb_build_object('success', true, 'action', 'idempotent', 'reason', 'already_fully_refunded');
        END IF;
        SELECT au.email INTO v_email FROM auth.users au WHERE au.id = v_order.placed_by;
        SELECT id INTO v_existing_refund FROM public.refunds
        WHERE payment_id = v_payment.id AND status IN ('scheduled', 'initiated', 'processing')
        ORDER BY created_at DESC LIMIT 1;

        IF v_existing_refund IS NULL THEN
          v_refund_id := gen_random_uuid();
          v_provider_refund_id := CASE WHEN v_resolved_gateway = 'cashfree' THEN 'htrfnd' || replace(v_refund_id::text, '-', '') ELSE NULL END;
          INSERT INTO public.refunds (id, order_id, payment_id, amount, status, reason, retry_count,
            customer_email, process_after, gateway_name, gateway_refund_id)
          VALUES (v_refund_id, v_order.id, v_payment.id, v_refund_amount, 'scheduled',
                  'Payment succeeded but insufficient stock', 0, v_email,
                  v_now + interval '3 minutes', v_resolved_gateway, v_provider_refund_id);
        ELSE
          v_refund_id := v_existing_refund;
          v_provider_refund_id := CASE WHEN v_resolved_gateway = 'cashfree' THEN 'htrfnd' || replace(v_refund_id::text, '-', '') ELSE NULL END;
          UPDATE public.refunds SET amount = v_refund_amount,
            customer_email = COALESCE(customer_email, v_email),
            gateway_name = v_resolved_gateway,
            gateway_refund_id = COALESCE(gateway_refund_id, v_provider_refund_id)
          WHERE id = v_refund_id;
        END IF;
        RETURN jsonb_build_object('success', true, 'action', 'refund_required',
          'refund_id', v_refund_id, 'amount', v_refund_amount, 'reason', 'insufficient_stock');
      END IF;
    END LOOP;

    FOR v_line IN
      SELECT oi.id AS oi_id, oi.item_id, oi.quantity
      FROM public.order_items oi WHERE oi.order_id = v_order.id AND oi.status <> 'delivered'
    LOOP
      UPDATE public.items SET available_stock = available_stock - v_line.quantity
      WHERE id = v_line.item_id AND available_stock >= v_line.quantity;
      IF NOT FOUND THEN RAISE EXCEPTION 'stock_race_on_revive'; END IF;
    END LOOP;

    UPDATE public.order_items oi
    SET status = CASE WHEN i.auto_ready OR v_auto_ready THEN 'ready' ELSE 'preparing' END,
        ready_count = CASE WHEN i.auto_ready OR v_auto_ready THEN oi.quantity ELSE 0 END,
        updated_at = v_now
    FROM public.items i WHERE oi.order_id = v_order.id AND oi.item_id = i.id
      AND oi.status IS DISTINCT FROM 'delivered';

    SELECT CASE WHEN count(*) = count(*) FILTER (WHERE status='ready') THEN 'ready'
                WHEN count(*) FILTER (WHERE status='ready') > 0 THEN 'partially_ready'
                ELSE 'preparing' END INTO v_kitchen_status
    FROM public.order_items WHERE order_id = v_order.id;

    UPDATE public.orders SET status = v_kitchen_status, updated_at = v_now
    WHERE id = v_order.id AND status = 'pending_payment';

    RETURN jsonb_build_object('success', true,
      'action', CASE WHEN v_kitchen_status = 'ready' THEN 'ready' ELSE 'prepared' END);
  END IF;

  -- PATH 3: Late payment on failed order — attempt stock revive
  IF v_order.status = 'payment_failed' THEN
    FOR v_line IN
      SELECT oi.id AS oi_id, oi.item_id, oi.quantity, oi.status
      FROM public.order_items oi WHERE oi.order_id = v_order.id FOR UPDATE OF oi
    LOOP
      IF v_line.status = 'delivered' THEN CONTINUE; END IF;
      SELECT available_stock INTO v_stock FROM public.items WHERE id = v_line.item_id FOR UPDATE;

      IF v_stock IS NULL OR v_stock < v_line.quantity THEN
        UPDATE public.payments SET status = 'refund_pending',
          gateway_name = v_resolved_gateway,
          gateway_payment_id = COALESCE(p_gateway_payment_id, gateway_payment_id),
          gateway_response = COALESCE(p_gateway_response, gateway_response), updated_at = v_now
        WHERE id = v_payment.id;

        v_refund_amount := LEAST(v_payment.amount, v_remaining_refundable);
        IF v_refund_amount <= 0 THEN
          RETURN jsonb_build_object('success', true, 'action', 'idempotent', 'reason', 'already_fully_refunded');
        END IF;
        SELECT au.email INTO v_email FROM auth.users au WHERE au.id = v_order.placed_by;
        SELECT id INTO v_existing_refund FROM public.refunds
        WHERE payment_id = v_payment.id AND status IN ('scheduled', 'initiated', 'processing')
        ORDER BY created_at DESC LIMIT 1;

        IF v_existing_refund IS NULL THEN
          v_refund_id := gen_random_uuid();
          v_provider_refund_id := CASE WHEN v_resolved_gateway = 'cashfree' THEN 'htrfnd' || replace(v_refund_id::text, '-', '') ELSE NULL END;
          INSERT INTO public.refunds (id, order_id, payment_id, amount, status, reason, retry_count,
            customer_email, process_after, gateway_name, gateway_refund_id)
          VALUES (v_refund_id, v_order.id, v_payment.id, v_refund_amount, 'scheduled',
                  'Late payment but insufficient stock', 0, v_email,
                  v_now + interval '3 minutes', v_resolved_gateway, v_provider_refund_id);
        ELSE
          v_refund_id := v_existing_refund;
          v_provider_refund_id := CASE WHEN v_resolved_gateway = 'cashfree' THEN 'htrfnd' || replace(v_refund_id::text, '-', '') ELSE NULL END;
          UPDATE public.refunds SET amount = v_refund_amount,
            customer_email = COALESCE(customer_email, v_email),
            gateway_name = v_resolved_gateway,
            gateway_refund_id = COALESCE(gateway_refund_id, v_provider_refund_id)
          WHERE id = v_refund_id;
        END IF;
        RETURN jsonb_build_object('success', true, 'action', 'refund_required',
          'refund_id', v_refund_id, 'amount', v_refund_amount, 'reason', 'insufficient_stock');
      END IF;
    END LOOP;

    FOR v_line IN
      SELECT oi.id AS oi_id, oi.item_id, oi.quantity
      FROM public.order_items oi WHERE oi.order_id = v_order.id AND oi.status <> 'delivered'
    LOOP
      UPDATE public.items SET available_stock = available_stock - v_line.quantity
      WHERE id = v_line.item_id AND available_stock >= v_line.quantity;
      IF NOT FOUND THEN RAISE EXCEPTION 'stock_race_on_revive'; END IF;

      UPDATE public.order_items oi
      SET status = CASE WHEN i.auto_ready OR v_auto_ready THEN 'ready' ELSE 'preparing' END,
          ready_count = CASE WHEN i.auto_ready OR v_auto_ready THEN v_line.quantity ELSE 0 END,
          updated_at = v_now
      FROM public.items i WHERE oi.id = v_line.oi_id AND oi.item_id = i.id;
    END LOOP;

    SELECT CASE WHEN count(*) = count(*) FILTER (WHERE status='ready') THEN 'ready'
                WHEN count(*) FILTER (WHERE status='ready') > 0 THEN 'partially_ready'
                ELSE 'preparing' END INTO v_kitchen_status
    FROM public.order_items WHERE order_id = v_order.id;

    UPDATE public.payments SET status = 'success',
      gateway_name = v_resolved_gateway,
      gateway_payment_id = COALESCE(p_gateway_payment_id, gateway_payment_id),
      gateway_response = COALESCE(p_gateway_response, gateway_response), updated_at = v_now
    WHERE id = v_payment.id;
    UPDATE public.orders SET status = v_kitchen_status, updated_at = v_now WHERE id = v_order.id;

    RETURN jsonb_build_object('success', true,
      'action', CASE WHEN v_kitchen_status = 'ready' THEN 'revived_ready' ELSE 'revived' END);
  END IF;

  -- PATH 4: Late payment after vendor cancel → immediate refund
  IF v_order.status = 'cancelled_by_vendor' THEN
    UPDATE public.payments SET status = 'refund_pending',
      gateway_name = v_resolved_gateway,
      gateway_payment_id = COALESCE(p_gateway_payment_id, gateway_payment_id),
      gateway_response = COALESCE(p_gateway_response, gateway_response), updated_at = v_now
    WHERE id = v_payment.id AND status NOT IN ('refunded', 'refund_pending');

    SELECT COALESCE(SUM(oi.line_total), 0) INTO v_refund_amount
    FROM public.order_items oi WHERE oi.order_id = v_order.id AND oi.status <> 'delivered';
    IF v_refund_amount <= 0 THEN v_refund_amount := v_payment.amount; END IF;
    v_refund_amount := LEAST(v_refund_amount, v_remaining_refundable);

    IF v_refund_amount <= 0 THEN
      RETURN jsonb_build_object('success', true, 'action', 'idempotent', 'reason', 'already_fully_refunded');
    END IF;

    SELECT au.email INTO v_email FROM auth.users au WHERE au.id = v_order.placed_by;
    SELECT id INTO v_existing_refund FROM public.refunds
    WHERE payment_id = v_payment.id AND status IN ('scheduled', 'initiated', 'processing')
    ORDER BY created_at DESC LIMIT 1;

    IF v_existing_refund IS NULL THEN
      v_refund_id := gen_random_uuid();
      v_provider_refund_id := CASE WHEN v_resolved_gateway = 'cashfree' THEN 'htrfnd' || replace(v_refund_id::text, '-', '') ELSE NULL END;
      INSERT INTO public.refunds (id, order_id, payment_id, amount, status, reason, retry_count,
        customer_email, process_after, gateway_name, gateway_refund_id)
      VALUES (v_refund_id, v_order.id, v_payment.id, v_refund_amount, 'scheduled',
              'Payment captured after vendor cancel', 0, v_email,
              v_now + interval '3 minutes', v_resolved_gateway, v_provider_refund_id);
    ELSE
      v_refund_id := v_existing_refund;
      v_provider_refund_id := CASE WHEN v_resolved_gateway = 'cashfree' THEN 'htrfnd' || replace(v_refund_id::text, '-', '') ELSE NULL END;
      UPDATE public.refunds SET amount = v_refund_amount,
        customer_email = COALESCE(customer_email, v_email),
        gateway_name = v_resolved_gateway,
        gateway_refund_id = COALESCE(gateway_refund_id, v_provider_refund_id)
      WHERE id = v_refund_id;
    END IF;
    RETURN jsonb_build_object('success', true, 'action', 'refund_required',
      'refund_id', v_refund_id, 'amount', v_refund_amount);
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'unsupported_order_status',
                            'order_status', v_order.status);
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM = 'stock_race_on_revive' THEN
    RETURN jsonb_build_object('success', false, 'error', 'stock_race', 'retry', true);
  END IF;
  RAISE;
END;
$$;
