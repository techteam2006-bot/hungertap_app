


SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;


CREATE EXTENSION IF NOT EXISTS "pg_cron" WITH SCHEMA "pg_catalog";






CREATE EXTENSION IF NOT EXISTS "pg_net" WITH SCHEMA "extensions";






CREATE SCHEMA IF NOT EXISTS "private";


ALTER SCHEMA "private" OWNER TO "postgres";


COMMENT ON SCHEMA "public" IS 'standard public schema';



CREATE EXTENSION IF NOT EXISTS "hypopg" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "index_advisor" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pg_stat_statements" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "pgcrypto" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "supabase_vault" WITH SCHEMA "vault";






CREATE EXTENSION IF NOT EXISTS "uuid-ossp" WITH SCHEMA "extensions";






CREATE EXTENSION IF NOT EXISTS "wrappers" WITH SCHEMA "extensions";






CREATE OR REPLACE FUNCTION "public"."allocate_ready_count_fifo"("p_item_id" "text", "p_ready_count_to_allocate" integer) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_admin_user_id uuid;
  v_admin_canteen_id uuid;
  v_admin_role text;
  v_item_id_uuid uuid;
  v_remaining_to_allocate integer;
  v_total_updated integer := 0;
  v_order_item_record record;
  v_current_ready integer;
  v_quantity integer;
  v_remaining integer;
  v_to_allocate integer;
  v_new_ready_count integer;
  v_updated_ids uuid[] := ARRAY[]::uuid[];
  v_allocations jsonb := '[]'::jsonb;
  v_token text;
BEGIN
  v_admin_user_id := auth.uid();

  IF v_admin_user_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authenticated');
  END IF;

  SELECT role, canteen_id
  INTO v_admin_role, v_admin_canteen_id
  FROM public.users
  WHERE id = v_admin_user_id;

  IF v_admin_role IS DISTINCT FROM 'canteen_admin' THEN
    RETURN jsonb_build_object('success', false, 'error', 'Not authorized');
  END IF;

  IF v_admin_canteen_id IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'Admin has no canteen assigned');
  END IF;

  BEGIN
    v_item_id_uuid := p_item_id::uuid;
  EXCEPTION
    WHEN invalid_text_representation THEN
      SELECT id
      INTO v_item_id_uuid
      FROM public.items
      WHERE id::text = p_item_id
      LIMIT 1;

      IF v_item_id_uuid IS NULL THEN
        RETURN jsonb_build_object(
          'success', false,
          'error', format(
            'Invalid item_id: %s (must be a valid UUID or item identifier)',
            p_item_id
          )
        );
      END IF;
  END;

  IF NOT EXISTS (
    SELECT 1 FROM public.items i
    WHERE i.id = v_item_id_uuid AND i.canteen_id = v_admin_canteen_id
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'Item not in admin canteen');
  END IF;

  IF p_ready_count_to_allocate <= 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'ready_count_to_allocate must be greater than 0'
    );
  END IF;

  v_remaining_to_allocate := p_ready_count_to_allocate;

  FOR v_order_item_record IN
    SELECT
      oi.id,
      oi.ready_count,
      oi.quantity,
      oi.status,
      o.order_token,
      o.is_takeaway
    FROM public.order_items oi
    INNER JOIN public.orders o
      ON oi.order_id = o.id
    WHERE oi.item_id = v_item_id_uuid
      AND o.canteen_id = v_admin_canteen_id
      AND o.status IN ('preparing', 'partially_ready')
      AND oi.status NOT IN ('ready', 'delivered')
      AND COALESCE(oi.ready_count, 0) < oi.quantity
    ORDER BY oi.created_at ASC
    FOR UPDATE OF oi SKIP LOCKED
  LOOP
    EXIT WHEN v_remaining_to_allocate <= 0;

    v_current_ready := COALESCE(v_order_item_record.ready_count, 0);
    v_quantity := v_order_item_record.quantity;
    v_remaining := v_quantity - v_current_ready;

    IF v_remaining <= 0 THEN
      CONTINUE;
    END IF;

    v_to_allocate := LEAST(v_remaining, v_remaining_to_allocate);
    v_new_ready_count := v_current_ready + v_to_allocate;

    IF v_new_ready_count > v_quantity THEN
      v_new_ready_count := v_quantity;
    END IF;

    UPDATE public.order_items
    SET
      ready_count = v_new_ready_count,
      status = CASE
                 WHEN v_new_ready_count >= quantity THEN 'ready'
                 ELSE 'preparing'
               END
    WHERE id = v_order_item_record.id;

    v_token := NULLIF(BTRIM(COALESCE(v_order_item_record.order_token::text, '')), '');

    v_allocations := v_allocations || jsonb_build_array(
      jsonb_build_object(
        'order_item_id', v_order_item_record.id,
        'order_token', COALESCE(v_token, '—'),
        'allocated', v_to_allocate,
        'is_takeaway', COALESCE(v_order_item_record.is_takeaway, false)
      )
    );

    v_total_updated := v_total_updated + v_to_allocate;
    v_remaining_to_allocate := v_remaining_to_allocate - v_to_allocate;
    v_updated_ids := array_append(v_updated_ids, v_order_item_record.id);
  END LOOP;

  RETURN jsonb_build_object(
    'success', true,
    'requested', p_ready_count_to_allocate,
    'total_updated', v_total_updated,
    'remaining', v_remaining_to_allocate,
    'updated_ids', v_updated_ids,
    'allocations', v_allocations
  );

EXCEPTION
  WHEN OTHERS THEN
    RETURN jsonb_build_object('success', false, 'error', SQLERRM);
END;
$$;


ALTER FUNCTION "public"."allocate_ready_count_fifo"("p_item_id" "text", "p_ready_count_to_allocate" integer) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."allocate_ready_count_fifo"("p_item_id" "text", "p_ready_count_to_allocate" integer) IS 'Securely allocates ready_count across order_items in FIFO order. Filters by admin canteen_id, clusters by item_id, sorts by created_at. Returns JSON with success status and update details.';



CREATE OR REPLACE FUNCTION "public"."apply_payment_success"("p_payment_id" "uuid", "p_order_id" "uuid", "p_gateway_payment_id" "text", "p_gateway_response" "jsonb", "p_gateway_name" "text", "p_verify_amount" numeric, "p_verify_currency" "text" DEFAULT 'INR'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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
  v_placed_by              uuid;
BEGIN

  IF coalesce(
    current_setting('request.jwt.claim.role', true),
    (nullif(trim(current_setting('request.jwt.claims', true)), '')::jsonb->>'role')
  ) IS DISTINCT FROM 'service_role'
  AND current_user NOT IN ('postgres', 'supabase_admin')
  THEN
    RETURN jsonb_build_object('success', false, 'error', 'service_role_only');
  END IF;
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
    -- PATH 0: Late gateway SUCCESS after canteen close (live order archived/deleted).
    -- Auto-refund only — never revive kitchen.
    SELECT * INTO v_payment FROM public.payments WHERE id = p_payment_id FOR UPDATE;
    IF NOT FOUND THEN
      RETURN jsonb_build_object('success', false, 'error', 'payment_not_found');
    END IF;
    IF v_payment.order_id IS DISTINCT FROM p_order_id THEN
      RETURN jsonb_build_object('success', false, 'error', 'order_mismatch');
    END IF;
    IF p_gateway_name IS NULL OR length(trim(p_gateway_name)) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'missing_incoming_gateway_name');
    END IF;
    v_incoming_gateway := lower(trim(p_gateway_name));
    IF v_payment.gateway_name IS NULL OR length(trim(v_payment.gateway_name)) = 0 THEN
      RETURN jsonb_build_object('success', false, 'error', 'db_payment_gateway_missing');
    END IF;
    v_resolved_gateway := lower(trim(v_payment.gateway_name));
    IF v_resolved_gateway <> v_incoming_gateway THEN
      RETURN jsonb_build_object('success', false, 'error', 'gateway_mismatch',
        'db_gateway', v_resolved_gateway, 'incoming_gateway', v_incoming_gateway);
    END IF;
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
    WHERE payment_id = v_payment.id
      AND status IN ('success', 'scheduled', 'initiated', 'processing');
    v_remaining_refundable := GREATEST(0, v_payment.amount - v_total_already_refunded);

    IF v_payment.status = 'refunded' THEN
      RETURN jsonb_build_object('success', true, 'action', 'idempotent', 'reason', 'already_refunded');
    END IF;

    SELECT id INTO v_existing_refund FROM public.refunds
    WHERE payment_id = v_payment.id
      AND status IN ('scheduled', 'initiated', 'processing')
    ORDER BY created_at DESC
    LIMIT 1;

    IF v_existing_refund IS NOT NULL THEN
      UPDATE public.payments SET
        gateway_name = v_resolved_gateway,
        gateway_payment_id = COALESCE(p_gateway_payment_id, gateway_payment_id),
        gateway_response = COALESCE(p_gateway_response, gateway_response),
        updated_at = v_now
      WHERE id = v_payment.id;
      RETURN jsonb_build_object(
        'success', true, 'action', 'refund_required',
        'refund_id', v_existing_refund, 'payment_id', v_payment.id,
        'reason', 'late_payment_after_canteen_close'
      );
    END IF;

    SELECT ao.placed_by INTO v_placed_by
    FROM public.archived_orders ao
    WHERE ao.id = p_order_id;

    IF v_placed_by IS NULL THEN
      SELECT fo.placed_by INTO v_placed_by
      FROM public.failed_orders fo
      WHERE fo.id = p_order_id;
    END IF;

    IF v_placed_by IS NOT NULL THEN
      SELECT au.email INTO v_email FROM auth.users au WHERE au.id = v_placed_by;
    END IF;

    UPDATE public.payments SET
      status = 'refund_pending',
      gateway_name = v_resolved_gateway,
      gateway_payment_id = COALESCE(p_gateway_payment_id, gateway_payment_id),
      gateway_response = COALESCE(p_gateway_response, gateway_response),
      updated_at = v_now
    WHERE id = v_payment.id
      AND status NOT IN ('refunded', 'refund_pending');

    UPDATE public.payments SET
      gateway_name = v_resolved_gateway,
      gateway_payment_id = COALESCE(p_gateway_payment_id, gateway_payment_id),
      gateway_response = COALESCE(p_gateway_response, gateway_response),
      updated_at = v_now
    WHERE id = v_payment.id
      AND status = 'refund_pending';

    v_refund_amount := LEAST(v_payment.amount, v_remaining_refundable);
    IF v_refund_amount <= 0 THEN
      RETURN jsonb_build_object('success', true, 'action', 'idempotent', 'reason', 'already_fully_refunded');
    END IF;

    v_refund_id := gen_random_uuid();
    v_provider_refund_id := CASE
      WHEN v_resolved_gateway = 'cashfree' THEN 'htrfnd' || replace(v_refund_id::text, '-', '')
      ELSE NULL
    END;

    INSERT INTO public.refunds (
      id, order_id, payment_id, amount, status, reason, retry_count,
      customer_email, process_after, gateway_name, gateway_refund_id
    ) VALUES (
      v_refund_id, p_order_id, v_payment.id, v_refund_amount, 'scheduled',
      'Late payment after canteen close', 0, v_email,
      v_now + interval '3 minutes', v_resolved_gateway, v_provider_refund_id
    );

    RETURN jsonb_build_object(
      'success', true, 'action', 'refund_required',
      'refund_id', v_refund_id, 'amount', v_refund_amount,
      'payment_id', v_payment.id, 'order_id', p_order_id,
      'reason', 'late_payment_after_canteen_close'
    );
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

    v_kitchen_status := public.compute_order_status_from_items(v_order.id);

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

    v_kitchen_status := public.compute_order_status_from_items(v_order.id);

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


ALTER FUNCTION "public"."apply_payment_success"("p_payment_id" "uuid", "p_order_id" "uuid", "p_gateway_payment_id" "text", "p_gateway_response" "jsonb", "p_gateway_name" "text", "p_verify_amount" numeric, "p_verify_currency" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."apply_payment_success"("p_payment_id" "uuid", "p_order_id" "uuid", "p_gateway_payment_id" "text", "p_gateway_response" "jsonb", "p_gateway_name" "text", "p_verify_amount" numeric, "p_verify_currency" "text") IS 'Gateway payment success handler. PATH 0: if live order missing after close, schedules auto-refund (no kitchen revive).';



CREATE OR REPLACE FUNCTION "public"."apply_refund_success"("p_gateway_name" "text", "p_gateway_refund_id" "text", "p_gateway_response" "jsonb" DEFAULT NULL::"jsonb", "p_verify_amount" numeric DEFAULT NULL::numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_refund         record;
  v_payment        record;
  v_order          record;
  v_total_refunded numeric(12,2);
  v_new_status     text;
  v_now            timestamptz := now();
  v_gateway        text;
BEGIN
  IF p_gateway_name IS NULL OR length(trim(p_gateway_name)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_gateway_name');
  END IF;
  v_gateway := lower(trim(p_gateway_name));

  SELECT r.* INTO v_refund
  FROM public.refunds r
  WHERE r.gateway_refund_id = p_gateway_refund_id
    AND lower(r.gateway_name) = v_gateway
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'refund_not_found',
      'gateway', v_gateway, 'refund_id', p_gateway_refund_id
    );
  END IF;

  IF v_refund.status = 'success' THEN
    RETURN jsonb_build_object('success', true, 'action', 'idempotent_already_success',
                              'refund_id', v_refund.id);
  END IF;

  IF v_refund.status IN ('failed', 'cancelled') THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'refund_in_terminal_state',
      'status', v_refund.status, 'refund_id', v_refund.id
    );
  END IF;

  IF p_verify_amount IS NOT NULL AND p_verify_amount > 0 THEN
    IF ABS(p_verify_amount - v_refund.amount) > 0.01 THEN
      RETURN jsonb_build_object(
        'success', false, 'error', 'refund_amount_mismatch',
        'expected', v_refund.amount, 'received', p_verify_amount
      );
    END IF;
  END IF;

  -- 1. LOCK ORDERS ROW FIRST IF ORDER_ID IS LINKED
  IF v_refund.order_id IS NOT NULL THEN
    SELECT * INTO v_order FROM public.orders WHERE id = v_refund.order_id FOR UPDATE;
  END IF;

  -- 2. LOCK PAYMENTS ROW SECOND
  SELECT * INTO v_payment FROM public.payments WHERE id = v_refund.payment_id FOR UPDATE;

  UPDATE public.refunds
  SET status           = 'success',
      gateway_name     = v_gateway,
      refunded_at      = v_now,
      gateway_response = COALESCE(p_gateway_response, gateway_response)
  WHERE id = v_refund.id;

  IF v_payment.id IS NOT NULL THEN
    SELECT COALESCE(SUM(amount), 0) INTO v_total_refunded
    FROM public.refunds WHERE payment_id = v_payment.id AND status = 'success';

    v_new_status := CASE
      WHEN v_total_refunded >= v_payment.amount THEN 'refunded'
      WHEN v_total_refunded > 0                THEN 'partially_refunded'
      ELSE v_payment.status
    END;

    UPDATE public.payments SET status = v_new_status, updated_at = v_now WHERE id = v_payment.id;
  END IF;

  RETURN jsonb_build_object(
    'success', true, 'refund_id', v_refund.id,
    'payment_status', v_new_status, 'total_refunded', v_total_refunded
  );
END;
$$;


ALTER FUNCTION "public"."apply_refund_success"("p_gateway_name" "text", "p_gateway_refund_id" "text", "p_gateway_response" "jsonb", "p_verify_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."calculate_cart_totals_v2"("p_canteen_id" "uuid", "p_items" "jsonb", "p_is_takeaway" boolean DEFAULT false, "p_takeaway_charge" numeric DEFAULT 10.00) RETURNS TABLE("valid_count" integer, "total_quantity" integer, "total_amount" numeric)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  c_max_quantity_per_line CONSTANT INT := 15;
  c_max_lines             CONSTANT INT := 15;
  c_beverage_category_id  CONSTANT UUID := '728f2bff-1065-400e-9885-bcc9a8d1e491'::UUID;
BEGIN
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE LOG '[ORDER_V2] EMPTY_CART: canteen_id=%', p_canteen_id;
    RAISE EXCEPTION 'At least one item required';
  END IF;

  IF jsonb_array_length(p_items) > c_max_lines THEN
    RAISE LOG '[ORDER_V2] TOO_MANY_ITEMS: canteen_id=%, count=%', p_canteen_id, jsonb_array_length(p_items);
    RAISE EXCEPTION 'Maximum % items allowed per order', c_max_lines;
  END IF;

  RETURN QUERY
  WITH input_items AS (
    SELECT
      coalesce((item->>'item_id')::uuid, (item->>'itemId')::uuid) AS item_id,
      SUM(GREATEST(1, (item->>'quantity')::int))::int AS quantity
    FROM jsonb_array_elements(p_items) AS item
    GROUP BY coalesce((item->>'item_id')::uuid, (item->>'itemId')::uuid)
  ),
  valid_items AS (
    SELECT
      ii.item_id,
      i.name AS item_name,
      ii.quantity,
      i.price,
      i.category_id
    FROM input_items ii
    INNER JOIN public.items i
       ON i.id = ii.item_id
      AND i.canteen_id = p_canteen_id
    WHERE ii.quantity >= 1
      AND ii.quantity <= c_max_quantity_per_line
      AND i.is_active = true
      AND coalesce(i.is_available, false) = true
      AND coalesce(i.available_stock, 0) > 0
      AND ii.quantity <= coalesce(i.available_stock, 0)
      AND coalesce(i.price, 0) > 0
  )
  SELECT
    count(*)::int AS valid_count,
    coalesce(sum(vi.quantity), 0)::int AS total_quantity,
    round(
      (
        sum(vi.quantity * vi.price)
        +
        CASE
          WHEN coalesce(p_is_takeaway, false) THEN
            sum(
              CASE
                WHEN vi.category_id <> c_beverage_category_id
                THEN vi.quantity * coalesce(p_takeaway_charge, 10.00)
                ELSE 0
              END
            )
          ELSE 0
        END
      )::numeric,
      2
    ) AS total_amount
  FROM valid_items vi;
END;
$$;


ALTER FUNCTION "public"."calculate_cart_totals_v2"("p_canteen_id" "uuid", "p_items" "jsonb", "p_is_takeaway" boolean, "p_takeaway_charge" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_order_by_admin"("p_order_id" "uuid", "p_reason" "text" DEFAULT 'Vendor cancelled order'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_refund_id uuid;
  v_email text;
  v_refund_amount numeric(12,2);
  v_delivered_count int;
  v_cancellable_count int;
  v_now timestamptz := NOW();
  v_jwt_role text;
  v_user_role text;
  v_my_canteen uuid;
  v_gateway text;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_id_required');
  END IF;

  BEGIN
    v_jwt_role := coalesce(
      current_setting('request.jwt.claim.role', true),
      (current_setting('request.jwt.claims', true)::jsonb->>'role')
    );
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role IS DISTINCT FROM 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin')
  THEN
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
    END IF;
    SELECT role, canteen_id INTO v_user_role, v_my_canteen FROM public.users WHERE id = auth.uid();
    IF v_user_role IS DISTINCT FROM 'canteen_admin' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_canteen_admin');
    END IF;
  ELSE
    v_my_canteen := NULL;
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;
  IF v_my_canteen IS NOT NULL AND v_order.canteen_id IS DISTINCT FROM v_my_canteen THEN
    RETURN jsonb_build_object('ok', false, 'error', 'wrong_canteen');
  END IF;
  IF v_order.status = 'delivered' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'cannot_cancel_delivered');
  END IF;
  IF v_order.status = 'cancelled_by_vendor' THEN
    RETURN jsonb_build_object('ok', true, 'action', 'already_cancelled', 'refund_required', false);
  END IF;
  IF v_order.status IN ('payment_failed', 'pending_payment', 'pickup_failed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_cancellable', 'status', v_order.status);
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE status = 'delivered'),
    COUNT(*) FILTER (WHERE status NOT IN ('delivered', 'cancelled_by_vendor', 'payment_failed', 'pickup_failed')),
    COALESCE(SUM(line_total) FILTER (WHERE status NOT IN ('delivered', 'cancelled_by_vendor', 'payment_failed', 'pickup_failed')), 0)
  INTO v_delivered_count, v_cancellable_count, v_refund_amount
  FROM public.order_items WHERE order_id = p_order_id;

  IF v_cancellable_count = 0 AND v_delivered_count > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'only_delivered_lines_remain');
  END IF;

  UPDATE public.order_items SET status = 'cancelled_by_vendor', updated_at = v_now
  WHERE order_id = p_order_id
    AND status NOT IN ('delivered', 'cancelled_by_vendor', 'payment_failed', 'pickup_failed');

  IF v_delivered_count > 0 THEN
    UPDATE public.orders SET status = 'delivered', updated_at = v_now WHERE id = p_order_id;
  ELSE
    UPDATE public.orders SET status = 'cancelled_by_vendor', updated_at = v_now WHERE id = p_order_id;
  END IF;

  SELECT * INTO v_payment
  FROM public.payments
  WHERE order_id = p_order_id AND status IN ('success', 'refund_pending', 'refund_failed')
  ORDER BY created_at DESC LIMIT 1 FOR UPDATE;

  IF NOT FOUND OR v_refund_amount <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'action', 'cancelled', 'refund_required', false, 'order_id', p_order_id);
  END IF;
  IF v_payment.gateway_payment_id IS NULL OR length(trim(v_payment.gateway_payment_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_missing_gateway_id', 'payment_id', v_payment.id);
  END IF;

  v_gateway := lower(trim(v_payment.gateway_name));
  SELECT au.email INTO v_email FROM auth.users au WHERE au.id = v_order.placed_by;

  UPDATE public.payments SET status = 'refund_pending', updated_at = v_now
  WHERE id = v_payment.id AND status IS DISTINCT FROM 'refunded';

  SELECT r.id INTO v_refund_id FROM public.refunds r WHERE r.payment_id = v_payment.id LIMIT 1;
  IF v_refund_id IS NULL THEN
    INSERT INTO public.refunds (order_id, payment_id, amount, status, reason, retry_count, customer_email, gateway_name)
    VALUES (p_order_id, v_payment.id, v_refund_amount, 'initiated', COALESCE(p_reason, 'Vendor cancelled order'), 0, v_email, v_gateway)
    RETURNING id INTO v_refund_id;
  ELSE
    UPDATE public.refunds
    SET customer_email = COALESCE(customer_email, v_email),
        amount = COALESCE(NULLIF(amount, 0), v_refund_amount),
        reason = COALESCE(reason, p_reason),
        gateway_name = COALESCE(gateway_name, v_gateway)
    WHERE id = v_refund_id;
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'action', 'cancelled', 'refund_required', true, 'refund_id', v_refund_id,
    'payment_id', v_payment.id, 'order_id', p_order_id, 'amount', v_refund_amount,
    'txnid', v_payment.gateway_payment_id, 'email', v_email
  );
END;
$$;


ALTER FUNCTION "public"."cancel_order_by_admin"("p_order_id" "uuid", "p_reason" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."cancel_scheduled_refund_for_order"("p_order_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_cancelled int := 0;
  v_blocked int := 0;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_id_required');
  END IF;

  SELECT count(*)::int INTO v_blocked
  FROM public.refunds
  WHERE order_id = p_order_id
    AND status IN ('initiated', 'processing', 'success');

  IF v_blocked > 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'refund_already_processing',
      'blocked_count', v_blocked
    );
  END IF;

  UPDATE public.refunds
  SET status = 'cancelled',
      process_after = NULL
  WHERE order_id = p_order_id
    AND status = 'scheduled';

  GET DIAGNOSTICS v_cancelled = ROW_COUNT;

  UPDATE public.payments p
  SET status = 'success',
      updated_at = now()
  WHERE p.order_id = p_order_id
    AND p.status = 'refund_pending'
    AND NOT EXISTS (
      SELECT 1 FROM public.refunds r
      WHERE r.payment_id = p.id
        AND r.status IN ('scheduled', 'initiated', 'processing', 'success')
    );

  RETURN jsonb_build_object(
    'ok', true,
    'cancelled_count', v_cancelled
  );
END;
$$;


ALTER FUNCTION "public"."cancel_scheduled_refund_for_order"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."check_available_stock_before_insert"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_stock integer;
  v_available boolean;
  v_qty integer;
  v_name text;
BEGIN
  v_qty := GREATEST(1, COALESCE(NEW.quantity, 1));

  SELECT i.available_stock, COALESCE(i.is_available, false), i.name
  INTO v_stock, v_available, v_name
  FROM public.items i
  WHERE i.id = NEW.item_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Item not found for stock check.';
  END IF;

  IF v_available IS NOT TRUE THEN
    RAISE EXCEPTION 'Insufficient stock or unavailable items: %. Please refresh and try again.',
      COALESCE(v_name, 'item');
  END IF;

  -- Place order only when stock >= requested quantity
  IF COALESCE(v_stock, 0) < v_qty THEN
    RAISE EXCEPTION 'Insufficient stock. Available: %, Requested: % (%)',
      COALESCE(v_stock, 0), v_qty, COALESCE(v_name, 'item');
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."check_available_stock_before_insert"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."claim_user_push_token"("p_fcm_token" "text", "p_platform" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_platform text := lower(trim(COALESCE(p_platform, '')));
  v_existing public.user_tokens%ROWTYPE;
  v_now timestamptz := now();
  v_prev uuid;
  v_new_id uuid;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  IF p_fcm_token IS NULL OR length(trim(p_fcm_token)) = 0 THEN
    RETURN jsonb_build_object('success', false, 'error', 'missing_token');
  END IF;

  IF v_platform = '' THEN
    v_platform := NULL;
  ELSIF v_platform NOT IN ('ios', 'android', 'web') THEN
    RETURN jsonb_build_object('success', false, 'error', 'invalid_platform');
  END IF;

  -- Lock any row for this token (cross-user safe via SECURITY DEFINER).
  SELECT * INTO v_existing
  FROM public.user_tokens
  WHERE fcm_token = trim(p_fcm_token)
  FOR UPDATE;

  IF FOUND THEN
    IF v_existing.user_id = v_uid THEN
      UPDATE public.user_tokens
      SET
        platform = COALESCE(v_platform, platform),
        is_enabled = true,
        updated_at = v_now
      WHERE id = v_existing.id;

      RETURN jsonb_build_object(
        'success', true,
        'action', 'updated',
        'token_id', v_existing.id
      );
    END IF;

    -- Different account on this device: move ONLY this token to current user.
    -- Other tokens for the previous user_id are left intact (other devices keep notifying).
    v_prev := v_existing.user_id;

    UPDATE public.user_tokens
    SET
      user_id = v_uid,
      platform = COALESCE(v_platform, platform),
      is_enabled = true,
      updated_at = v_now
    WHERE id = v_existing.id
    RETURNING id INTO v_new_id;

    RETURN jsonb_build_object(
      'success', true,
      'action', 'reassigned',
      'token_id', v_new_id,
      'previous_user_id', v_prev
    );
  END IF;

  INSERT INTO public.user_tokens (user_id, fcm_token, platform, is_enabled, updated_at)
  VALUES (v_uid, trim(p_fcm_token), v_platform, true, v_now)
  RETURNING id INTO v_new_id;

  RETURN jsonb_build_object(
    'success', true,
    'action', 'inserted',
    'token_id', v_new_id
  );
END;
$$;


ALTER FUNCTION "public"."claim_user_push_token"("p_fcm_token" "text", "p_platform" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."claim_user_push_token"("p_fcm_token" "text", "p_platform" "text") IS 'Binds this device FCM token to auth.uid(). Same user → re-enable. Other user on this device → reassign ONLY this token (sibling device tokens for the old user stay). Multiple devices sharing one login = multiple rows under that user_id.';



CREATE OR REPLACE FUNCTION "public"."claim_webhook_event"("p_gateway" "text", "p_event_id" "text", "p_event_type" "text", "p_payload" "jsonb", "p_gateway_version" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_event   record;
  v_now     timestamptz := now();
  v_stale   timestamptz := v_now - interval '5 minutes';
  v_gateway text        := lower(trim(p_gateway));
BEGIN
  INSERT INTO public.payment_webhook_events (
    event_id, gateway, gateway_version, event_type, status, payload, created_at, processing_started_at
  ) VALUES (
    p_event_id, v_gateway, p_gateway_version, p_event_type, 'processing', p_payload, v_now, v_now
  )
  ON CONFLICT (gateway, event_id) DO NOTHING
  RETURNING id, status INTO v_event;

  IF FOUND THEN
    RETURN jsonb_build_object('should_process', true, 'db_id', v_event.id);
  END IF;

  SELECT id, status, processing_started_at INTO v_event
  FROM public.payment_webhook_events
  WHERE gateway = v_gateway AND event_id = p_event_id
  FOR UPDATE;

  IF v_event.status = 'processed' THEN
    RETURN jsonb_build_object('should_process', false, 'reason', 'already_processed', 'db_id', v_event.id);
  END IF;

  IF v_event.status = 'processing' AND v_event.processing_started_at > v_stale THEN
    RETURN jsonb_build_object('should_process', false, 'reason', 'in_progress', 'db_id', v_event.id);
  END IF;

  UPDATE public.payment_webhook_events
  SET status = 'processing', processing_started_at = v_now, error = NULL
  WHERE id = v_event.id;

  RETURN jsonb_build_object('should_process', true, 'db_id', v_event.id);
END;
$$;


ALTER FUNCTION "public"."claim_webhook_event"("p_gateway" "text", "p_event_id" "text", "p_event_type" "text", "p_payload" "jsonb", "p_gateway_version" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."close_canteen_cleanup"("p_canteen_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_now timestamptz := now();
  v_order record;
  v_payment record;
  v_email text;
  v_refund_amount numeric(12,2);
  v_refund_id uuid;
  v_has_ready boolean;
  v_has_preparing boolean;
  v_final_status text;
  v_reason text;
  v_counts jsonb := jsonb_build_object(
    'archived', 0,
    'failed', 0,
    'refunds_initiated', 0,
    'pickup_failed', 0,
    'cancelled', 0
  );
  v_archived int := 0;
  v_failed int := 0;
  v_refunds int := 0;
  v_pickup int := 0;
  v_cancelled int := 0;
  v_jwt_role text;
  v_user_role text;
BEGIN
  IF p_canteen_id IS NULL THEN
    RAISE EXCEPTION 'canteen_id required';
  END IF;

  BEGIN
    v_jwt_role := coalesce(
      current_setting('request.jwt.claim.role', true),
      (current_setting('request.jwt.claims', true)::jsonb->>'role')
    );
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role IS DISTINCT FROM 'service_role'
     AND current_user NOT IN ('postgres', 'supabase_admin')
  THEN
    SELECT role INTO v_user_role FROM public.users WHERE id = auth.uid();
    IF v_user_role IS DISTINCT FROM 'canteen_admin'
       OR public.get_my_canteen_id() IS DISTINCT FROM p_canteen_id
    THEN
      RAISE EXCEPTION 'not authorized to close-cleanup this canteen';
    END IF;
  END IF;

  PERFORM 1 FROM public.canteens WHERE id = p_canteen_id FOR UPDATE;

  PERFORM set_config('hungertap.close_cleanup', '1', true);

  FOR v_order IN
    SELECT o.*
    FROM public.orders o
    WHERE o.canteen_id = p_canteen_id
    ORDER BY o.created_at ASC
    FOR UPDATE OF o SKIP LOCKED
  LOOP
    v_final_status := v_order.status;
    v_reason := 'canteen_close';

    IF v_order.status = 'pending_payment' THEN
      SELECT p.* INTO v_payment
      FROM public.payments p
      WHERE p.order_id = v_order.id
      ORDER BY p.created_at DESC
      LIMIT 1
      FOR UPDATE;

      IF FOUND AND v_payment.status = 'success' THEN
        UPDATE public.order_items
        SET status = 'cancelled_by_vendor', updated_at = v_now
        WHERE order_id = v_order.id
          AND status IS DISTINCT FROM 'cancelled_by_vendor';

        UPDATE public.orders
        SET status = 'cancelled_by_vendor', updated_at = v_now
        WHERE id = v_order.id;

        v_refund_amount := COALESCE(v_payment.amount, v_order.total_amount, 0);
        SELECT au.email INTO v_email FROM auth.users au WHERE au.id = v_order.placed_by;

        IF v_refund_amount > 0 THEN
          UPDATE public.payments
          SET status = 'refund_pending', updated_at = v_now
          WHERE id = v_payment.id AND status IS DISTINCT FROM 'refunded';

          SELECT r.id INTO v_refund_id FROM public.refunds r WHERE r.payment_id = v_payment.id LIMIT 1;
          IF v_refund_id IS NULL THEN
            INSERT INTO public.refunds (
              order_id, payment_id, amount, status, reason, retry_count, customer_email, gateway_name
            ) VALUES (
              v_order.id, v_payment.id, v_refund_amount, 'initiated',
              'Canteen close: payment succeeded on pending order', 0, v_email,
              lower(trim(v_payment.gateway_name))
            );
            v_refunds := v_refunds + 1;
          END IF;
        END IF;

        v_final_status := 'cancelled_by_vendor';
        v_reason := 'canteen_close_pending_payment_success_refund';
        v_cancelled := v_cancelled + 1;
      ELSE
        IF FOUND AND v_payment.status = 'initiated' THEN
          UPDATE public.payments
          SET status = 'failed', updated_at = v_now
          WHERE id = v_payment.id;
        END IF;

        UPDATE public.order_items
        SET status = 'payment_failed', updated_at = v_now
        WHERE order_id = v_order.id
          AND status IS DISTINCT FROM 'payment_failed';

        UPDATE public.orders
        SET status = 'payment_failed', updated_at = v_now
        WHERE id = v_order.id;

        v_final_status := 'payment_failed';
        v_reason := 'canteen_close_pending_payment';
      END IF;

    ELSIF v_order.status = 'preparing' THEN
      SELECT
        COALESCE(SUM(line_total) FILTER (
          WHERE status NOT IN ('delivered', 'cancelled_by_vendor', 'payment_failed', 'pickup_failed')
        ), 0)
      INTO v_refund_amount
      FROM public.order_items
      WHERE order_id = v_order.id;

      UPDATE public.order_items
      SET status = 'cancelled_by_vendor', updated_at = v_now
      WHERE order_id = v_order.id
        AND status NOT IN ('delivered', 'cancelled_by_vendor', 'payment_failed', 'pickup_failed');

      UPDATE public.orders
      SET status = 'cancelled_by_vendor', updated_at = v_now
      WHERE id = v_order.id;

      SELECT p.* INTO v_payment
      FROM public.payments p
      WHERE p.order_id = v_order.id
        AND p.status IN ('success', 'refund_pending', 'refund_failed')
      ORDER BY p.created_at DESC
      LIMIT 1
      FOR UPDATE;

      IF FOUND AND v_refund_amount > 0 THEN
        SELECT au.email INTO v_email FROM auth.users au WHERE au.id = v_order.placed_by;
        UPDATE public.payments
        SET status = 'refund_pending', updated_at = v_now
        WHERE id = v_payment.id AND status IS DISTINCT FROM 'refunded';

        SELECT r.id INTO v_refund_id FROM public.refunds r WHERE r.payment_id = v_payment.id LIMIT 1;
        IF v_refund_id IS NULL THEN
          INSERT INTO public.refunds (
            order_id, payment_id, amount, status, reason, retry_count, customer_email, gateway_name
          ) VALUES (
            v_order.id, v_payment.id, v_refund_amount, 'initiated',
            'Canteen close: preparing order cancelled', 0, v_email,
            lower(trim(v_payment.gateway_name))
          );
          v_refunds := v_refunds + 1;
        END IF;
      END IF;

      v_final_status := 'cancelled_by_vendor';
      v_reason := 'canteen_close_preparing_cancelled';
      v_cancelled := v_cancelled + 1;

    ELSIF v_order.status = 'partially_ready' THEN
      SELECT EXISTS (
        SELECT 1 FROM public.order_items
        WHERE order_id = v_order.id AND status = 'ready'
      ), EXISTS (
        SELECT 1 FROM public.order_items
        WHERE order_id = v_order.id AND status = 'preparing'
      )
      INTO v_has_ready, v_has_preparing;

      SELECT COALESCE(SUM(line_total), 0)
      INTO v_refund_amount
      FROM public.order_items
      WHERE order_id = v_order.id
        AND status = 'preparing';

      IF v_has_preparing THEN
        UPDATE public.order_items
        SET status = 'cancelled_by_vendor', updated_at = v_now
        WHERE order_id = v_order.id
          AND status = 'preparing';
      END IF;

      IF v_has_ready THEN
        UPDATE public.order_items
        SET status = 'pickup_failed', updated_at = v_now
        WHERE order_id = v_order.id
          AND status = 'ready';
      END IF;

      IF v_has_ready THEN
        v_final_status := 'pickup_failed';
        v_reason := 'canteen_close_partially_ready_split';
        v_pickup := v_pickup + 1;
      ELSE
        v_final_status := 'cancelled_by_vendor';
        v_reason := 'canteen_close_partially_ready_all_cancelled';
        v_cancelled := v_cancelled + 1;
      END IF;

      UPDATE public.orders
      SET status = v_final_status, updated_at = v_now
      WHERE id = v_order.id;

      IF v_refund_amount > 0 THEN
        SELECT p.* INTO v_payment
        FROM public.payments p
        WHERE p.order_id = v_order.id
          AND p.status IN ('success', 'refund_pending', 'refund_failed')
        ORDER BY p.created_at DESC
        LIMIT 1
        FOR UPDATE;

        IF FOUND THEN
          SELECT au.email INTO v_email FROM auth.users au WHERE au.id = v_order.placed_by;
          UPDATE public.payments
          SET status = 'refund_pending', updated_at = v_now
          WHERE id = v_payment.id AND status IS DISTINCT FROM 'refunded';

          SELECT r.id INTO v_refund_id FROM public.refunds r WHERE r.payment_id = v_payment.id LIMIT 1;
          IF v_refund_id IS NULL THEN
            INSERT INTO public.refunds (
              order_id, payment_id, amount, status, reason, retry_count, customer_email, gateway_name
            ) VALUES (
              v_order.id, v_payment.id, v_refund_amount, 'initiated',
              'Canteen close: refund preparing lines on partially_ready', 0, v_email,
              lower(trim(v_payment.gateway_name))
            );
            v_refunds := v_refunds + 1;
          END IF;
        END IF;
      END IF;

    ELSIF v_order.status = 'ready' THEN
      UPDATE public.order_items
      SET status = 'pickup_failed', updated_at = v_now
      WHERE order_id = v_order.id
        AND status IS DISTINCT FROM 'pickup_failed';

      UPDATE public.orders
      SET status = 'pickup_failed', updated_at = v_now
      WHERE id = v_order.id;

      v_final_status := 'pickup_failed';
      v_reason := 'canteen_close_ready_not_picked';
      v_pickup := v_pickup + 1;

    ELSIF v_order.status IN ('delivered', 'cancelled_by_vendor', 'pickup_failed') THEN
      v_final_status := v_order.status;
      v_reason := 'canteen_close_' || v_order.status;

      IF v_order.status = 'cancelled_by_vendor' THEN
        PERFORM public.ensure_refund_for_order(
          v_order.id,
          'Canteen close: backfill cancelled refund',
          NULL
        );
      END IF;

    ELSIF v_order.status = 'payment_failed' THEN
      v_final_status := 'payment_failed';
      v_reason := 'canteen_close_payment_failed';

    ELSE
      v_final_status := 'payment_failed';
      v_reason := 'canteen_close_unexpected_' || COALESCE(v_order.status, 'null');
      UPDATE public.orders SET status = 'payment_failed', updated_at = v_now WHERE id = v_order.id;
      UPDATE public.order_items SET status = 'payment_failed', updated_at = v_now
      WHERE order_id = v_order.id AND status IS DISTINCT FROM 'payment_failed';
    END IF;

    SELECT * INTO v_order FROM public.orders WHERE id = v_order.id;

    IF v_final_status = 'payment_failed' THEN
      INSERT INTO public.failed_orders (
        id, canteen_id, placed_by, placed_by_role, order_token, barcode,
        status, is_takeaway, total_amount, token_date, created_at, updated_at,
        archived_at, archive_reason
      ) VALUES (
        v_order.id, v_order.canteen_id, v_order.placed_by, v_order.placed_by_role,
        v_order.order_token, v_order.barcode, 'payment_failed', v_order.is_takeaway,
        v_order.total_amount, v_order.token_date, v_order.created_at, v_now,
        v_now, v_reason
      )
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at,
        archived_at = EXCLUDED.archived_at,
        archive_reason = EXCLUDED.archive_reason;

      INSERT INTO public.failed_order_items (
        id, order_id, item_id, item_name, status, quantity, ready_count,
        unit_price, line_total, total_amount, created_at, archived_at
      )
      SELECT
        oi.id, oi.order_id, oi.item_id, oi.item_name, oi.status, oi.quantity,
        oi.ready_count, oi.unit_price, oi.line_total,
        COALESCE(oi.line_total, oi.unit_price * oi.quantity),
        oi.created_at, v_now
      FROM public.order_items oi
      WHERE oi.order_id = v_order.id
      ON CONFLICT (id) DO NOTHING;

      v_failed := v_failed + 1;
    ELSE
      INSERT INTO public.archived_orders (
        id, canteen_id, placed_by, placed_by_role, order_token, barcode,
        status, is_takeaway, total_amount, token_date, created_at, updated_at,
        archived_at, archive_reason
      ) VALUES (
        v_order.id, v_order.canteen_id, v_order.placed_by, v_order.placed_by_role,
        v_order.order_token, v_order.barcode, v_final_status, v_order.is_takeaway,
        v_order.total_amount, v_order.token_date, v_order.created_at, v_now,
        v_now, v_reason
      )
      ON CONFLICT (id) DO UPDATE SET
        status = EXCLUDED.status,
        updated_at = EXCLUDED.updated_at,
        archived_at = EXCLUDED.archived_at,
        archive_reason = EXCLUDED.archive_reason;

      INSERT INTO public.archived_order_items (
        id, order_id, item_id, item_name, status, quantity, ready_count,
        unit_price, line_total, total_amount, created_at, archived_at
      )
      SELECT
        oi.id, oi.order_id, oi.item_id, oi.item_name, oi.status, oi.quantity,
        oi.ready_count, oi.unit_price, oi.line_total,
        COALESCE(oi.line_total, oi.unit_price * oi.quantity),
        oi.created_at, v_now
      FROM public.order_items oi
      WHERE oi.order_id = v_order.id
      ON CONFLICT (id) DO NOTHING;

      v_archived := v_archived + 1;
    END IF;

    INSERT INTO public.archived_payments (
      id, order_id, amount, status, gateway_name, gateway_payment_id,
      gateway_response, created_at, updated_at, archived_at, gateway_order_id
    )
    SELECT
      p.id, p.order_id, p.amount, p.status, p.gateway_name, p.gateway_payment_id,
      p.gateway_response, p.created_at, p.updated_at, v_now, p.gateway_order_id
    FROM public.payments p
    WHERE p.order_id = v_order.id
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      gateway_response = EXCLUDED.gateway_response,
      updated_at = EXCLUDED.updated_at,
      archived_at = EXCLUDED.archived_at;

    INSERT INTO public.archived_refunds (
      id, payment_id, order_id, amount, status, gateway_refund_id,
      gateway_response, reason, customer_email, retry_count, created_at,
      refunded_at, archived_at, gateway_name
    )
    SELECT
      r.id, r.payment_id, r.order_id, r.amount, r.status, r.gateway_refund_id,
      r.gateway_response, r.reason, r.customer_email, r.retry_count, r.created_at,
      r.refunded_at, v_now, lower(nullif(btrim(r.gateway_name), ''))
    FROM public.refunds r
    WHERE r.order_id = v_order.id
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      gateway_response = EXCLUDED.gateway_response,
      customer_email = COALESCE(EXCLUDED.customer_email, public.archived_refunds.customer_email),
      gateway_name = COALESCE(EXCLUDED.gateway_name, public.archived_refunds.gateway_name),
      archived_at = EXCLUDED.archived_at;

    -- Payments/refunds stay live for gateway webhooks.
    -- Terminal purge runs at midnight IST via purge_terminal_payment_rows().
    DELETE FROM public.order_items WHERE order_id = v_order.id;
    DELETE FROM public.orders WHERE id = v_order.id;
  END LOOP;

  v_counts := jsonb_build_object(
    'archived', v_archived,
    'failed', v_failed,
    'refunds_initiated', v_refunds,
    'pickup_failed', v_pickup,
    'cancelled', v_cancelled,
    'canteen_id', p_canteen_id,
    'at', v_now
  );

  RAISE LOG '[CLOSE_CLEANUP] %', v_counts;
  RETURN jsonb_build_object('success', true) || v_counts;
END;
$$;


ALTER FUNCTION "public"."close_canteen_cleanup"("p_canteen_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_webhook_event"("p_db_id" "uuid", "p_status" "text", "p_error" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE public.payment_webhook_events
  SET status       = p_status,
      error        = p_error,
      processed_at = CASE WHEN p_status = 'processed' THEN now() ELSE NULL END
  WHERE id = p_db_id;
END;
$$;


ALTER FUNCTION "public"."complete_webhook_event"("p_db_id" "uuid", "p_status" "text", "p_error" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."complete_webhook_event"("p_db_id" "uuid", "p_status" "text", "p_error" "text" DEFAULT NULL::"text", "p_failure_class" "text" DEFAULT NULL::"text") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  UPDATE public.payment_webhook_events
  SET status        = p_status,
      error         = p_error,
      failure_class = COALESCE(p_failure_class, failure_class),
      processed_at  = CASE WHEN p_status = 'processed' THEN now() ELSE NULL END
  WHERE id = p_db_id;
END;
$$;


ALTER FUNCTION "public"."complete_webhook_event"("p_db_id" "uuid", "p_status" "text", "p_error" "text", "p_failure_class" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."compute_order_status_from_items"("p_order_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_count         int;
  v_delivered     int;
  v_cancelled     int;
  v_ready         int;
  v_pickup_failed int;
BEGIN
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'delivered'),
    COUNT(*) FILTER (WHERE status = 'cancelled_by_vendor'),
    COUNT(*) FILTER (WHERE status = 'ready'),
    COUNT(*) FILTER (WHERE status = 'pickup_failed')
  INTO v_count, v_delivered, v_cancelled, v_ready, v_pickup_failed
  FROM public.order_items
  WHERE order_id = p_order_id;

  IF v_count = 0 THEN
    RETURN 'preparing';
  END IF;

  IF v_delivered = v_count THEN
    RETURN 'delivered';
  END IF;

  IF v_cancelled = v_count THEN
    RETURN 'cancelled_by_vendor';
  END IF;

  IF v_pickup_failed = v_count THEN
    RETURN 'pickup_failed';
  END IF;

  IF v_delivered > 0 AND (v_delivered + v_cancelled) = v_count THEN
    RETURN 'delivered';
  END IF;

  IF (v_ready + v_delivered) = v_count THEN
    RETURN 'ready';
  ELSIF v_ready > 0 THEN
    RETURN 'partially_ready';
  ELSE
    RETURN 'preparing';
  END IF;
END;
$$;


ALTER FUNCTION "public"."compute_order_status_from_items"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."count_recent_ready_orders"("p_canteen_id" "uuid") RETURNS integer
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT COUNT(*)::integer
  FROM public.orders o
  WHERE o.canteen_id = p_canteen_id
    AND o.status IN ('ready', 'partially_ready')
    AND o.updated_at > (NOW() - INTERVAL '25 minutes');
$$;


ALTER FUNCTION "public"."count_recent_ready_orders"("p_canteen_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_order_payment_v2"("p_order_id" "uuid", "p_total_amount" numeric) RETURNS "uuid"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_payment_id    UUID;
  v_order_amount  NUMERIC(12, 2);
BEGIN
  -- Verify amount matches actual order
  SELECT total_amount INTO v_order_amount
  FROM public.orders WHERE id = p_order_id;

  IF v_order_amount IS NULL THEN
    RAISE LOG '[ORDER_V2] PAYMENT_FAIL: order_id=% not found', p_order_id;
    RAISE EXCEPTION 'Order not found for payment creation';
  END IF;

  IF v_order_amount <> p_total_amount THEN
    RAISE LOG '[ORDER_V2] PAYMENT_MISMATCH: order_id=%, order_amt=%, param_amt=%', p_order_id, v_order_amount, p_total_amount;
    p_total_amount := v_order_amount;
  END IF;

  INSERT INTO public.payments (order_id, amount, status, created_at)
  VALUES (p_order_id, p_total_amount, 'initiated', NOW())
  RETURNING id INTO v_payment_id;

  RAISE LOG '[ORDER_V2] PAYMENT_CREATED: payment_id=%, order_id=%, amount=%', v_payment_id, p_order_id, p_total_amount;
  RETURN v_payment_id;
END;
$$;


ALTER FUNCTION "public"."create_order_payment_v2"("p_order_id" "uuid", "p_total_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_order_status_notification"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_new_status text;
  v_old_status text;
  v_skip text;
  v_is_revert text;
  v_title text;
  v_message text;
  v_notif_type text := 'order_status';
  v_user_id uuid;
  v_item_count int := 0;
  v_ready_count int := 0;
  v_delivered_count int := 0;
BEGIN
  BEGIN
    v_skip := current_setting('app.skip_order_notifications', true);
  EXCEPTION WHEN OTHERS THEN
    v_skip := NULL;
  END;
  IF lower(coalesce(v_skip, '')) IN ('true', '1', 'on', 'yes') THEN
    RETURN NEW;
  END IF;
  BEGIN
    v_is_revert := current_setting('app.is_order_revert', true);
  EXCEPTION WHEN OTHERS THEN
    v_is_revert := NULL;
  END;
  v_new_status := NEW.status;
  v_old_status := OLD.status;
  IF v_new_status IS NULL OR v_old_status IS NULL OR v_new_status = v_old_status THEN
    RETURN NEW;
  END IF;
  IF v_new_status NOT IN ('preparing', 'partially_ready', 'ready', 'delivered', 'cancelled_by_vendor', 'pickup_failed') THEN
    RETURN NEW;
  END IF;
  IF COALESCE(NEW.placed_by_role, '') <> 'student' OR NEW.placed_by IS NULL THEN
    RETURN NEW;
  END IF;
  v_user_id := NEW.placed_by;
  IF NOT EXISTS (SELECT 1 FROM auth.users WHERE id = v_user_id) THEN
    RETURN NEW;
  END IF;
  IF v_old_status = 'pending_payment' THEN
    SELECT COUNT(*), COUNT(*) FILTER (WHERE status = 'ready'), COUNT(*) FILTER (WHERE status = 'delivered')
    INTO v_item_count, v_ready_count, v_delivered_count FROM public.order_items WHERE order_id = NEW.id;
    IF v_new_status = 'ready' OR (v_item_count > 0 AND (v_ready_count + v_delivered_count) = v_item_count) THEN
      v_notif_type := 'order_placed_and_ready';
      v_title := '⚡ Order Placed & Ready! #' || COALESCE(NEW.order_token, '');
      v_message := 'Your order #' || COALESCE(NEW.order_token, '') || ' is placed and already prepared! Please pick it up at the counter with your barcode.';
    ELSIF v_new_status = 'partially_ready' OR (v_ready_count + v_delivered_count) > 0 THEN
      v_notif_type := 'order_placed_and_partially_ready';
      v_title := '⚡ Order Placed & Partially Ready! #' || COALESCE(NEW.order_token, '');
      v_message := 'Your order #' || COALESCE(NEW.order_token, '') || ' is placed and some items are already ready! Pick up ready items at the counter.';
    ELSE
      v_notif_type := 'order_placed';
      v_title := '🎉 Order Placed! #' || COALESCE(NEW.order_token, '');
      v_message := 'Your order #' || COALESCE(NEW.order_token, '') || ' has been placed successfully! We will notify you when it is ready.';
    END IF;
  ELSIF v_old_status = 'cancelled_by_vendor' THEN
    v_notif_type := 'order_restored';
    IF v_new_status = 'ready' THEN
      v_title := '🔄 Order Restored & Ready! #' || COALESCE(NEW.order_token, '');
      v_message := 'Good news! Your cancelled order #' || COALESCE(NEW.order_token, '') || ' has been reopened and is ready for pickup at the counter.';
    ELSIF v_new_status = 'partially_ready' THEN
      v_title := '🔄 Order Restored & Partially Ready! #' || COALESCE(NEW.order_token, '');
      v_message := 'Your order #' || COALESCE(NEW.order_token, '') || ' has been restored. Some items are ready.';
    ELSE
      v_title := '🔄 Order Restored! #' || COALESCE(NEW.order_token, '');
      v_message := 'Your order #' || COALESCE(NEW.order_token, '') || ' has been restored and is being prepared in the kitchen.';
    END IF;
  ELSIF lower(coalesce(v_is_revert, '')) IN ('true', '1', 'on', 'yes') THEN
    IF v_old_status IN ('ready', 'partially_ready') AND v_new_status IN ('preparing', 'partially_ready') THEN
      v_notif_type := 'order_reverted_to_preparing';
      v_title := '🔄 Back in Kitchen #' || COALESCE(NEW.order_token, '');
      v_message := 'Your order #' || COALESCE(NEW.order_token, '') || ' was moved back to the kitchen. We will notify you when it is ready again.';
    ELSIF v_old_status IN ('delivered', 'pickup_failed') AND v_new_status = 'ready' THEN
      v_notif_type := 'order_reverted_to_ready';
      v_title := '🔄 Back in Pickup Queue #' || COALESCE(NEW.order_token, '');
      v_message := 'Your order #' || COALESCE(NEW.order_token, '') || ' is back in the pickup queue. Please collect it at the counter with your barcode.';
    ELSE
      RETURN NEW;
    END IF;
  ELSE
    IF v_old_status = 'preparing' AND v_new_status IN ('partially_ready', 'ready') THEN
      IF EXISTS (SELECT 1 FROM public.notifications n WHERE n.user_id = v_user_id AND n.data->>'order_id' = NEW.id::text AND n.type IN ('order_placed', 'order_placed_and_partially_ready') AND n.data->>'previous_status' = 'pending_payment' AND n.created_at >= NOW() - INTERVAL '1 second') THEN
        RETURN NEW;
      END IF;
    END IF;
    IF v_new_status = 'ready' AND v_old_status IN ('delivered', 'pickup_failed', 'ready', 'partially_ready') THEN
      IF v_old_status IN ('delivered', 'pickup_failed') THEN RETURN NEW; END IF;
    END IF;
    IF v_new_status IN ('preparing', 'partially_ready') AND v_old_status IN ('ready', 'partially_ready', 'delivered') THEN RETURN NEW; END IF;
    CASE v_new_status
      WHEN 'partially_ready' THEN v_title := '🔔 Order Partially Ready #' || COALESCE(NEW.order_token, ''); v_message := 'Some items in your order #' || COALESCE(NEW.order_token, '') || ' are ready for pickup at the counter.';
      WHEN 'ready' THEN IF COALESCE(NEW.is_takeaway, false) THEN v_title := '📦 Takeaway Packed & Ready! #' || COALESCE(NEW.order_token, ''); v_message := 'Your takeaway order #' || COALESCE(NEW.order_token, '') || ' is packed and ready! Please collect it at the counter.'; ELSE v_title := '🔔 Order Ready! #' || COALESCE(NEW.order_token, ''); v_message := 'Your order #' || COALESCE(NEW.order_token, '') || ' is ready for pickup! Please show your barcode at the counter.'; END IF;
      WHEN 'delivered' THEN v_title := '✅ Order Collected #' || COALESCE(NEW.order_token, ''); v_message := 'Your order #' || COALESCE(NEW.order_token, '') || ' has been collected successfully. Enjoy your meal!';
      WHEN 'cancelled_by_vendor' THEN v_title := '❌ Order Cancelled #' || COALESCE(NEW.order_token, ''); v_message := 'Your order #' || COALESCE(NEW.order_token, '') || ' was cancelled by the canteen. If you paid, a refund will be processed.';
      WHEN 'pickup_failed' THEN v_title := '⚠️ Order Pickup Expired #' || COALESCE(NEW.order_token, ''); v_message := 'Your order #' || COALESCE(NEW.order_token, '') || ' was not collected before the counter closed.';
      ELSE NULL;
    END CASE;
  END IF;
  IF v_title IS NOT NULL AND v_message IS NOT NULL THEN
    BEGIN
      INSERT INTO public.notifications (user_id, type, title, body, data) VALUES (v_user_id, v_notif_type, v_title, v_message, jsonb_build_object('order_id', NEW.id, 'order_token', NEW.order_token, 'status', v_new_status, 'previous_status', v_old_status, 'canteen_id', NEW.canteen_id));
    EXCEPTION WHEN OTHERS THEN RAISE WARNING 'Order notification insert failed: order_id=%, error=%', NEW.id, SQLERRM; END;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."create_order_status_notification"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_order_v2"("p_items" "jsonb", "p_is_takeaway" boolean DEFAULT false, "p_create_payment" boolean DEFAULT true) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_placed_by           UUID;
  v_canteen_id          UUID;
  v_placed_by_role      TEXT;
  v_is_open             BOOLEAN;
  v_app_orders_enabled  BOOLEAN;
  v_takeaway_charge     NUMERIC(10, 2);

  v_valid_count         INT;
  v_unique_item_count   INT;
  v_total_quantity      INT;
  v_total_amount        NUMERIC(12, 2);
  v_wrong_canteen_count INT;
  v_missing_count       INT;

  v_order_token         TEXT;
  v_barcode             TEXT;
  v_order_id            UUID;
  v_order_status        TEXT;
  v_payment_id          UUID := NULL;
BEGIN
  v_placed_by := auth.uid();
  v_order_id  := gen_random_uuid();

  RAISE LOG '[ORDER_V2] START: user=%, items=%, takeaway=%',
    v_placed_by, jsonb_array_length(p_items), p_is_takeaway;

  SELECT canteen_id, role INTO v_canteen_id, v_placed_by_role
  FROM public.validate_user_canteen_role_v2(v_placed_by);

  SELECT is_open, coalesce(takeaway_charge, 10.00), coalesce(app_orders_enabled, true)
  INTO v_is_open, v_takeaway_charge, v_app_orders_enabled
  FROM public.canteens WHERE id = v_canteen_id;

  -- Students / app users: require open + app_orders_enabled
  -- canteen_admin (web counter) bypasses app_orders_enabled
  IF v_placed_by_role <> 'canteen_admin' THEN
    IF v_is_open IS NOT TRUE THEN
      RAISE LOG '[ORDER_V2] CANTEEN_CLOSED: canteen=%, user=%', v_canteen_id, v_placed_by;
      RAISE EXCEPTION 'Canteen is currently closed. Please try again later.';
    END IF;
    IF v_app_orders_enabled IS NOT TRUE THEN
      RAISE LOG '[ORDER_V2] APP_ORDERS_PAUSED: canteen=%, user=%', v_canteen_id, v_placed_by;
      RAISE EXCEPTION 'App orders are paused for this canteen. Please order at the counter.';
    END IF;
  END IF;

  SELECT
    COUNT(*) FILTER (WHERE i.id IS NULL)::int,
    COUNT(*) FILTER (
      WHERE i.id IS NOT NULL AND i.canteen_id IS DISTINCT FROM v_canteen_id
    )::int
  INTO v_missing_count, v_wrong_canteen_count
  FROM (
    SELECT DISTINCT coalesce((item->>'item_id')::uuid, (item->>'itemId')::uuid) AS item_id
    FROM jsonb_array_elements(p_items) AS item
  ) x
  LEFT JOIN public.items i ON i.id = x.item_id;

  IF COALESCE(v_missing_count, 0) > 0 THEN
    RAISE LOG '[ORDER_V2] MISSING_ITEMS: canteen=%, user=%, missing=%',
      v_canteen_id, v_placed_by, v_missing_count;
    RAISE EXCEPTION 'One or more items were not found. Please refresh the menu and try again.';
  END IF;

  IF COALESCE(v_wrong_canteen_count, 0) > 0 THEN
    RAISE LOG '[ORDER_V2] WRONG_CANTEEN: user_canteen=%, user=%, wrong=%',
      v_canteen_id, v_placed_by, v_wrong_canteen_count;
    RAISE EXCEPTION 'One or more items do not belong to your canteen.';
  END IF;

  SELECT valid_count, total_quantity, total_amount
  INTO v_valid_count, v_total_quantity, v_total_amount
  FROM public.calculate_cart_totals_v2(v_canteen_id, p_items, p_is_takeaway, v_takeaway_charge);

  SELECT count(DISTINCT coalesce((item->>'item_id')::uuid, (item->>'itemId')::uuid))::int
  INTO v_unique_item_count
  FROM jsonb_array_elements(p_items) AS item;

  IF v_valid_count <> v_unique_item_count THEN
    RAISE LOG '[ORDER_V2] INVALID_ITEMS: canteen=%, valid=%, expected=%, user=%',
      v_canteen_id, v_valid_count, v_unique_item_count, v_placed_by;
    RAISE EXCEPTION 'Some items are unavailable, out of stock, or invalid for this canteen';
  END IF;

  IF v_total_amount <= 0 THEN
    RAISE LOG '[ORDER_V2] ZERO_AMOUNT: canteen=%, amount=%, user=%',
      v_canteen_id, v_total_amount, v_placed_by;
    RAISE EXCEPTION 'Order total must be greater than zero';
  END IF;

  IF v_total_amount > 2000.00 THEN
    RAISE LOG '[ORDER_V2] MAX_AMOUNT: canteen=%, amount=%, user=%',
      v_canteen_id, v_total_amount, v_placed_by;
    RAISE EXCEPTION 'Maximum order amount allowed is ₹2000';
  END IF;

  -- GENERATE DAILY TOKEN AND UNIQUE BARCODE (BACKEND ONLY)
  v_order_token := public.generate_daily_order_token_v2(v_canteen_id);
  v_barcode     := public.generate_unique_barcode_v2(v_canteen_id);

  -- ATOMIC ITEM STOCK RESERVATION & INSERTION
  v_order_status := public.insert_order_and_items_v2(
    v_order_id, v_canteen_id, v_placed_by, v_placed_by_role,
    v_order_token, v_barcode, p_is_takeaway, v_total_amount, p_items, v_takeaway_charge
  );

  IF p_create_payment AND v_order_status = 'pending_payment' THEN
    v_payment_id := public.create_order_payment_v2(v_order_id, v_total_amount);
  END IF;

  RAISE LOG '[ORDER_V2] SUCCESS: id=%, token=%, status=%, amount=%, user=%',
    v_order_id, v_order_token, v_order_status, v_total_amount, v_placed_by;

  RETURN jsonb_build_object(
    'success', true,
    'order_id', v_order_id,
    'order_token', v_order_token,
    'barcode', v_barcode,
    'amount', v_total_amount,
    'status', v_order_status,
    'payment_id', v_payment_id
  );

EXCEPTION WHEN OTHERS THEN
  RAISE LOG '[ORDER_V2] UNHANDLED: user=%, canteen=%, sqlstate=%, error=%',
    v_placed_by, v_canteen_id, SQLSTATE, SQLERRM;
  RAISE;
END;
$$;


ALTER FUNCTION "public"."create_order_v2"("p_items" "jsonb", "p_is_takeaway" boolean, "p_create_payment" boolean) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_order_v2_app"("p_gateway_code" "text" DEFAULT NULL::"text", "p_is_takeaway" boolean DEFAULT false, "p_items" "jsonb" DEFAULT '[]'::"jsonb", "p_placed_by" "uuid" DEFAULT NULL::"uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
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


ALTER FUNCTION "public"."create_order_v2_app"("p_gateway_code" "text", "p_is_takeaway" boolean, "p_items" "jsonb", "p_placed_by" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_refund_status_notification"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_user_id uuid;
  v_token text;
  v_canteen_id uuid;
  v_role text;
  v_status text;
  v_amount numeric(12,2);
  v_amount_text text;
  v_title text;
  v_body text;
BEGIN
  v_status := NEW.status;

  IF TG_OP = 'UPDATE' AND OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF v_status NOT IN ('initiated', 'failed', 'success') THEN
    RETURN NEW;
  END IF;

  SELECT o.placed_by, o.order_token, o.canteen_id, o.placed_by_role
  INTO v_user_id, v_token, v_canteen_id, v_role
  FROM public.orders o
  WHERE o.id = NEW.order_id;

  IF v_user_id IS NULL OR COALESCE(v_role, '') <> 'student' THEN
    RETURN NEW;
  END IF;

  v_amount := COALESCE(NEW.amount, 0);
  v_amount_text := to_char(v_amount, 'FM999999990.00');
  v_title := 'Order #' || COALESCE(v_token, '');

  v_body :=
    CASE v_status
      WHEN 'initiated' THEN
        'Refund of ₹' || v_amount_text || ' has been initiated for your order.'
      WHEN 'failed' THEN
        'Refund of ₹' || v_amount_text || ' failed for your order. We will retry shortly.'
      WHEN 'success' THEN
        'Refund of ₹' || v_amount_text || ' was successful for your order.'
    END;

  INSERT INTO public.notifications (user_id, type, title, body, data)
  VALUES (
    v_user_id,
    'refund_status',
    v_title,
    v_body,
    jsonb_build_object(
      'order_id', NEW.order_id,
      'refund_id', NEW.id,
      'order_token', v_token,
      'status', v_status,
      'amount', v_amount,
      'canteen_id', v_canteen_id,
      'reason', NEW.reason
    )
  );

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."create_refund_status_notification"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."create_user_profile_from_auth"("p_user_id" "uuid") RETURNS "void"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_canteen_id uuid;
  v_college_id uuid;
  v_jwt_role text;
  v_canteen_ok boolean := false;
  v_email_confirmed_at timestamptz;
BEGIN
  BEGIN
    v_jwt_role := coalesce(
      current_setting('request.jwt.claim.role', true),
      (current_setting('request.jwt.claims', true)::jsonb->>'role')
    );
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role IS DISTINCT FROM 'service_role'
     AND current_user NOT IN ('postgres', 'supabase_admin')
  THEN
    IF auth.uid() IS NULL OR auth.uid() IS DISTINCT FROM p_user_id THEN
      RAISE EXCEPTION 'not authorized to create profile for another user';
    END IF;
  END IF;

  SELECT email_confirmed_at
  INTO v_email_confirmed_at
  FROM auth.users
  WHERE id = p_user_id;

  IF v_email_confirmed_at IS NULL THEN
    RAISE EXCEPTION 'email not verified';
  END IF;

  BEGIN
    SELECT (raw_user_meta_data->>'canteen_id')::uuid
    INTO v_canteen_id
    FROM auth.users
    WHERE id = p_user_id;
  EXCEPTION WHEN invalid_text_representation THEN
    v_canteen_id := NULL;
  END;

  IF v_canteen_id IS NOT NULL THEN
    SELECT c.college_id, true
    INTO v_college_id, v_canteen_ok
    FROM public.canteens c
    WHERE c.id = v_canteen_id
      AND c.is_active IS TRUE
      AND c.is_deleted IS FALSE;

    IF NOT COALESCE(v_canteen_ok, false) THEN
      RAISE EXCEPTION 'invalid or inactive canteen for signup';
    END IF;
  END IF;

  -- Idempotent: insert once; update canteen/college on conflict. Never overwrite role.
  INSERT INTO public.users (id, role, canteen_id, college_id)
  VALUES (p_user_id, 'student', v_canteen_id, v_college_id)
  ON CONFLICT (id) DO UPDATE SET
    canteen_id = COALESCE(EXCLUDED.canteen_id, public.users.canteen_id),
    college_id = COALESCE(EXCLUDED.college_id, public.users.college_id);
END;
$$;


ALTER FUNCTION "public"."create_user_profile_from_auth"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."email_already_registered"("p_email" "text") RETURNS boolean
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  normalized text := lower(trim(coalesce(p_email, '')));
BEGIN
  IF normalized = '' THEN
    RETURN false;
  END IF;

  -- Taken if verified auth user exists OR public profile exists for that auth id.
  -- Soft-deleted users still have auth during grace → blocked from re-signup.
  -- After auth purge, auth row is gone → email reusable (orphan public.users ignored).
  RETURN EXISTS (
    SELECT 1
    FROM auth.users u
    WHERE lower(u.email) = normalized
      AND (
        u.email_confirmed_at IS NOT NULL
        OR EXISTS (SELECT 1 FROM public.users pu WHERE pu.id = u.id)
      )
  );
END;
$$;


ALTER FUNCTION "public"."email_already_registered"("p_email" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."email_already_registered"("p_email" "text") IS 'True only for completed accounts (public.users and/or password). Incomplete OTP signups return false so Resend works.';



CREATE OR REPLACE FUNCTION "public"."enforce_order_rate_limits"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$DECLARE
  -- =========================================================================
  -- MASTER TOGGLE: Set to FALSE to disable order rate limits globally
  -- =========================================================================
  v_rate_limiting_enabled boolean := True;

  v_user_id uuid := NEW.placed_by;
  v_authoritative_role text;
  v_last_order_time timestamptz;
  v_recent_order_count integer;
  v_active_order_count integer;
  
  -- Rate Limit Parameters
  v_cooldown_seconds integer := 5;        -- Min 5s between orders per student
  v_max_per_sliding_window integer := 3;  -- Max 3 orders per sliding 60-second window
  v_max_active_orders integer := 16;       -- Max 5 active non-terminal orders per student
BEGIN
  -- 0. MASTER TOGGLE CHECK: If disabled, bypass all checks immediately
  IF NOT v_rate_limiting_enabled THEN
    RETURN NEW;
  END IF;

  -- 1. Bypass if no placed_by user ID (e.g. system seed / background script)
  IF v_user_id IS NULL THEN
    RETURN NEW;
  END IF;

  -- 2. TRANSACTION ADVISORY LOCK: Serialize concurrent order requests per user
  -- Eliminates race conditions where simultaneous HTTP requests bypass limits
  PERFORM pg_advisory_xact_lock(hashtext(v_user_id::text));

  -- 3. Server-Controlled Authoritative Role Lookup (INTO STRICT with fallback)
  BEGIN
    SELECT u.role
    INTO STRICT v_authoritative_role
    FROM public.users u
    WHERE u.id = v_user_id;
  EXCEPTION
    WHEN NO_DATA_FOUND THEN
      -- If user profile row is not found, default role to student
      v_authoritative_role := 'student';
  END;

  -- If authoritative server role is vendor / canteen_admin / staff / admin, BYPASS RATE LIMITS
  IF v_authoritative_role IN ('canteen_admin', 'staff', 'admin', 'vendor') THEN
    RETURN NEW;
  END IF;

  -- =========================================================================
  -- APP STUDENT RATE LIMIT GUARDS (Applied strictly to Mobile App Students)
  -- =========================================================================

  -- GUARD 1: Cooldown Window (Min 5 seconds between consecutive student orders)
  SELECT created_at INTO v_last_order_time
  FROM public.orders
  WHERE placed_by = v_user_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF v_last_order_time IS NOT NULL AND (now() - v_last_order_time) < (v_cooldown_seconds || ' seconds')::interval THEN
    RAISE EXCEPTION 'Order placed too quickly. Please wait % seconds before placing another order.', 
      CEIL(v_cooldown_seconds - extract(epoch from (now() - v_last_order_time)))::integer
      USING ERRCODE = 'P0001',
            HINT = 'RATE_COOLDOWN_EXCEEDED';
  END IF;

  -- GUARD 2: True Sliding Window (Max 3 orders / 60 seconds)
  -- Uses interval query instead of fixed date_trunc minute buckets to eliminate boundary exploits
  SELECT COUNT(*) INTO v_recent_order_count
  FROM public.orders
  WHERE placed_by = v_user_id
    AND created_at >= now() - INTERVAL '60 seconds';

  IF v_recent_order_count >= v_max_per_sliding_window THEN
    RAISE EXCEPTION 'Rate limit exceeded: Maximum % orders allowed per 60 seconds. Please wait before ordering again.',
      v_max_per_sliding_window
      USING ERRCODE = 'P0002',
            HINT = 'RATE_SLIDING_WINDOW_EXCEEDED';
  END IF;

  -- GUARD 3: Active Order Limit via Terminal Status Exclusion (Max 5 active orders)
  -- Defines active orders as any order NOT in a terminal/completed state.
  -- Dynamically covers active states: pending_payment, pending, preparing, partially_ready, ready.
  SELECT COUNT(*) INTO v_active_order_count
  FROM public.orders
  WHERE placed_by = v_user_id
    AND status NOT IN (
      'delivered',
      'cancelled',
      'cancelled_by_vendor',
      'payment_failed',
      'payment_expired',
      'payment_cancelled'
    );

  IF v_active_order_count >= v_max_active_orders THEN
    RAISE EXCEPTION 'Active order limit reached: You have % unfulfilled orders (pending/ready for pickup). Please pick up or complete existing orders first.',
      v_active_order_count
      USING ERRCODE = 'P0003',
            HINT = 'RATE_ACTIVE_LIMIT_EXCEEDED';
  END IF;

  RETURN NEW;
END;$$;


ALTER FUNCTION "public"."enforce_order_rate_limits"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."enqueue_canteen_close_job"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'net', 'extensions'
    AS $$
DECLARE
  v_job_id uuid;
  v_url text;
  v_secret text;
  v_headers jsonb;
BEGIN
  IF TG_OP <> 'UPDATE' THEN
    RETURN NEW;
  END IF;

  IF COALESCE(OLD.is_open, false) IS TRUE
     AND COALESCE(NEW.is_open, false) IS FALSE THEN
    INSERT INTO public.canteen_close_jobs (canteen_id, status)
    VALUES (NEW.id, 'pending')
    RETURNING id INTO v_job_id;

    BEGIN
      v_url := rtrim(public.hungertap_project_url(), '/')
        || '/functions/v1/process-canteen-close';
      v_secret := public.hungertap_webhook_secret();
      v_headers := jsonb_build_object('Content-Type', 'application/json');
      IF v_secret IS NOT NULL AND length(v_secret) > 0 THEN
        v_headers := v_headers || jsonb_build_object('x-hungertap-webhook-secret', v_secret);
      END IF;

      PERFORM net.http_post(
        url := v_url,
        headers := v_headers,
        body := jsonb_build_object(
          'job_id', v_job_id,
          'canteen_id', NEW.id
        ),
        timeout_milliseconds := 5000
      );
    EXCEPTION WHEN OTHERS THEN
      RAISE WARNING 'enqueue_canteen_close_job notify failed: %', SQLERRM;
    END;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."enqueue_canteen_close_job"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."ensure_refund_for_order"("p_order_id" "uuid", "p_reason" "text" DEFAULT 'Vendor cancelled order'::"text", "p_amount" numeric DEFAULT NULL::numeric) RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_order public.orders%ROWTYPE;
  v_payment public.payments%ROWTYPE;
  v_refund_id uuid;
  v_email text;
  v_refund_amount numeric(12,2);
  v_now timestamptz := NOW();
  v_gateway text;
  v_jwt_role text;
  v_user_role text;
  v_my_canteen uuid;
  v_close text;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_id_required');
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
  END IF;

  BEGIN
    v_jwt_role := coalesce(
      current_setting('request.jwt.claim.role', true),
      (current_setting('request.jwt.claims', true)::jsonb->>'role')
    );
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  BEGIN
    v_close := current_setting('hungertap.close_cleanup', true);
  EXCEPTION WHEN OTHERS THEN
    v_close := NULL;
  END;

  IF v_jwt_role IS DISTINCT FROM 'service_role'
     AND coalesce(v_close, '') IS DISTINCT FROM '1'
     AND session_user NOT IN ('postgres', 'supabase_admin')
  THEN
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
    END IF;
    SELECT role, canteen_id INTO v_user_role, v_my_canteen FROM public.users WHERE id = auth.uid();
    IF v_user_role IS DISTINCT FROM 'canteen_admin' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_canteen_admin');
    END IF;
    IF v_my_canteen IS DISTINCT FROM v_order.canteen_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'wrong_canteen');
    END IF;
  END IF;

  SELECT * INTO v_payment
  FROM public.payments
  WHERE order_id = p_order_id
    AND status IN ('success', 'refund_pending', 'refund_failed')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'refund_required', false, 'reason', 'no_refundable_payment');
  END IF;

  IF v_payment.gateway_payment_id IS NULL OR length(trim(v_payment.gateway_payment_id)) = 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'payment_missing_gateway_id', 'payment_id', v_payment.id);
  END IF;

  v_gateway := lower(trim(v_payment.gateway_name));

  IF p_amount IS NOT NULL AND p_amount > 0 THEN
    v_refund_amount := round(p_amount::numeric, 2);
  ELSE
    SELECT COALESCE(SUM(line_total), 0) INTO v_refund_amount
    FROM public.order_items
    WHERE order_id = p_order_id AND status = 'cancelled_by_vendor';
    IF v_refund_amount <= 0 THEN
      v_refund_amount := COALESCE(v_payment.amount, v_order.total_amount, 0);
    END IF;
  END IF;

  IF v_refund_amount <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'refund_required', false, 'reason', 'zero_amount');
  END IF;

  SELECT au.email INTO v_email FROM auth.users au WHERE au.id = v_order.placed_by;

  UPDATE public.payments
  SET status = 'refund_pending', updated_at = v_now
  WHERE id = v_payment.id AND status IS DISTINCT FROM 'refunded';

  SELECT r.id INTO v_refund_id FROM public.refunds r WHERE r.payment_id = v_payment.id LIMIT 1;

  IF v_refund_id IS NULL THEN
    INSERT INTO public.refunds (
      order_id, payment_id, amount, status, reason, retry_count, customer_email, gateway_name
    ) VALUES (
      p_order_id, v_payment.id, v_refund_amount, 'initiated',
      COALESCE(NULLIF(trim(p_reason), ''), 'Vendor cancelled order'), 0, v_email, v_gateway
    )
    RETURNING id INTO v_refund_id;
  ELSE
    UPDATE public.refunds
    SET customer_email = COALESCE(customer_email, v_email),
        amount = COALESCE(NULLIF(amount, 0), v_refund_amount),
        reason = COALESCE(reason, p_reason),
        gateway_name = COALESCE(gateway_name, v_gateway)
    WHERE id = v_refund_id AND status IS DISTINCT FROM 'success';
  END IF;

  RETURN jsonb_build_object(
    'ok', true, 'refund_required', true, 'refund_id', v_refund_id,
    'payment_id', v_payment.id, 'order_id', p_order_id, 'amount', v_refund_amount
  );
END;
$$;


ALTER FUNCTION "public"."ensure_refund_for_order"("p_order_id" "uuid", "p_reason" "text", "p_amount" numeric) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."expire_stale_payments"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_now timestamptz := NOW();
  v_expired_count int := 0;
BEGIN
  WITH target_payments AS (
    SELECT p.id, p.order_id
    FROM public.payments p
    WHERE p.status = 'initiated'
      AND p.created_at < (v_now - INTERVAL '10 minutes')
    ORDER BY p.created_at ASC
    LIMIT 500
    FOR UPDATE OF p SKIP LOCKED
  ),
  locked_orders AS (
    SELECT o.id
    FROM public.orders o
    JOIN target_payments tp ON o.id = tp.order_id
    WHERE o.status = 'pending_payment'
    FOR UPDATE OF o SKIP LOCKED
  ),
  expired_payments AS (
    UPDATE public.payments p
    SET status = 'failed',
        updated_at = v_now
    FROM locked_orders lo
    JOIN target_payments tp ON tp.order_id = lo.id
    WHERE p.id = tp.id
      AND p.status = 'initiated'
    RETURNING p.id, tp.order_id
  ),
  master_updates AS (
    UPDATE public.orders o
    SET status = 'payment_failed',
        updated_at = v_now
    FROM expired_payments ep
    WHERE o.id = ep.order_id
      AND o.status = 'pending_payment'
    RETURNING o.id
  )
  SELECT COUNT(*) INTO v_expired_count FROM master_updates;

  UPDATE public.order_items oi
  SET status = 'payment_failed',
      updated_at = v_now
  FROM public.orders o
  WHERE oi.order_id = o.id
    AND o.status = 'payment_failed'
    AND oi.status = 'pending_payment';

  IF v_expired_count > 0 THEN
    RAISE LOG '[PAYMENT_CRON] EXPIRED_ORDERS: count=%', v_expired_count;
  END IF;

  RETURN jsonb_build_object(
    'success', true,
    'expired_orders', v_expired_count,
    'at', v_now
  );
END;
$$;


ALTER FUNCTION "public"."expire_stale_payments"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_daily_order_token_v2"("p_canteen_id" "uuid", "p_canteen_tz" "text" DEFAULT 'Asia/Kolkata'::"text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $_$
DECLARE
  v_token_date date;
  v_next int;
BEGIN
  IF p_canteen_id IS NULL THEN
    RAISE EXCEPTION 'canteen_id required';
  END IF;

  v_token_date := (NOW() AT TIME ZONE coalesce(nullif(btrim(p_canteen_tz), ''), 'Asia/Kolkata'))::date;

  -- Seed once per canteen/day from max across live + archive + failed, then bump atomically.
  INSERT INTO public.canteen_daily_token_counters (canteen_id, token_date, next_token)
  SELECT
    p_canteen_id,
    v_token_date,
    COALESCE(MAX(tok), 1000) + 1
  FROM (
    SELECT order_token::int AS tok
    FROM public.orders
    WHERE canteen_id = p_canteen_id
      AND token_date = v_token_date
      AND order_token ~ '^[0-9]{4,5}$'
      AND order_token::int BETWEEN 1001 AND 99999
    UNION ALL
    SELECT order_token::int
    FROM public.archived_orders
    WHERE canteen_id = p_canteen_id
      AND token_date = v_token_date
      AND order_token ~ '^[0-9]{4,5}$'
      AND order_token::int BETWEEN 1001 AND 99999
    UNION ALL
    SELECT order_token::int
    FROM public.failed_orders
    WHERE canteen_id = p_canteen_id
      AND token_date = v_token_date
      AND order_token ~ '^[0-9]{4,5}$'
      AND order_token::int BETWEEN 1001 AND 99999
  ) s
  ON CONFLICT (canteen_id, token_date) DO NOTHING;

  UPDATE public.canteen_daily_token_counters
  SET next_token = next_token + 1
  WHERE canteen_id = p_canteen_id
    AND token_date = v_token_date
  RETURNING next_token - 1 INTO v_next;

  IF v_next IS NULL THEN
    RAISE EXCEPTION 'Token counter missing for canteen % date %', p_canteen_id, v_token_date;
  END IF;

  IF v_next < 1001 THEN
    v_next := 1001;
  END IF;

  IF v_next > 99999 THEN
    RAISE EXCEPTION 'Daily order token limit reached (max 99999). Contact support.';
  END IF;

  RETURN v_next::text;
END;
$_$;


ALTER FUNCTION "public"."generate_daily_order_token_v2"("p_canteen_id" "uuid", "p_canteen_tz" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."generate_unique_barcode_v2"("p_canteen_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_prefix   TEXT;
  v_random8  TEXT;
  v_barcode  TEXT;
  v_exists   BOOLEAN;
  v_attempts INT := 0;
BEGIN
  -- First 4 characters of canteen_id
  v_prefix := substring(p_canteen_id::text from 1 for 4);
  
  LOOP
    -- 8 unpredictable digits (from 10000000 to 99999999)
    v_random8 := lpad((10000000 + floor(random() * 90000000))::bigint::text, 8, '0');
    v_barcode := v_prefix || v_random8;

    SELECT EXISTS (SELECT 1 FROM public.orders WHERE barcode = v_barcode) INTO v_exists;
    EXIT WHEN NOT v_exists;

    v_attempts := v_attempts + 1;
    IF v_attempts > 100 THEN
      RAISE LOG '[ORDER_V2] BARCODE_TIMEOUT: 100 collision attempts exhausted';
      RAISE EXCEPTION 'Barcode generation timeout';
    END IF;
  END LOOP;

  RETURN v_barcode;
END;
$$;


ALTER FUNCTION "public"."generate_unique_barcode_v2"("p_canteen_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_cds_aggregated_items"("p_canteen_id" "uuid") RETURNS TABLE("item_id" "uuid", "item_name" "text", "total_quantity" bigint, "order_count" bigint)
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
  SELECT
    oi.item_id,
    COALESCE(MAX(i.name), 'Item')::text AS item_name,
    SUM(oi.quantity)::bigint AS total_quantity,
    COUNT(DISTINCT oi.order_id)::bigint AS order_count
  FROM public.order_items oi
  JOIN public.orders o ON o.id = oi.order_id
  LEFT JOIN public.items i ON i.id = oi.item_id
  WHERE o.canteen_id = p_canteen_id
    AND o.status = ANY (ARRAY['preparing'::text, 'partially_ready'::text, 'ready'::text])
    AND oi.status = ANY (ARRAY['preparing'::text, 'ready'::text])
  GROUP BY oi.item_id
  ORDER BY SUM(oi.quantity) DESC;
$$;


ALTER FUNCTION "public"."get_cds_aggregated_items"("p_canteen_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_delivered_revenue_aggregate"("p_canteen_id" "uuid", "p_from" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_to" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_order_type" "text" DEFAULT NULL::"text") RETURNS TABLE("total_revenue" numeric, "order_count" bigint, "line_count" bigint)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  WITH live_orders AS (
    SELECT o.id
    FROM public.orders o
    WHERE o.canteen_id = p_canteen_id
      AND o.status = 'delivered'
      AND (p_from IS NULL OR COALESCE(o.updated_at, o.created_at) >= p_from)
      AND (p_to IS NULL OR COALESCE(o.updated_at, o.created_at) <= p_to)
      AND (
        p_order_type IS NULL OR trim(p_order_type) = ''
        OR (lower(trim(p_order_type)) = 'takeaway' AND o.is_takeaway IS TRUE)
        OR (lower(trim(p_order_type)) = 'dine_in' AND (o.is_takeaway IS FALSE OR o.is_takeaway IS NULL))
      )
  ),
  live_lines AS (
    SELECT oi.order_id,
      COALESCE(oi.line_total, oi.unit_price * oi.quantity, 0)::numeric AS line_amt
    FROM public.order_items oi
    INNER JOIN live_orders d ON d.id = oi.order_id
    WHERE oi.status = 'delivered'
  ),
  arch_orders AS (
    SELECT ao.id
    FROM public.archived_orders ao
    WHERE ao.canteen_id = p_canteen_id
      AND ao.status = 'delivered'
      AND (p_from IS NULL OR COALESCE(ao.updated_at, ao.archived_at, ao.created_at) >= p_from)
      AND (p_to IS NULL OR COALESCE(ao.updated_at, ao.archived_at, ao.created_at) <= p_to)
      AND (
        p_order_type IS NULL OR trim(p_order_type) = ''
        OR (lower(trim(p_order_type)) = 'takeaway' AND ao.is_takeaway IS TRUE)
        OR (lower(trim(p_order_type)) = 'dine_in' AND (ao.is_takeaway IS FALSE OR ao.is_takeaway IS NULL))
      )
  ),
  arch_lines AS (
    SELECT aoi.order_id,
      COALESCE(aoi.total_amount, aoi.line_total, aoi.unit_price * aoi.quantity, 0)::numeric AS line_amt
    FROM public.archived_order_items aoi
    INNER JOIN arch_orders d ON d.id = aoi.order_id
  ),
  all_lines AS (
    SELECT * FROM live_lines
    UNION ALL
    SELECT * FROM arch_lines
  )
  SELECT
    COALESCE(SUM(line_amt), 0)::numeric,
    COUNT(DISTINCT order_id)::bigint,
    COUNT(*)::bigint
  FROM all_lines;
$$;


ALTER FUNCTION "public"."get_delivered_revenue_aggregate"("p_canteen_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_order_type" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_delivered_revenue_aggregate"("p_canteen_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_order_type" "text") IS 'Delivered revenue from live order_items plus archieved_order_items after canteen-close cleanup.';



CREATE OR REPLACE FUNCTION "public"."get_kitchen_cards"("p_canteen_id" "uuid" DEFAULT NULL::"uuid") RETURNS TABLE("item_id" "text", "item_name" "text", "suggested_quantity" integer, "pending_quantity" integer, "batch_size" integer, "oldest_waiting_at" timestamp with time zone)
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public'
    AS $$
  WITH queue AS (
    SELECT
      oi.item_id::text AS item_id,
      COALESCE(NULLIF(oi.item_name, ''), i.name, 'Unknown Item') AS item_name,
      GREATEST(COALESCE(i.batch_size, 10), 1) AS batch_size,
      GREATEST(oi.quantity - COALESCE(oi.ready_count, 0), 0) AS remaining,
      oi.created_at,
      oi.id AS order_item_id
    FROM public.order_items oi
    INNER JOIN public.orders o ON o.id = oi.order_id
    LEFT JOIN public.items i ON i.id = oi.item_id
    WHERE oi.status IN ('pending', 'preparing')
      AND GREATEST(oi.quantity - COALESCE(oi.ready_count, 0), 0) > 0
      AND (p_canteen_id IS NULL OR o.canteen_id = p_canteen_id)
  ),
  aggregated AS (
    SELECT
      q.item_id,
      MIN(q.item_name) AS item_name,
      MAX(q.batch_size) AS batch_size,
      SUM(q.remaining)::integer AS pending_quantity,
      MIN(q.created_at) AS oldest_waiting_at,
      array_agg(q.remaining ORDER BY q.created_at ASC, q.order_item_id ASC) AS remainings
    FROM queue q
    GROUP BY q.item_id
  )
  SELECT
    a.item_id,
    a.item_name,
    public.kitchen_suggested_quantity(a.batch_size, a.remainings) AS suggested_quantity,
    a.pending_quantity,
    a.batch_size,
    a.oldest_waiting_at
  FROM aggregated a
  ORDER BY
    a.oldest_waiting_at ASC NULLS LAST,
    a.pending_quantity DESC,
    a.item_name ASC;
$$;


ALTER FUNCTION "public"."get_kitchen_cards"("p_canteen_id" "uuid") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."get_kitchen_cards"("p_canteen_id" "uuid") IS 'Read-only kitchen panel cards. Called by CDS frontend on load/realtime/poll. Remaining = quantity - ready_count.';



CREATE OR REPLACE FUNCTION "public"."get_minimum_supported_app_version"("p_platform" "text" DEFAULT 'android'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_college_id uuid;
  v_min text;
BEGIN
  -- Single min_app_version for both platforms; p_platform kept for API compatibility.
  v_college_id := public.get_my_college_id();
  IF v_college_id IS NULL THEN
    -- Before login / no college: do not force-update (per-college policy needs identity).
    RETURN jsonb_build_object(
      'minimum_version', '0.0.0',
      'source', 'no_college',
      'platform', lower(coalesce(nullif(btrim(p_platform), ''), 'android'))
    );
  END IF;

  SELECT COALESCE(NULLIF(btrim(c.min_app_version), ''), '0.0.0')
  INTO v_min
  FROM public.colleges c
  WHERE c.id = v_college_id
    AND c.is_deleted IS NOT TRUE;

  RETURN jsonb_build_object(
    'minimum_version', COALESCE(v_min, '0.0.0'),
    'college_id', v_college_id,
    'source', 'college',
    'platform', lower(coalesce(nullif(btrim(p_platform), ''), 'android'))
  );
END;
$$;


ALTER FUNCTION "public"."get_minimum_supported_app_version"("p_platform" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_canteen_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT canteen_id
  FROM public.users
  WHERE id = auth.uid();
$$;


ALTER FUNCTION "public"."get_my_canteen_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_college_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT college_id
  FROM public.users
  WHERE id = auth.uid();
$$;


ALTER FUNCTION "public"."get_my_college_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_role"() RETURNS "text"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT role FROM public.users WHERE id = auth.uid();
$$;


ALTER FUNCTION "public"."get_my_role"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_my_user_id"() RETURNS "uuid"
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT auth.uid();
$$;


ALTER FUNCTION "public"."get_my_user_id"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."get_order_barcode_for_reprint"("p_order_id" "uuid") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_canteen uuid;
  v_barcode text;
  v_order_canteen uuid;
  v_placed_role text;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT u.role::text, u.canteen_id INTO v_role, v_canteen FROM public.users u WHERE u.id = v_uid;
  IF v_role IS DISTINCT FROM 'canteen_admin' THEN
    RAISE EXCEPTION 'Only canteen admin can reprint receipts';
  END IF;
  SELECT o.barcode::text, o.canteen_id, o.placed_by_role::text
  INTO v_barcode, v_order_canteen, v_placed_role
  FROM public.orders o WHERE o.id = p_order_id;
  IF NOT FOUND THEN RETURN NULL; END IF;
  IF v_canteen IS NOT NULL AND v_order_canteen IS DISTINCT FROM v_canteen THEN
    RAISE EXCEPTION 'Order is not in your canteen';
  END IF;
  IF v_placed_role IS DISTINCT FROM 'canteen_admin' THEN
    RAISE EXCEPTION 'Reprint is only available for admin-placed orders';
  END IF;
  RETURN NULLIF(btrim(v_barcode), '');
END;
$$;


ALTER FUNCTION "public"."get_order_barcode_for_reprint"("p_order_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."handle_close_college"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.is_deleted IS TRUE
     AND OLD.is_deleted IS DISTINCT FROM TRUE
  THEN
    UPDATE public.canteens
    SET
      is_open = false,
      is_active = false,
      is_deleted = true
    WHERE college_id = NEW.id
      AND (
        is_open IS TRUE
        OR is_active IS TRUE
        OR is_deleted IS FALSE
      );
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."handle_close_college"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."hungertap_in_close_cleanup"() RETURNS boolean
    LANGUAGE "sql" STABLE
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
  SELECT COALESCE(nullif(current_setting('hungertap.close_cleanup', true), ''), '') = '1';
$$;


ALTER FUNCTION "public"."hungertap_in_close_cleanup"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."hungertap_project_url"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private', 'pg_temp'
    AS $$
  SELECT coalesce(
    (
      SELECT NULLIF(c.value, '')
      FROM private.hungertap_config c
      WHERE c.key = 'supabase_url'
      LIMIT 1
    ),
    'https://mgyfyutxtapgggcwkknw.supabase.co'
  );
$$;


ALTER FUNCTION "public"."hungertap_project_url"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."hungertap_webhook_secret"() RETURNS "text"
    LANGUAGE "sql" STABLE SECURITY DEFINER
    SET "search_path" TO 'public', 'private', 'pg_temp'
    AS $$
  SELECT NULLIF(c.value, '')
  FROM private.hungertap_config c
  WHERE c.key = 'hungertap_webhook_secret'
  LIMIT 1;
$$;


ALTER FUNCTION "public"."hungertap_webhook_secret"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."insert_order_and_items_v2"("p_order_id" "uuid", "p_canteen_id" "uuid", "p_placed_by" "uuid", "p_placed_by_role" "text", "p_order_token" "text", "p_barcode" "text", "p_is_takeaway" boolean, "p_total_amount" numeric, "p_items" "jsonb", "p_takeaway_charge" numeric, OUT "p_order_status" "text") RETURNS "text"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  c_beverage_category_id CONSTANT UUID := '728f2bff-1065-400e-9885-bcc9a8d1e491'::UUID;
  v_reserved_item_count  INT;
  v_expected_item_count  INT;
  v_ok_item_count        INT;
  v_inserted_item_rows   INT;
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
    AND i.canteen_id = p_canteen_id;

  GET DIAGNOSTICS v_inserted_item_rows = ROW_COUNT;

  IF v_inserted_item_rows <> v_expected_item_count THEN
    RAISE EXCEPTION 'Failed to create order line items. Please refresh and try again.';
  END IF;

  IF p_placed_by_role = 'canteen_admin' THEN
    p_order_status := public.compute_order_status_from_items(p_order_id);
    UPDATE public.orders SET status = p_order_status WHERE id = p_order_id;
  END IF;

END;
$$;


ALTER FUNCTION "public"."insert_order_and_items_v2"("p_order_id" "uuid", "p_canteen_id" "uuid", "p_placed_by" "uuid", "p_placed_by_role" "text", "p_order_token" "text", "p_barcode" "text", "p_is_takeaway" boolean, "p_total_amount" numeric, "p_items" "jsonb", "p_takeaway_charge" numeric, OUT "p_order_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."invoke_purge_deleted_users"() RETURNS bigint
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'net', 'extensions'
    AS $$
DECLARE
  v_url text;
  v_secret text;
  v_headers jsonb;
  v_request_id bigint;
BEGIN
  v_url := rtrim(public.hungertap_project_url(), '/')
    || '/functions/v1/purge-deleted-users';
  v_secret := public.hungertap_webhook_secret();
  v_headers := jsonb_build_object('Content-Type', 'application/json');
  IF v_secret IS NOT NULL AND length(v_secret) > 0 THEN
    v_headers := v_headers || jsonb_build_object('x-hungertap-webhook-secret', v_secret);
  END IF;

  SELECT net.http_post(
    url := v_url,
    headers := v_headers,
    body := '{}'::jsonb,
    timeout_milliseconds := 60000
  ) INTO v_request_id;

  RETURN v_request_id;
END;
$$;


ALTER FUNCTION "public"."invoke_purge_deleted_users"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."kitchen_suggested_quantity"("p_batch_size" integer, "p_remainings" integer[]) RETURNS integer
    LANGUAGE "plpgsql" IMMUTABLE
    SET "search_path" TO 'public'
    AS $$
DECLARE
  oldest integer;
  suggested integer := 0;
  qty integer;
BEGIN
  IF p_batch_size IS NULL OR p_batch_size < 1 THEN
    RETURN 0;
  END IF;

  IF p_remainings IS NULL OR cardinality(p_remainings) = 0 THEN
    RETURN 0;
  END IF;

  oldest := p_remainings[1];

  -- Oldest order alone fills (or exceeds) one batch: cook exactly one batch.
  IF oldest >= p_batch_size THEN
    RETURN p_batch_size;
  END IF;

  -- Pack complete oldest orders without exceeding batch size.
  FOREACH qty IN ARRAY p_remainings LOOP
    IF suggested + qty > p_batch_size THEN
      EXIT;
    END IF;
    suggested := suggested + qty;
  END LOOP;

  RETURN suggested;
END;
$$;


ALTER FUNCTION "public"."kitchen_suggested_quantity"("p_batch_size" integer, "p_remainings" integer[]) OWNER TO "postgres";


COMMENT ON FUNCTION "public"."kitchen_suggested_quantity"("p_batch_size" integer, "p_remainings" integer[]) IS 'Internal FIFO helper used only by get_kitchen_cards. Do not call from app clients.';



CREATE OR REPLACE FUNCTION "public"."list_my_orders_page"("p_limit" integer DEFAULT 10, "p_before_created_at" timestamp with time zone DEFAULT NULL::timestamp with time zone, "p_before_id" "uuid" DEFAULT NULL::"uuid", "p_status" "text" DEFAULT NULL::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_limit int := LEAST(GREATEST(COALESCE(p_limit, 10), 1), 50);
  v_status text := lower(trim(COALESCE(p_status, '')));
  v_orders jsonb := '[]'::jsonb;
  v_has_more boolean := false;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'not_authenticated',
      'orders', '[]'::jsonb,
      'has_more', false
    );
  END IF;

  IF v_status IN ('', 'all') THEN
    v_status := NULL;
  ELSIF v_status NOT IN (
    'preparing',
    'partially_ready',
    'ready',
    'delivered',
    'pickup_failed',
    'cancelled_by_vendor',
    'payment_failed'
  ) THEN
    RETURN jsonb_build_object(
      'success', true,
      'orders', '[]'::jsonb,
      'has_more', false,
      'limit', v_limit,
      'status', p_status
    );
  END IF;

  WITH unioned AS (
    SELECT
      o.id,
      o.created_at,
      o.updated_at,
      o.status,
      o.canteen_id,
      o.placed_by,
      o.order_token,
      o.is_takeaway,
      o.total_amount,
      'live'::text AS history_source
    FROM public.orders o
    WHERE o.placed_by = v_uid
      AND o.status IS DISTINCT FROM 'pending_payment'

    UNION ALL

    SELECT
      a.id,
      a.created_at,
      a.updated_at,
      a.status,
      a.canteen_id,
      a.placed_by,
      a.order_token,
      a.is_takeaway,
      a.total_amount,
      'archived'::text AS history_source
    FROM public.archived_orders a
    WHERE a.placed_by = v_uid

    UNION ALL

    SELECT
      f.id,
      f.created_at,
      f.updated_at,
      f.status,
      f.canteen_id,
      f.placed_by,
      f.order_token,
      f.is_takeaway,
      f.total_amount,
      'failed'::text AS history_source
    FROM public.failed_orders f
    WHERE f.placed_by = v_uid
  ),
  deduped AS (
    SELECT *
    FROM (
      SELECT
        u.*,
        row_number() OVER (
          PARTITION BY u.id
          ORDER BY CASE u.history_source
            WHEN 'live' THEN 0
            WHEN 'archived' THEN 1
            ELSE 2
          END
        ) AS src_rank
      FROM unioned u
    ) s
    WHERE s.src_rank = 1
  ),
  status_matched AS (
    SELECT d.*
    FROM deduped d
    WHERE
      v_status IS NULL
      OR (
        CASE v_status
          WHEN 'delivered' THEN d.status IN ('delivered', 'completed')
          WHEN 'payment_failed' THEN d.status IN ('payment_failed', 'failed', 'payment_cancelled')
          WHEN 'cancelled_by_vendor' THEN (
            d.status = 'cancelled'
            OR d.status LIKE 'cancelled_by%'
          )
          ELSE d.status = v_status
        END
      )
  ),
  filtered AS (
    SELECT s.*
    FROM status_matched s
    WHERE
      p_before_created_at IS NULL
      OR s.created_at < p_before_created_at
      OR (s.created_at = p_before_created_at AND p_before_id IS NOT NULL AND s.id < p_before_id)
    ORDER BY s.created_at DESC, s.id DESC
    LIMIT v_limit + 1
  ),
  page AS (
    SELECT f.*
    FROM filtered f
    ORDER BY f.created_at DESC, f.id DESC
    LIMIT v_limit
  )
  SELECT
    COALESCE(
      jsonb_agg(
        jsonb_build_object(
          'id', p.id,
          'order_id', p.id,
          'created_at', p.created_at,
          'updated_at', p.updated_at,
          'status', p.status,
          'canteen_id', p.canteen_id,
          'placed_by', p.placed_by,
          'order_token', p.order_token,
          'is_takeaway', p.is_takeaway,
          'total_amount', p.total_amount,
          '_historySource', p.history_source,
          'canteens', (
            SELECT jsonb_build_object('name', c.name)
            FROM public.canteens c
            WHERE c.id = p.canteen_id
          )
        )
        ORDER BY p.created_at DESC, p.id DESC
      ),
      '[]'::jsonb
    ),
    (SELECT COUNT(*) > v_limit FROM filtered)
  INTO v_orders, v_has_more
  FROM page p;

  RETURN jsonb_build_object(
    'success', true,
    'orders', COALESCE(v_orders, '[]'::jsonb),
    'has_more', COALESCE(v_has_more, false),
    'limit', v_limit,
    'status', COALESCE(v_status, 'all')
  );
END;
$$;


ALTER FUNCTION "public"."list_my_orders_page"("p_limit" integer, "p_before_created_at" timestamp with time zone, "p_before_id" "uuid", "p_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."list_users_due_for_auth_purge"("p_limit" integer DEFAULT 100) RETURNS TABLE("user_id" "uuid", "deleted_at" timestamp with time zone)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF COALESCE(auth.role(), '') IS DISTINCT FROM 'service_role'
     AND current_user NOT IN ('postgres', 'supabase_admin')
  THEN
    RAISE EXCEPTION 'not authorized';
  END IF;

  RETURN QUERY
  SELECT u.id, u.deleted_at
  FROM public.users u
  WHERE u.is_deleted IS TRUE
    AND u.deleted_at IS NOT NULL
    AND u.deleted_at <= (now() - interval '7 days')
  ORDER BY u.deleted_at ASC
  LIMIT GREATEST(COALESCE(p_limit, 100), 1);
END;
$$;


ALTER FUNCTION "public"."list_users_due_for_auth_purge"("p_limit" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."lookup_canteen_for_signup"("p_query" "text") RETURNS TABLE("id" "uuid", "name" "text", "college_id" "uuid", "is_open" boolean)
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_q text := btrim(coalesce(p_query, ''));
  v_safe text;
  v_lower text;
  v_uuid uuid;
  v_count int;
BEGIN
  IF v_q = '' THEN
    RETURN;
  END IF;

  -- UUID lookup
  BEGIN
    v_uuid := v_q::uuid;
  EXCEPTION WHEN invalid_text_representation THEN
    v_uuid := NULL;
  END;

  IF v_uuid IS NOT NULL THEN
    RETURN QUERY
    SELECT c.id, c.name, c.college_id, c.is_open
    FROM public.canteens c
    WHERE c.id = v_uuid
      AND c.is_active IS TRUE
      AND c.is_deleted IS FALSE;
    RETURN;
  END IF;

  v_safe := regexp_replace(v_q, '[%_\\]', ' ', 'g');
  v_safe := btrim(regexp_replace(v_safe, '\s+', ' ', 'g'));
  IF v_safe = '' THEN
    RETURN;
  END IF;
  v_lower := lower(v_safe);

  -- Exact name (case-insensitive), unique
  SELECT count(*) INTO v_count
  FROM public.canteens c
  WHERE c.is_active IS TRUE
    AND c.is_deleted IS FALSE
    AND lower(btrim(c.name)) = v_lower;

  IF v_count = 1 THEN
    RETURN QUERY
    SELECT c.id, c.name, c.college_id, c.is_open
    FROM public.canteens c
    WHERE c.is_active IS TRUE
      AND c.is_deleted IS FALSE
      AND lower(btrim(c.name)) = v_lower
    LIMIT 1;
    RETURN;
  END IF;

  IF v_count > 1 THEN
    RETURN; -- ambiguous
  END IF;

  -- Unique prefix
  SELECT count(*) INTO v_count
  FROM public.canteens c
  WHERE c.is_active IS TRUE
    AND c.is_deleted IS FALSE
    AND lower(btrim(c.name)) LIKE v_lower || '%';

  IF v_count = 1 THEN
    RETURN QUERY
    SELECT c.id, c.name, c.college_id, c.is_open
    FROM public.canteens c
    WHERE c.is_active IS TRUE
      AND c.is_deleted IS FALSE
      AND lower(btrim(c.name)) LIKE v_lower || '%'
    LIMIT 1;
    RETURN;
  END IF;

  IF v_count > 1 THEN
    RETURN; -- ambiguous
  END IF;

  -- Unique substring
  SELECT count(*) INTO v_count
  FROM public.canteens c
  WHERE c.is_active IS TRUE
    AND c.is_deleted IS FALSE
    AND lower(c.name) LIKE '%' || v_lower || '%';

  IF v_count = 1 THEN
    RETURN QUERY
    SELECT c.id, c.name, c.college_id, c.is_open
    FROM public.canteens c
    WHERE c.is_active IS TRUE
      AND c.is_deleted IS FALSE
      AND lower(c.name) LIKE '%' || v_lower || '%'
    LIMIT 1;
  END IF;
  -- 0 or >1 → no row (not found / ambiguous)
END;
$$;


ALTER FUNCTION "public"."lookup_canteen_for_signup"("p_query" "text") OWNER TO "postgres";


COMMENT ON FUNCTION "public"."lookup_canteen_for_signup"("p_query" "text") IS 'Signup canteen resolve (anon-safe). Returns at most one active, non-deleted canteen. Prefer over direct anon SELECT on canteens; table anon policy kept temporarily for fixed-id signup.';



CREATE OR REPLACE FUNCTION "public"."notify_push_on_notification"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'net', 'pg_temp'
    AS $$
DECLARE
  v_url text := rtrim(public.hungertap_project_url(), '/') || '/functions/v1/hyper-function';
  v_secret text := public.hungertap_webhook_secret();
  v_headers jsonb;
BEGIN
  BEGIN
    v_headers := jsonb_build_object('Content-Type', 'application/json');
    IF v_secret IS NOT NULL THEN
      v_headers := v_headers || jsonb_build_object('x-hungertap-webhook-secret', v_secret);
    END IF;

    -- pg_net waits only to enqueue the HTTP call, not for FCM delivery.
    -- 2000ms is enough to accept; longer values stall the DB transaction.
    PERFORM net.http_post(
      url := v_url,
      body := jsonb_build_object(
        'type', TG_OP,
        'table', TG_TABLE_NAME,
        'schema', TG_TABLE_SCHEMA,
        'record', to_jsonb(NEW),
        'old_record', NULL
      ),
      params := '{}'::jsonb,
      headers := v_headers,
      timeout_milliseconds := 2000
    );
  EXCEPTION
    WHEN OTHERS THEN
      RAISE WARNING '[notify_push_on_notification] push enqueue failed: %', SQLERRM;
  END;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_push_on_notification"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_refund_edge"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'net', 'pg_temp'
    AS $$
DECLARE
  v_url text := rtrim(public.hungertap_project_url(), '/') || '/functions/v1/retry-refund';
  v_timeout int := 15000;
  v_should_call boolean := false;
  v_secret text := public.hungertap_webhook_secret();
  v_headers jsonb;
BEGIN
  IF TG_OP = 'INSERT' THEN
    v_should_call := (NEW.status = 'initiated');
  ELSIF TG_OP = 'UPDATE' THEN
    v_should_call := (
      (NEW.status = 'initiated' AND OLD.status IS DISTINCT FROM 'initiated')
      OR (
        NEW.status = 'failed'
        AND COALESCE(NEW.retry_count, 0) < 3
        AND COALESCE(NEW.retry_count, 0) > COALESCE(OLD.retry_count, 0)
      )
    );
  END IF;

  IF v_should_call THEN
    v_headers := jsonb_build_object('Content-Type', 'application/json');
    IF v_secret IS NOT NULL THEN
      v_headers := v_headers || jsonb_build_object('x-hungertap-webhook-secret', v_secret);
    END IF;

    PERFORM net.http_post(
      url := v_url,
      body := jsonb_build_object(
        'refund_id', NEW.id,
        'source', 'db_refund_webhook',
        'op', TG_OP
      ),
      params := '{}'::jsonb,
      headers := v_headers,
      timeout_milliseconds := v_timeout
    );
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."notify_refund_edge"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."notify_sync_canteen_cache"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'net', 'pg_temp'
    AS $$
DECLARE
  v_url text := rtrim(public.hungertap_project_url(), '/') || '/functions/v1/sync-canteen-cache';
  v_secret text := public.hungertap_webhook_secret();
  v_headers jsonb;
  v_timeout int := 5000;
  v_skip boolean := false;
BEGIN
  IF TG_TABLE_NAME = 'items' AND TG_OP = 'UPDATE' THEN
    -- Skip when menu-relevant fields (incl. is_available) are unchanged
    IF NEW.is_available IS NOT DISTINCT FROM OLD.is_available
       AND NEW.name IS NOT DISTINCT FROM OLD.name
       AND NEW.price IS NOT DISTINCT FROM OLD.price
       AND NEW.category_id IS NOT DISTINCT FROM OLD.category_id
       AND NEW.image_url IS NOT DISTINCT FROM OLD.image_url
       AND NEW.is_active IS NOT DISTINCT FROM OLD.is_active
       AND NEW.is_deleted IS NOT DISTINCT FROM OLD.is_deleted
       AND NEW.is_vegetarian IS NOT DISTINCT FROM OLD.is_vegetarian
       AND NEW.description IS NOT DISTINCT FROM OLD.description
       AND NEW.ingredients IS NOT DISTINCT FROM OLD.ingredients
       AND NEW.canteen_id IS NOT DISTINCT FROM OLD.canteen_id
    THEN
      v_skip := true;
    END IF;
  END IF;

  IF NOT v_skip THEN
    v_headers := jsonb_build_object('Content-Type', 'application/json');
    IF v_secret IS NOT NULL THEN
      v_headers := v_headers || jsonb_build_object('x-hungertap-webhook-secret', v_secret);
    END IF;

    PERFORM net.http_post(
      url := v_url,
      body := jsonb_build_object(
        'type', TG_OP,
        'table', TG_TABLE_NAME,
        'schema', TG_TABLE_SCHEMA,
        'record', CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE to_jsonb(NEW) END,
        'old_record', CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE to_jsonb(OLD) END
      ),
      params := '{}'::jsonb,
      headers := v_headers,
      timeout_milliseconds := v_timeout
    );
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."notify_sync_canteen_cache"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prevent_notification_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'extensions'
    AS $$
BEGIN
  -- Allow only is_read to change
  IF NEW.is_read IS DISTINCT FROM OLD.is_read THEN
    
    -- check other fields unchanged
    IF NEW.title IS DISTINCT FROM OLD.title
    OR NEW.body IS DISTINCT FROM OLD.body
    OR NEW.type IS DISTINCT FROM OLD.type
    OR NEW.data IS DISTINCT FROM OLD.data
    OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
      RAISE EXCEPTION 'Only is_read can be updated';
    END IF;

  ELSE
    RAISE EXCEPTION 'No valid column updated';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."prevent_notification_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."promote_scheduled_refunds"() RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_count integer := 0;
BEGIN
  WITH due AS (
    UPDATE public.refunds r
    SET status = 'initiated'
    WHERE r.status = 'scheduled'
      AND r.process_after IS NOT NULL
      AND r.process_after <= now()
    RETURNING r.id
  )
  SELECT count(*)::integer INTO v_count FROM due;

  RETURN COALESCE(v_count, 0);
END;
$$;


ALTER FUNCTION "public"."promote_scheduled_refunds"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."prune_system_error_logs"("p_retention_days" integer DEFAULT 30) RETURNS integer
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_deleted_count integer;
BEGIN
  DELETE FROM public.system_error_logs
  WHERE created_at < (now() - (p_retention_days || ' days')::interval);

  GET DIAGNOSTICS v_deleted_count = ROW_COUNT;
  RETURN v_deleted_count;
END;
$$;


ALTER FUNCTION "public"."prune_system_error_logs"("p_retention_days" integer) OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."purge_terminal_payment_rows"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_now timestamptz := now();
  v_copied_payments int := 0;
  v_copied_refunds int := 0;
  v_deleted_payments int := 0;
  v_deleted_refunds int := 0;
  v_skipped_active_payments int := 0;
  v_skipped_active_refunds int := 0;
BEGIN
  -- Active = never purge (user: initiated / processing; plus gateway hold states)
  SELECT count(*)::int INTO v_skipped_active_payments
  FROM public.payments
  WHERE status IN ('initiated', 'refund_pending', 'refund_failed');

  SELECT count(*)::int INTO v_skipped_active_refunds
  FROM public.refunds
  WHERE status IN ('initiated', 'processing', 'scheduled');

  -- Copy terminal refunds missing from archive (keep live failed for retry)
  WITH ins AS (
    INSERT INTO public.archived_refunds (
      id, payment_id, order_id, amount, status, gateway_refund_id,
      gateway_response, reason, customer_email, retry_count, created_at,
      refunded_at, archived_at, gateway_name
    )
    SELECT
      r.id, r.payment_id, r.order_id, r.amount, r.status, r.gateway_refund_id,
      r.gateway_response, r.reason, r.customer_email, r.retry_count, r.created_at,
      r.refunded_at, v_now, r.gateway_name
    FROM public.refunds r
    WHERE r.status IN ('success', 'cancelled', 'failed')
      AND NOT EXISTS (SELECT 1 FROM public.archived_refunds ar WHERE ar.id = r.id)
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      gateway_response = EXCLUDED.gateway_response,
      customer_email = COALESCE(EXCLUDED.customer_email, public.archived_refunds.customer_email),
      archived_at = EXCLUDED.archived_at,
      gateway_name = COALESCE(EXCLUDED.gateway_name, public.archived_refunds.gateway_name)
    RETURNING 1
  )
  SELECT count(*)::int INTO v_copied_refunds FROM ins;

  -- Copy terminal payments missing from archive
  WITH ins AS (
    INSERT INTO public.archived_payments (
      id, order_id, amount, status, gateway_name, gateway_payment_id,
      gateway_response, created_at, updated_at, archived_at, gateway_order_id
    )
    SELECT
      p.id, p.order_id, p.amount, p.status, p.gateway_name, p.gateway_payment_id,
      p.gateway_response, p.created_at, p.updated_at, v_now, p.gateway_order_id
    FROM public.payments p
    WHERE p.status IN ('failed', 'refunded', 'success', 'partially_refunded')
      AND NOT EXISTS (SELECT 1 FROM public.archived_payments ap WHERE ap.id = p.id)
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      gateway_response = EXCLUDED.gateway_response,
      updated_at = EXCLUDED.updated_at,
      archived_at = EXCLUDED.archived_at,
      gateway_order_id = COALESCE(EXCLUDED.gateway_order_id, public.archived_payments.gateway_order_id)
    RETURNING 1
  )
  SELECT count(*)::int INTO v_copied_payments FROM ins;

  -- Delete only fully finished refunds (never initiated/processing/scheduled; keep failed for retry)
  WITH del AS (
    DELETE FROM public.refunds r
    WHERE r.status IN ('success', 'cancelled')
      AND EXISTS (SELECT 1 FROM public.archived_refunds ar WHERE ar.id = r.id)
    RETURNING 1
  )
  SELECT count(*)::int INTO v_deleted_refunds FROM del;

  -- Delete terminal payments with no active refunds and archive copy present
  WITH del AS (
    DELETE FROM public.payments p
    WHERE p.status IN ('failed', 'refunded', 'success', 'partially_refunded')
      AND EXISTS (SELECT 1 FROM public.archived_payments ap WHERE ap.id = p.id)
      AND NOT EXISTS (
        SELECT 1
        FROM public.refunds r
        WHERE r.payment_id = p.id
          AND r.status IN ('initiated', 'processing', 'scheduled')
      )
    RETURNING 1
  )
  SELECT count(*)::int INTO v_deleted_payments FROM del;

  RAISE LOG '[PAYMENT_PURGE_MIDNIGHT] copied_p=% copied_r=% deleted_p=% deleted_r=% skip_p=% skip_r=%',
    v_copied_payments, v_copied_refunds, v_deleted_payments, v_deleted_refunds,
    v_skipped_active_payments, v_skipped_active_refunds;

  RETURN jsonb_build_object(
    'success', true,
    'copied_payments', v_copied_payments,
    'copied_refunds', v_copied_refunds,
    'deleted_payments', v_deleted_payments,
    'deleted_refunds', v_deleted_refunds,
    'skipped_active_payments', v_skipped_active_payments,
    'skipped_active_refunds', v_skipped_active_refunds,
    'at', v_now
  );
END;
$$;


ALTER FUNCTION "public"."purge_terminal_payment_rows"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."purge_terminal_payment_rows"() IS 'Midnight IST job: copy terminal payment/refund orphans to archived_*, then delete live terminal rows. Never touches initiated/processing/scheduled/refund_pending/refund_failed.';



CREATE OR REPLACE FUNCTION "public"."restore_own_account"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_is_deleted boolean;
  v_deleted_at timestamptz;
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT role, is_deleted, deleted_at
  INTO v_role, v_is_deleted, v_deleted_at
  FROM public.users
  WHERE id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  IF v_role IS DISTINCT FROM 'student' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authorized');
  END IF;

  IF COALESCE(v_is_deleted, false) IS NOT TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_deleted');
  END IF;

  IF v_deleted_at IS NOT NULL AND v_deleted_at <= (now() - interval '7 days') THEN
    RETURN jsonb_build_object('success', false, 'error', 'grace_expired');
  END IF;

  PERFORM set_config('hungertap.bypass_user_restrict', 'on', true);

  UPDATE public.users
  SET is_deleted = false,
      deleted_at = NULL
  WHERE id = v_uid;

  RETURN jsonb_build_object('success', true);
END;
$$;


ALTER FUNCTION "public"."restore_own_account"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."restore_stock_on_cancel"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE v_qty integer;
BEGIN
  IF TG_OP <> 'UPDATE' THEN RETURN NEW; END IF;
  IF COALESCE(NEW.status, '') = 'cancelled_by_vendor'
     AND COALESCE(OLD.status, '') IN ('preparing', 'ready')
     AND OLD.status IS DISTINCT FROM NEW.status
  THEN
    v_qty := COALESCE(OLD.quantity, 1);
    UPDATE public.items SET available_stock = available_stock + v_qty WHERE id = OLD.item_id;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."restore_stock_on_cancel"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."restrict_canteen_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_jwt_role text;
BEGIN
  BEGIN
    v_jwt_role := coalesce(
      current_setting('request.jwt.claim.role', true),
      (current_setting('request.jwt.claims', true)::jsonb->>'role')
    );
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role = 'service_role'
     OR current_user IN ('postgres', 'supabase_admin')
  THEN
    RETURN NEW;
  END IF;

  -- Soft-deleted canteen: client may not change is_active (or re-open / mutate identity).
  IF COALESCE(OLD.is_deleted, false) IS TRUE THEN
    IF NEW.is_active IS DISTINCT FROM OLD.is_active THEN
      RAISE EXCEPTION 'Cannot change is_active on a deleted canteen';
    END IF;
    IF NEW.is_open IS TRUE AND COALESCE(OLD.is_open, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'Cannot open a deleted canteen';
    END IF;
  END IF;

  IF NEW.is_active IS DISTINCT FROM OLD.is_active
     OR NEW.name IS DISTINCT FROM OLD.name
     OR NEW.is_deleted IS DISTINCT FROM OLD.is_deleted
     OR NEW.college_id IS DISTINCT FROM OLD.college_id
  THEN
    RAISE EXCEPTION
      'You can only update is_open / app_orders_enabled / auto_ready / takeaway_charge';
  END IF;

  IF NEW.takeaway_charge IS DISTINCT FROM OLD.takeaway_charge THEN
    IF NEW.takeaway_charge IS NULL
       OR NEW.takeaway_charge < 0
       OR NEW.takeaway_charge > 500
    THEN
      RAISE EXCEPTION 'takeaway_charge must be between 0 and 500';
    END IF;
  END IF;

  -- Cannot open (is_open → true) unless canteen is active and not deleted.
  IF NEW.is_open IS TRUE
     AND COALESCE(OLD.is_open, false) IS NOT TRUE
  THEN
    IF COALESCE(NEW.is_active, OLD.is_active, false) IS NOT TRUE THEN
      RAISE EXCEPTION 'Cannot open canteen while is_active is false';
    END IF;
    IF COALESCE(NEW.is_deleted, OLD.is_deleted, false) IS TRUE THEN
      RAISE EXCEPTION 'Cannot open a deleted canteen';
    END IF;
  END IF;

  -- Closing with live orders is allowed. Cancel/refund is handled by the admin
  -- client (cancel_order_by_admin) and close_canteen_cleanup for leftovers.

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."restrict_canteen_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."restrict_item_updates"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$BEGIN
  -- Prevent changing protected columns
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.canteen_id IS DISTINCT FROM OLD.canteen_id
     OR NEW.created_at IS DISTINCT FROM OLD.created_at THEN

    RAISE EXCEPTION 'You cannot modify id, canteen_id, or created_at';
  END IF;

  RETURN NEW;
END;$$;


ALTER FUNCTION "public"."restrict_item_updates"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."restrict_order_item_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_jwt_role text;
BEGIN
  BEGIN
    v_jwt_role := coalesce(
      current_setting('request.jwt.claim.role', true),
      (current_setting('request.jwt.claims', true)::jsonb->>'role')
    );
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role = 'service_role'
     OR current_user IN ('postgres', 'supabase_admin')
  THEN
    RETURN NEW;
  END IF;

  -- Clients: only status, ready_count, updated_at
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.order_id IS DISTINCT FROM OLD.order_id
     OR NEW.item_id IS DISTINCT FROM OLD.item_id
     OR NEW.item_name IS DISTINCT FROM OLD.item_name
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.quantity IS DISTINCT FROM OLD.quantity
     OR NEW.unit_price IS DISTINCT FROM OLD.unit_price
     OR NEW.line_total IS DISTINCT FROM OLD.line_total
  THEN
    RAISE EXCEPTION 'Only order_items.status and ready_count (and updated_at) can be updated by clients';
  END IF;

  IF NEW.status IS DISTINCT FROM OLD.status
     OR NEW.ready_count IS DISTINCT FROM OLD.ready_count
     OR NEW.updated_at IS DISTINCT FROM OLD.updated_at
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'No valid fields updated';
END;
$$;


ALTER FUNCTION "public"."restrict_order_item_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."restrict_order_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_jwt_role text;
BEGIN
  BEGIN
    v_jwt_role := coalesce(
      current_setting('request.jwt.claim.role', true),
      (current_setting('request.jwt.claims', true)::jsonb->>'role')
    );
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  -- service_role / SQL console: full update
  IF v_jwt_role = 'service_role'
     OR current_user IN ('postgres', 'supabase_admin')
  THEN
    RETURN NEW;
  END IF;

  -- Clients (incl. canteen_admin): only status + updated_at
  IF NEW.id IS DISTINCT FROM OLD.id
     OR NEW.canteen_id IS DISTINCT FROM OLD.canteen_id
     OR NEW.placed_by IS DISTINCT FROM OLD.placed_by
     OR NEW.placed_by_role IS DISTINCT FROM OLD.placed_by_role
     OR NEW.created_at IS DISTINCT FROM OLD.created_at
     OR NEW.order_token IS DISTINCT FROM OLD.order_token
     OR NEW.is_takeaway IS DISTINCT FROM OLD.is_takeaway
     OR NEW.barcode IS DISTINCT FROM OLD.barcode
     OR NEW.total_amount IS DISTINCT FROM OLD.total_amount
     OR NEW.token_date IS DISTINCT FROM OLD.token_date
     OR NEW.delivered_at IS DISTINCT FROM OLD.delivered_at
  THEN
    RAISE EXCEPTION 'Only orders.status (and updated_at) can be updated by clients';
  END IF;

  -- Allow status / updated_at changes, and silent no-ops (same status re-sent).
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."restrict_order_update"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."restrict_order_update"() IS 'Clients may change only status (+updated_at). service_role/postgres unrestricted. delivered_at via RPC only.';



CREATE OR REPLACE FUNCTION "public"."restrict_user_update"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_jwt_role text;
  v_bypass text;
BEGIN
  BEGIN
    v_bypass := current_setting('hungertap.bypass_user_restrict', true);
  EXCEPTION WHEN OTHERS THEN
    v_bypass := NULL;
  END;

  IF v_bypass = 'on' THEN
    RETURN NEW;
  END IF;

  BEGIN
    v_jwt_role := coalesce(
      current_setting('request.jwt.claim.role', true),
      (current_setting('request.jwt.claims', true)::jsonb->>'role')
    );
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role = 'service_role'
     OR current_user IN ('postgres', 'supabase_admin')
  THEN
    RETURN NEW;
  END IF;

  IF NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'User role cannot be changed';
  END IF;

  IF NEW.is_banned IS DISTINCT FROM OLD.is_banned THEN
    RAISE EXCEPTION 'is_banned cannot be changed by clients';
  END IF;

  IF NEW.is_deleted IS DISTINCT FROM OLD.is_deleted
     OR NEW.deleted_at IS DISTINCT FROM OLD.deleted_at
  THEN
    RAISE EXCEPTION 'Account deletion flags cannot be changed by clients';
  END IF;

  IF OLD.role = 'student' THEN
    IF NEW.id IS DISTINCT FROM OLD.id
       OR NEW.college_id IS DISTINCT FROM OLD.college_id
       OR NEW.created_at IS DISTINCT FROM OLD.created_at
    THEN
      RAISE EXCEPTION 'You can only update canteen_id and veg_mode_enabled';
    END IF;
    IF NEW.canteen_id IS DISTINCT FROM OLD.canteen_id THEN
      IF NEW.canteen_id IS NULL THEN
        RAISE EXCEPTION 'canteen_id cannot be cleared';
      END IF;
      IF NOT EXISTS (
        SELECT 1 FROM public.canteens c
        WHERE c.id = NEW.canteen_id
          AND c.is_active IS TRUE
          AND c.is_deleted IS FALSE
          AND c.college_id = OLD.college_id
      ) THEN
        RAISE EXCEPTION 'invalid canteen switch';
      END IF;
    END IF;
  END IF;

  IF OLD.role = 'canteen_admin' THEN
    RAISE EXCEPTION 'Admins cannot update user profile';
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."restrict_user_update"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."revert_order_status_v2"("p_order_id" "uuid", "p_revert_kind" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_kind text; v_user_role text; v_user_canteen uuid; v_order record; v_restore_status text; v_has_kitchen_lines boolean; v_line_count int; v_ready_count int;
BEGIN
  IF p_order_id IS NULL THEN RAISE EXCEPTION 'missing_order_id' USING ERRCODE = 'P0001'; END IF;
  v_kind := lower(trim(coalesce(p_revert_kind, '')));
  IF v_kind NOT IN ('kitchen', 'pickup', 'cancelled') THEN RAISE EXCEPTION 'invalid_revert_kind' USING ERRCODE = 'P0001'; END IF;
  SELECT role, canteen_id INTO v_user_role, v_user_canteen FROM public.users WHERE id = auth.uid();
  IF v_user_role IS DISTINCT FROM 'canteen_admin' THEN RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0001'; END IF;
  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001'; END IF;
  IF v_user_canteen IS NOT NULL AND v_order.canteen_id IS DISTINCT FROM v_user_canteen THEN RAISE EXCEPTION 'unauthorized_canteen' USING ERRCODE = 'P0001'; END IF;
  IF v_kind = 'kitchen' THEN
    IF v_order.status NOT IN ('ready', 'partially_ready') THEN RAISE EXCEPTION 'invalid_status_for_kitchen_revert' USING ERRCODE = 'P0001'; END IF;
    SELECT EXISTS (SELECT 1 FROM public.order_items oi JOIN public.items i ON i.id = oi.item_id JOIN public.canteens c ON c.id = i.canteen_id WHERE oi.order_id = p_order_id AND NOT (COALESCE(i.auto_ready, false) OR COALESCE(c.auto_ready, false))) INTO v_has_kitchen_lines;
    IF NOT COALESCE(v_has_kitchen_lines, false) THEN RAISE EXCEPTION 'fully_auto_ready' USING ERRCODE = 'P0001'; END IF;
    PERFORM set_config('app.is_order_revert', 'true', true);
    UPDATE public.order_items oi SET ready_count = 0, status = 'preparing' FROM public.items i JOIN public.canteens c ON c.id = i.canteen_id WHERE oi.order_id = p_order_id AND oi.item_id = i.id AND NOT (COALESCE(i.auto_ready, false) OR COALESCE(c.auto_ready, false)) AND oi.status NOT IN ('delivered', 'cancelled_by_vendor');
    SELECT status INTO v_restore_status FROM public.orders WHERE id = p_order_id;
    RETURN jsonb_build_object('ok', true, 'kind', v_kind, 'order_id', p_order_id, 'new_status', v_restore_status);
  ELSIF v_kind = 'pickup' THEN
    IF v_order.status NOT IN ('delivered', 'pickup_failed') THEN RAISE EXCEPTION 'invalid_status_for_pickup_revert' USING ERRCODE = 'P0001'; END IF;
    IF COALESCE(v_order.updated_at, v_order.created_at) < (NOW() - INTERVAL '3 minutes') THEN RAISE EXCEPTION 'revert_window_expired' USING ERRCODE = 'P0001'; END IF;
    PERFORM set_config('app.is_order_revert', 'true', true);
    UPDATE public.orders SET status = 'ready' WHERE id = p_order_id AND status IN ('delivered', 'pickup_failed');
    RETURN jsonb_build_object('ok', true, 'kind', v_kind, 'order_id', p_order_id, 'new_status', 'ready');
  ELSE
    IF v_order.status NOT IN ('cancelled_by_vendor', 'cancelled', 'canceled_by_vendor', 'canceled') THEN RAISE EXCEPTION 'invalid_status_for_cancelled_revert' USING ERRCODE = 'P0001'; END IF;
    IF COALESCE(v_order.updated_at, v_order.created_at) < (NOW() - INTERVAL '3 minutes') THEN RAISE EXCEPTION 'revert_window_expired' USING ERRCODE = 'P0001'; END IF;
    UPDATE public.items i SET available_stock = i.available_stock - oi.quantity FROM public.order_items oi JOIN public.items it ON it.id = oi.item_id JOIN public.canteens c ON c.id = it.canteen_id WHERE oi.order_id = p_order_id AND oi.item_id = i.id AND oi.status = 'cancelled_by_vendor' AND COALESCE(oi.ready_count, 0) = 0 AND NOT (COALESCE(it.auto_ready, false) OR COALESCE(c.auto_ready, false));
    SELECT COUNT(*), COUNT(*) FILTER (WHERE COALESCE(ready_count, 0) >= GREATEST(1, COALESCE(quantity, 1))) INTO v_line_count, v_ready_count FROM public.order_items WHERE order_id = p_order_id;
    IF v_line_count > 0 AND v_ready_count = v_line_count THEN v_restore_status := 'ready'; ELSE v_restore_status := 'preparing'; END IF;
    UPDATE public.orders SET status = v_restore_status WHERE id = p_order_id;
    RETURN jsonb_build_object('ok', true, 'kind', v_kind, 'order_id', p_order_id, 'new_status', v_restore_status);
  END IF;
END;
$$;


ALTER FUNCTION "public"."revert_order_status_v2"("p_order_id" "uuid", "p_revert_kind" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."run_canteen_close_job"("p_job_id" "uuid") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_job public.canteen_close_jobs%ROWTYPE;
  v_result jsonb;
BEGIN
  IF coalesce(auth.role(), '') <> 'service_role' THEN
    RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_job
  FROM public.canteen_close_jobs
  WHERE id = p_job_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'job_not_found');
  END IF;

  IF v_job.status = 'done' THEN
    RETURN jsonb_build_object('ok', true, 'status', 'already_done');
  END IF;

  UPDATE public.canteen_close_jobs
  SET status = 'running', started_at = COALESCE(started_at, now()), error_message = NULL
  WHERE id = p_job_id;

  BEGIN
    SELECT public.close_canteen_cleanup(v_job.canteen_id) INTO v_result;

    UPDATE public.canteen_close_jobs
    SET status = 'done', finished_at = now(), error_message = NULL
    WHERE id = p_job_id;

    RETURN jsonb_build_object('ok', true, 'status', 'done', 'cleanup', v_result);
  EXCEPTION WHEN OTHERS THEN
    UPDATE public.canteen_close_jobs
    SET status = 'failed', finished_at = now(), error_message = left(SQLERRM, 500)
    WHERE id = p_job_id;

    RETURN jsonb_build_object('ok', false, 'status', 'failed', 'error', SQLERRM);
  END;
END;
$$;


ALTER FUNCTION "public"."run_canteen_close_job"("p_job_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_default_payment_gateway"("p_code" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE v_code text := lower(trim(p_code));
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.payment_gateways WHERE code = v_code AND enabled = true
  ) THEN
    RETURN jsonb_build_object('success', false, 'error', 'gateway_not_found_or_disabled');
  END IF;
  UPDATE public.payment_gateways SET is_default = false, updated_at = now() WHERE is_default = true;
  UPDATE public.payment_gateways SET is_default = true,  updated_at = now() WHERE code = v_code;
  RETURN jsonb_build_object('success', true, 'default_gateway', v_code);
END;
$$;


ALTER FUNCTION "public"."set_default_payment_gateway"("p_code" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_delivered_at_on_status"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF NEW.status = 'delivered'
     AND OLD.status IS DISTINCT FROM 'delivered'
     AND NEW.delivered_at IS NULL
  THEN
    NEW.delivered_at := now();
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_delivered_at_on_status"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."set_updated_at"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  NEW.updated_at := NOW();
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."set_updated_at"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."soft_delete_item_instead_of_hard_delete"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_jwt_role text;
BEGIN
  BEGIN
    v_jwt_role := coalesce(
      current_setting('request.jwt.claim.role', true),
      (current_setting('request.jwt.claims', true)::jsonb->>'role')
    );
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  -- SQL console / service_role may hard-delete when intentional
  IF v_jwt_role = 'service_role'
     OR current_user IN ('postgres', 'supabase_admin')
  THEN
    RETURN OLD;
  END IF;

  UPDATE public.items
  SET
    is_active = false,
    is_deleted = true
  WHERE id = OLD.id
    AND (
      is_active IS DISTINCT FROM false
      OR is_deleted IS DISTINCT FROM true
    );

  RETURN NULL; -- skip hard DELETE
END;
$$;


ALTER FUNCTION "public"."soft_delete_item_instead_of_hard_delete"() OWNER TO "postgres";


COMMENT ON FUNCTION "public"."soft_delete_item_instead_of_hard_delete"() IS 'Client DELETE on items becomes soft-remove (is_active=false, is_deleted=true). service_role/postgres may hard-delete.';



CREATE OR REPLACE FUNCTION "public"."soft_delete_own_account"() RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  v_is_deleted boolean;
  v_active_count int;
  v_deleted_at timestamptz := now();
BEGIN
  IF v_uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;

  SELECT role, is_deleted
  INTO v_role, v_is_deleted
  FROM public.users
  WHERE id = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('success', false, 'error', 'user_not_found');
  END IF;

  IF v_role IS DISTINCT FROM 'student' THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authorized');
  END IF;

  IF COALESCE(v_is_deleted, false) IS TRUE THEN
    RETURN jsonb_build_object('success', false, 'error', 'already_deleted');
  END IF;

  SELECT COUNT(*)::int INTO v_active_count
  FROM public.orders
  WHERE placed_by = v_uid
    AND status = ANY (ARRAY[
      'pending_payment'::text,
      'preparing'::text,
      'partially_ready'::text,
      'ready'::text
    ]);

  IF COALESCE(v_active_count, 0) > 0 THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'active_orders',
      'count', v_active_count
    );
  END IF;

  PERFORM set_config('hungertap.bypass_user_restrict', 'on', true);

  UPDATE public.users
  SET is_deleted = true,
      deleted_at = v_deleted_at
  WHERE id = v_uid;

  RETURN jsonb_build_object(
    'success', true,
    'deleted_at', v_deleted_at
  );
END;
$$;


ALTER FUNCTION "public"."soft_delete_own_account"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_items_is_available_from_stock"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  NEW.is_available := (COALESCE(NEW.available_stock, 0) > 0);
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_items_is_available_from_stock"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_order_items_status_from_order"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF public.hungertap_in_close_cleanup() THEN
    RETURN NEW;
  END IF;

  IF OLD.status IS NOT DISTINCT FROM NEW.status THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'partially_ready' THEN
    RETURN NEW;
  END IF;

  IF NEW.status NOT IN (
    'pending_payment',
    'payment_failed',
    'preparing',
    'ready',
    'delivered',
    'cancelled_by_vendor',
    'pickup_failed'
  ) THEN
    RETURN NEW;
  END IF;

  IF NEW.status = 'cancelled_by_vendor' THEN
    UPDATE public.order_items
    SET status = NEW.status
    WHERE order_id = NEW.id
      AND status IS DISTINCT FROM NEW.status
      AND status <> 'delivered';

  ELSIF NEW.status = 'pickup_failed' THEN
    UPDATE public.order_items
    SET status = 'pickup_failed'
    WHERE order_id = NEW.id
      AND status IS DISTINCT FROM 'pickup_failed'
      AND status NOT IN ('delivered', 'cancelled_by_vendor');

  ELSIF NEW.status = 'payment_failed' THEN
    UPDATE public.order_items
    SET status = NEW.status
    WHERE order_id = NEW.id
      AND status IS DISTINCT FROM NEW.status
      AND status <> 'delivered';

  ELSIF NEW.status = 'preparing' THEN
    UPDATE public.order_items oi
    SET status = 'preparing'
    FROM public.items i
    JOIN public.canteens c ON c.id = i.canteen_id
    WHERE oi.order_id = NEW.id
      AND oi.item_id = i.id
      AND NOT (COALESCE(i.auto_ready, false) OR COALESCE(c.auto_ready, false))
      AND oi.status IS DISTINCT FROM 'preparing'
      AND oi.status <> 'delivered';

    UPDATE public.order_items oi
    SET status = 'ready',
        ready_count = oi.quantity
    FROM public.items i
    JOIN public.canteens c ON c.id = i.canteen_id
    WHERE oi.order_id = NEW.id
      AND oi.item_id = i.id
      AND (COALESCE(i.auto_ready, false) OR COALESCE(c.auto_ready, false))
      AND oi.status <> 'delivered'
      AND (
        oi.status IS DISTINCT FROM 'ready'
        OR oi.ready_count IS DISTINCT FROM oi.quantity
      );

  ELSIF NEW.status = 'ready' THEN
    IF OLD.status = 'delivered' THEN
      UPDATE public.order_items
      SET status = 'ready'
      WHERE order_id = NEW.id
        AND status IS DISTINCT FROM 'ready';
    ELSE
      UPDATE public.order_items
      SET status = 'ready'
      WHERE order_id = NEW.id
        AND status IS DISTINCT FROM 'ready'
        AND status <> 'delivered';
    END IF;

  ELSIF NEW.status = 'delivered' THEN
    UPDATE public.order_items
    SET status = 'delivered'
    WHERE order_id = NEW.id
      AND status IS DISTINCT FROM 'delivered';

  ELSE
    UPDATE public.order_items
    SET status = NEW.status
    WHERE order_id = NEW.id
      AND status IS DISTINCT FROM NEW.status;
  END IF;

  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."sync_order_items_status_from_order"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."sync_order_status_from_order_items"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public'
    AS $$
DECLARE
  v_order_id       uuid;
  v_new_status     text;
  v_current_status text;
BEGIN
  IF public.hungertap_in_close_cleanup() THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_order_id := COALESCE(NEW.order_id, OLD.order_id);
  IF v_order_id IS NULL THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  SELECT status INTO v_current_status
  FROM public.orders
  WHERE id = v_order_id;

  IF v_current_status IN (
    'payment_failed',
    'pending_payment',
    'cancelled_by_vendor',
    'pickup_failed'
  ) THEN
    RETURN COALESCE(NEW, OLD);
  END IF;

  v_new_status := public.compute_order_status_from_items(v_order_id);

  UPDATE public.orders
  SET status = v_new_status
  WHERE id = v_order_id
    AND status IS DISTINCT FROM v_new_status;

  RETURN COALESCE(NEW, OLD);
END;
$$;


ALTER FUNCTION "public"."sync_order_status_from_order_items"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_orders_cancel_scheduled_refund_on_uncancel"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_res jsonb;
BEGIN
  IF TG_OP = 'UPDATE'
     AND OLD.status = 'cancelled_by_vendor'
     AND NEW.status IS DISTINCT FROM OLD.status
     AND NEW.status IN ('preparing', 'ready', 'partially_ready', 'pending_payment')
  THEN
    v_res := public.cancel_scheduled_refund_for_order(NEW.id);
    IF COALESCE((v_res->>'ok')::boolean, false) IS NOT TRUE THEN
      RAISE EXCEPTION '%', COALESCE(v_res->>'error', 'refund_already_processing')
        USING ERRCODE = 'P0001';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_orders_cancel_scheduled_refund_on_uncancel"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_orders_ensure_refund_on_cancel"() RETURNS "trigger"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.status = 'cancelled_by_vendor'
     AND OLD.status IS DISTINCT FROM 'cancelled_by_vendor'
  THEN
    PERFORM public.ensure_refund_for_order(
      NEW.id,
      'Order cancelled_by_vendor',
      NULL
    );
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_orders_ensure_refund_on_cancel"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."trg_refunds_hold_window"() RETURNS "trigger"
    LANGUAGE "plpgsql"
    SET "search_path" TO 'public'
    AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.status = 'initiated' THEN
      NEW.status := 'scheduled';
      NEW.process_after := COALESCE(NEW.process_after, now() + interval '3 minutes');
    ELSIF NEW.status = 'scheduled' AND NEW.process_after IS NULL THEN
      NEW.process_after := now() + interval '3 minutes';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;


ALTER FUNCTION "public"."trg_refunds_hold_window"() OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."update_order_status_flexible"("p_order_id" "uuid", "p_new_status" "text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_jwt_role text;
  v_role text;
  v_canteen uuid;
  v_order public.orders%ROWTYPE;
  v_status text;
  v_now timestamptz := now();
BEGIN
  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'missing_order_id' USING ERRCODE = 'P0001';
  END IF;

  BEGIN
    v_jwt_role := coalesce(
      current_setting('request.jwt.claim.role', true),
      (current_setting('request.jwt.claims', true)::jsonb->>'role')
    );
  EXCEPTION WHEN OTHERS THEN
    v_jwt_role := NULL;
  END;

  IF v_jwt_role IS DISTINCT FROM 'service_role'
     AND session_user NOT IN ('postgres', 'supabase_admin')
  THEN
    IF auth.uid() IS NULL THEN
      RAISE EXCEPTION 'not_authenticated' USING ERRCODE = 'P0001';
    END IF;
    SELECT role, canteen_id INTO v_role, v_canteen FROM public.users WHERE id = auth.uid();
    IF v_role IS DISTINCT FROM 'canteen_admin' THEN
      RAISE EXCEPTION 'unauthorized' USING ERRCODE = 'P0001';
    END IF;
  END IF;

  v_status := lower(trim(coalesce(p_new_status, '')));
  IF v_status IN ('cancelled', 'canceled', 'canceled_by_vendor') THEN
    v_status := 'cancelled_by_vendor';
  END IF;
  IF v_status NOT IN ('delivered', 'cancelled_by_vendor') THEN
    RAISE EXCEPTION 'invalid_status' USING ERRCODE = 'P0001';
  END IF;

  SELECT * INTO v_order FROM public.orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'order_not_found' USING ERRCODE = 'P0001';
  END IF;
  IF v_canteen IS NOT NULL AND v_order.canteen_id IS DISTINCT FROM v_canteen THEN
    RAISE EXCEPTION 'unauthorized_canteen' USING ERRCODE = 'P0001';
  END IF;
  IF v_order.status IS NOT DISTINCT FROM v_status THEN
    RETURN jsonb_build_object('ok', true, 'order_id', p_order_id, 'status', v_status, 'unchanged', true);
  END IF;
  IF v_status = 'delivered' AND v_order.status NOT IN ('preparing', 'partially_ready', 'ready') THEN
    RAISE EXCEPTION 'invalid_status_transition' USING ERRCODE = 'P0001';
  END IF;
  IF v_status = 'cancelled_by_vendor' AND v_order.status NOT IN ('preparing', 'partially_ready', 'ready') THEN
    RAISE EXCEPTION 'invalid_status_transition' USING ERRCODE = 'P0001';
  END IF;

  UPDATE public.orders
  SET status = v_status,
      delivered_at = CASE WHEN v_status = 'delivered' THEN COALESCE(delivered_at, v_now) ELSE delivered_at END,
      updated_at = v_now
  WHERE id = p_order_id;

  RETURN jsonb_build_object('ok', true, 'order_id', p_order_id, 'status', v_status);
END;
$$;


ALTER FUNCTION "public"."update_order_status_flexible"("p_order_id" "uuid", "p_new_status" "text") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."validate_user_canteen_role_v2"("p_user_id" "uuid") RETURNS TABLE("canteen_id" "uuid", "role" "text")
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'pg_temp'
    AS $$
DECLARE
  v_canteen_id uuid;
  v_role text;
  v_is_deleted boolean;
BEGIN
  IF p_user_id IS NULL THEN
    RAISE LOG '[ORDER_V2] AUTH_FAIL: auth.uid() returned NULL';
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  SELECT u.canteen_id, u.role, u.is_deleted
  INTO v_canteen_id, v_role, v_is_deleted
  FROM public.users u
  WHERE u.id = p_user_id;

  IF NOT FOUND THEN
    RAISE LOG '[ORDER_V2] USER_NOT_FOUND: user_id=%, no canteen assignment', p_user_id;
    RAISE EXCEPTION 'User is not assigned to any canteen';
  END IF;

  IF COALESCE(v_is_deleted, false) IS TRUE THEN
    RAISE EXCEPTION 'Account is scheduled for deletion. Restore your account to continue.';
  END IF;

  canteen_id := v_canteen_id;
  role := v_role;
  RETURN NEXT;
END;
$$;


ALTER FUNCTION "public"."validate_user_canteen_role_v2"("p_user_id" "uuid") OWNER TO "postgres";


CREATE OR REPLACE FUNCTION "public"."void_failed_checkout_order"("p_order_id" "uuid", "p_payment_id" "uuid" DEFAULT NULL::"uuid", "p_reason" "text" DEFAULT 'Provider checkout initialization failed'::"text") RETURNS "jsonb"
    LANGUAGE "plpgsql" SECURITY DEFINER
    SET "search_path" TO 'public', 'extensions', 'pg_temp'
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


ALTER FUNCTION "public"."void_failed_checkout_order"("p_order_id" "uuid", "p_payment_id" "uuid", "p_reason" "text") OWNER TO "postgres";

SET default_tablespace = '';

SET default_table_access_method = "heap";


CREATE TABLE IF NOT EXISTS "private"."hungertap_config" (
    "key" "text" NOT NULL,
    "value" "text" NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "private"."hungertap_config" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."archived_order_items" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "item_id" "uuid",
    "item_name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "quantity" integer DEFAULT 0 NOT NULL,
    "ready_count" integer DEFAULT 0 NOT NULL,
    "archived_at" timestamp with time zone DEFAULT "timezone"('UTC'::"text", "now"()) NOT NULL,
    "total_amount" numeric(12,2),
    "status" "text",
    "unit_price" numeric,
    "line_total" numeric,
    CONSTRAINT "order_items_ready_count_valid" CHECK ((("ready_count" >= 0) AND ("ready_count" <= "quantity")))
);


ALTER TABLE "public"."archived_order_items" OWNER TO "postgres";


COMMENT ON TABLE "public"."archived_order_items" IS 'Line items for archived_orders.';



COMMENT ON COLUMN "public"."archived_order_items"."total_amount" IS 'Archived line total = quantity * current items.price (computed in trigger)';



CREATE TABLE IF NOT EXISTS "public"."archived_orders" (
    "id" "uuid" NOT NULL,
    "canteen_id" "uuid",
    "placed_by" "uuid",
    "placed_by_role" "text",
    "order_token" "text",
    "barcode" character varying,
    "status" "text" NOT NULL,
    "is_takeaway" boolean DEFAULT false,
    "total_amount" numeric,
    "token_date" "date",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "archived_at" timestamp with time zone DEFAULT "timezone"('UTC'::"text", "now"()) NOT NULL,
    "archive_reason" "text"
);


ALTER TABLE "public"."archived_orders" OWNER TO "postgres";


COMMENT ON TABLE "public"."archived_orders" IS 'Cold storage for closed-canteen orders (delivered / cancelled / pickup_failed). Written by close_canteen_cleanup.';



CREATE TABLE IF NOT EXISTS "public"."archived_payments" (
    "id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "amount" numeric NOT NULL,
    "status" "text",
    "gateway_name" "text",
    "gateway_payment_id" "text",
    "gateway_response" "jsonb",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "archived_at" timestamp with time zone DEFAULT "timezone"('UTC'::"text", "now"()) NOT NULL,
    "gateway_order_id" "text"
);


ALTER TABLE "public"."archived_payments" OWNER TO "postgres";


COMMENT ON TABLE "public"."archived_payments" IS 'Snapshot of payments copied at canteen close. Live payments may still exist until terminal.';



CREATE TABLE IF NOT EXISTS "public"."archived_refunds" (
    "id" "uuid" NOT NULL,
    "payment_id" "uuid",
    "order_id" "uuid" NOT NULL,
    "amount" numeric,
    "status" "text",
    "gateway_refund_id" "text",
    "gateway_response" "jsonb",
    "reason" "text",
    "customer_email" "text",
    "retry_count" integer DEFAULT 0,
    "created_at" timestamp with time zone,
    "refunded_at" timestamp with time zone,
    "archived_at" timestamp with time zone DEFAULT "timezone"('UTC'::"text", "now"()) NOT NULL,
    "gateway_name" "text"
);


ALTER TABLE "public"."archived_refunds" OWNER TO "postgres";


COMMENT ON TABLE "public"."archived_refunds" IS 'Snapshot of refunds copied at canteen close.';



CREATE TABLE IF NOT EXISTS "public"."canteen_close_jobs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "canteen_id" "uuid" NOT NULL,
    "status" "text" DEFAULT 'pending'::"text" NOT NULL,
    "error_message" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "started_at" timestamp with time zone,
    "finished_at" timestamp with time zone,
    CONSTRAINT "canteen_close_jobs_status_check" CHECK (("status" = ANY (ARRAY['pending'::"text", 'running'::"text", 'done'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."canteen_close_jobs" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."canteen_daily_token_counters" (
    "canteen_id" "uuid" NOT NULL,
    "token_date" "date" NOT NULL,
    "next_token" integer DEFAULT 1001 NOT NULL,
    CONSTRAINT "canteen_daily_token_counters_next_token_chk" CHECK ((("next_token" >= 1001) AND ("next_token" <= 100000)))
);


ALTER TABLE "public"."canteen_daily_token_counters" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."canteens" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "college_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "is_active" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_open" boolean DEFAULT false NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "takeaway_charge" numeric(10,2) DEFAULT 10.00,
    "app_orders_enabled" boolean DEFAULT true NOT NULL,
    "auto_ready" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."canteens" OWNER TO "postgres";


COMMENT ON TABLE "public"."canteens" IS 'RLS: public read; UPDATE only for canteen_admin on their canteen row.';



COMMENT ON COLUMN "public"."canteens"."is_open" IS 'true = canteen open for orders, false = closed';



COMMENT ON COLUMN "public"."canteens"."app_orders_enabled" IS 'When false, student/app orders are blocked; counter (canteen_admin) can still order if is_open.';



COMMENT ON COLUMN "public"."canteens"."auto_ready" IS 'When true, new paid/counter orders skip preparing and are created as ready (order + lines).';



CREATE TABLE IF NOT EXISTS "public"."categories" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "image_url" "text",
    "is_deleted" boolean DEFAULT false NOT NULL
);


ALTER TABLE "public"."categories" OWNER TO "postgres";


COMMENT ON TABLE "public"."categories" IS 'RLS: SELECT for authenticated only; mutations via service_role / SQL only.';



COMMENT ON COLUMN "public"."categories"."image_url" IS 'URL or path to the category image';



COMMENT ON COLUMN "public"."categories"."is_deleted" IS 'When true, category is hidden from normal users; only superadmin should set.';



CREATE TABLE IF NOT EXISTS "public"."colleges" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "name" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "min_app_version" "text" DEFAULT '1.0.2'::"text" NOT NULL
);


ALTER TABLE "public"."colleges" OWNER TO "postgres";


COMMENT ON COLUMN "public"."colleges"."is_deleted" IS 'When true, college is soft-deleted; only superadmin may set (see COLLEGES_RLS.sql).';



COMMENT ON COLUMN "public"."colleges"."min_app_version" IS 'Minimum student app marketing version (e.g. 1.0.2). Enforced via get_minimum_supported_app_version.';



CREATE TABLE IF NOT EXISTS "public"."failed_order_items" (
    "id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "item_id" "uuid",
    "item_name" "text" NOT NULL,
    "status" "text",
    "quantity" integer DEFAULT 0 NOT NULL,
    "ready_count" integer DEFAULT 0 NOT NULL,
    "unit_price" numeric,
    "line_total" numeric,
    "total_amount" numeric,
    "created_at" timestamp with time zone,
    "archived_at" timestamp with time zone DEFAULT "timezone"('UTC'::"text", "now"()) NOT NULL
);


ALTER TABLE "public"."failed_order_items" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."failed_orders" (
    "id" "uuid" NOT NULL,
    "canteen_id" "uuid",
    "placed_by" "uuid",
    "placed_by_role" "text",
    "order_token" "text",
    "barcode" character varying,
    "status" "text" DEFAULT 'payment_failed'::"text" NOT NULL,
    "is_takeaway" boolean DEFAULT false,
    "total_amount" numeric,
    "token_date" "date",
    "created_at" timestamp with time zone,
    "updated_at" timestamp with time zone,
    "archived_at" timestamp with time zone DEFAULT "timezone"('UTC'::"text", "now"()) NOT NULL,
    "archive_reason" "text"
);


ALTER TABLE "public"."failed_orders" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."items" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "canteen_id" "uuid" NOT NULL,
    "category_id" "uuid" NOT NULL,
    "name" "text" NOT NULL,
    "price" smallint NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "available_stock" integer DEFAULT 0 NOT NULL,
    "is_active" boolean DEFAULT true NOT NULL,
    "image_url" "text" NOT NULL,
    "is_vegetarian" boolean NOT NULL,
    "description" "text" DEFAULT 'Freshly prepared item made with quality ingredients.'::"text" NOT NULL,
    "ingredients" "jsonb" DEFAULT '[]'::"jsonb",
    "batch_size" integer DEFAULT 10 NOT NULL,
    "is_available" boolean DEFAULT false NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "auto_ready" boolean DEFAULT false NOT NULL,
    CONSTRAINT "items_available_stock_non_negative" CHECK (("available_stock" >= 0)),
    CONSTRAINT "items_batch_size_check" CHECK (("batch_size" > 0)),
    CONSTRAINT "items_price_check" CHECK (("price" >= 0))
);


ALTER TABLE "public"."items" OWNER TO "postgres";


COMMENT ON COLUMN "public"."items"."available_stock" IS 'Available quantity in stock for this item in the canteen';



COMMENT ON COLUMN "public"."items"."is_active" IS 'On menu (true) or removed (false). Used for Removed Items panel and remove/restore.';



COMMENT ON COLUMN "public"."items"."image_url" IS 'URL or path to the item image';



COMMENT ON COLUMN "public"."items"."is_vegetarian" IS 'used to say is item vegetarian';



COMMENT ON COLUMN "public"."items"."is_available" IS 'True when available_stock > 0. Maintained by trigger. Used for Redis menu cache / student OOS.';



COMMENT ON COLUMN "public"."items"."is_deleted" IS 'When true, item is hidden from students and admin. Independent of is_active (removed-from-menu).';



CREATE TABLE IF NOT EXISTS "public"."notifications" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "title" "text" NOT NULL,
    "body" "text" NOT NULL,
    "type" "text" DEFAULT 'generic'::"text" NOT NULL,
    "data" "jsonb" DEFAULT '{}'::"jsonb" NOT NULL,
    "is_read" boolean DEFAULT false NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."notifications" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."order_items" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "item_id" "uuid",
    "item_name" "text" NOT NULL,
    "status" "text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "quantity" integer DEFAULT 1 NOT NULL,
    "updated_at" timestamp with time zone,
    "ready_count" integer DEFAULT 0 NOT NULL,
    "unit_price" numeric(10,2) DEFAULT 0,
    "line_total" numeric(10,2) DEFAULT 0,
    CONSTRAINT "order_items_ready_count_valid" CHECK ((("ready_count" >= 0) AND ("ready_count" <= "quantity"))),
    CONSTRAINT "order_items_status_check" CHECK (("status" = ANY (ARRAY['pending_payment'::"text", 'payment_failed'::"text", 'preparing'::"text", 'ready'::"text", 'delivered'::"text", 'cancelled_by_vendor'::"text", 'pickup_failed'::"text"])))
);


ALTER TABLE "public"."order_items" OWNER TO "postgres";


COMMENT ON TABLE "public"."order_items" IS 'RLS: SELECT via parent order; UPDATE canteen_admin only (status, ready_count); INSERT/DELETE denied.';



COMMENT ON COLUMN "public"."order_items"."updated_at" IS 'Automatically set on INSERT/UPDATE';



COMMENT ON COLUMN "public"."order_items"."ready_count" IS 'Number of units ready. Status becomes ready when ready_count === quantity';



CREATE TABLE IF NOT EXISTS "public"."orders" (
    "id" "uuid" DEFAULT "extensions"."uuid_generate_v4"() NOT NULL,
    "canteen_id" "uuid" NOT NULL,
    "placed_by" "uuid",
    "placed_by_role" "text" NOT NULL,
    "order_token" "text" NOT NULL,
    "status" "text" DEFAULT '"pending_payment"'::"text" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"(),
    "updated_at" timestamp with time zone,
    "is_takeaway" boolean DEFAULT false NOT NULL,
    "barcode" character varying(12) NOT NULL,
    "total_amount" numeric(12,2),
    "token_date" "date" DEFAULT (("now"() AT TIME ZONE 'Asia/Kolkata'::"text"))::"date",
    "delivered_at" timestamp with time zone,
    CONSTRAINT "orders_placed_by_role_check" CHECK (("placed_by_role" = ANY (ARRAY['student'::"text", 'canteen_admin'::"text"]))),
    CONSTRAINT "orders_status_check" CHECK (("status" = ANY (ARRAY['pending_payment'::"text", 'payment_failed'::"text", 'preparing'::"text", 'partially_ready'::"text", 'ready'::"text", 'delivered'::"text", 'cancelled_by_vendor'::"text", 'pickup_failed'::"text"])))
);


ALTER TABLE "public"."orders" OWNER TO "postgres";


COMMENT ON TABLE "public"."orders" IS 'RLS: SELECT own or canteen_admin for canteen; UPDATE canteen_admin only (status); INSERT/DELETE denied.';



COMMENT ON COLUMN "public"."orders"."updated_at" IS 'Set when order or its items status changes';



COMMENT ON COLUMN "public"."orders"."is_takeaway" IS 'true = Takeaway, false = Dine-in';



COMMENT ON COLUMN "public"."orders"."barcode" IS '12-digit string; unique per order';



COMMENT ON COLUMN "public"."orders"."total_amount" IS 'Bill subtotal from menu prices at order time: sum of items.price × quantity for validated lines (see create_order_minimal).';



CREATE TABLE IF NOT EXISTS "public"."payment_gateways" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "code" "text" NOT NULL,
    "display_name" "text" NOT NULL,
    "enabled" boolean DEFAULT true NOT NULL,
    "is_default" boolean DEFAULT false NOT NULL,
    "user_selectable" boolean DEFAULT true NOT NULL,
    "sort_order" integer DEFAULT 0 NOT NULL,
    "supported_methods" "jsonb" DEFAULT '["upi", "card", "netbanking"]'::"jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL
);


ALTER TABLE "public"."payment_gateways" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payment_webhook_events" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "event_id" "text" NOT NULL,
    "gateway" "text" NOT NULL,
    "event_type" "text" NOT NULL,
    "status" "text" DEFAULT 'processing'::"text" NOT NULL,
    "payload" "jsonb",
    "error" "text",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processing_started_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "processed_at" timestamp with time zone,
    "gateway_version" "text",
    "failure_class" "text",
    CONSTRAINT "payment_webhook_events_status_check" CHECK (("status" = ANY (ARRAY['processing'::"text", 'processed'::"text", 'failed'::"text"])))
);


ALTER TABLE "public"."payment_webhook_events" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."payments" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "order_id" "uuid" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "status" "text" NOT NULL,
    "gateway_name" "text",
    "gateway_payment_id" "text",
    "gateway_response" "jsonb",
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "gateway_order_id" "text",
    CONSTRAINT "payments_amount_check" CHECK (("amount" >= (0)::numeric)),
    CONSTRAINT "payments_status_check" CHECK (("status" = ANY (ARRAY['initiated'::"text", 'success'::"text", 'failed'::"text", 'refund_pending'::"text", 'partially_refunded'::"text", 'refunded'::"text", 'refund_failed'::"text"])))
);


ALTER TABLE "public"."payments" OWNER TO "postgres";


COMMENT ON COLUMN "public"."payments"."order_id" IS 'Logical link to orders.id. No FK by design: close_canteen_cleanup deletes live orders while payments/refunds remain for gateway completion.';



CREATE TABLE IF NOT EXISTS "public"."refunds" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "payment_id" "uuid" NOT NULL,
    "order_id" "uuid" NOT NULL,
    "amount" numeric(12,2) NOT NULL,
    "status" "text" NOT NULL,
    "gateway_refund_id" "text",
    "gateway_response" "jsonb",
    "reason" "text",
    "created_at" timestamp with time zone DEFAULT "now"(),
    "refunded_at" timestamp with time zone,
    "retry_count" integer DEFAULT 0,
    "customer_email" "text",
    "failure_reason" "text",
    "process_after" timestamp with time zone,
    "gateway_name" "text",
    CONSTRAINT "refunds_status_check" CHECK (("status" = ANY (ARRAY['initiated'::"text", 'processing'::"text", 'success'::"text", 'failed'::"text", 'scheduled'::"text", 'cancelled'::"text"])))
);


ALTER TABLE "public"."refunds" OWNER TO "postgres";


CREATE TABLE IF NOT EXISTS "public"."system_error_logs" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "service" "text" NOT NULL,
    "level" "text" NOT NULL,
    "request_id" "text",
    "order_id" "uuid",
    "user_id" "uuid",
    "message" "text" NOT NULL,
    "error_code" "text",
    "error_details" "jsonb",
    "context" "jsonb",
    "http_metadata" "jsonb",
    CONSTRAINT "system_error_logs_level_check" CHECK (("level" = ANY (ARRAY['error'::"text", 'fatal'::"text", 'warn'::"text"])))
);


ALTER TABLE "public"."system_error_logs" OWNER TO "postgres";


COMMENT ON TABLE "public"."system_error_logs" IS 'RLS: no client access. Inserts from Edge (service_role). Read via SQL console / service_role.';



CREATE TABLE IF NOT EXISTS "public"."user_tokens" (
    "id" "uuid" DEFAULT "gen_random_uuid"() NOT NULL,
    "user_id" "uuid" NOT NULL,
    "fcm_token" "text" NOT NULL,
    "platform" "text",
    "is_enabled" boolean DEFAULT true NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    CONSTRAINT "user_tokens_new_platform_check" CHECK ((("platform" IS NULL) OR ("platform" = ANY (ARRAY['ios'::"text", 'android'::"text", 'web'::"text"]))))
);


ALTER TABLE "public"."user_tokens" OWNER TO "postgres";


COMMENT ON TABLE "public"."user_tokens" IS 'RLS: authenticated CRUD own rows only (user_id = auth.uid()). Push sender uses service_role.';



COMMENT ON COLUMN "public"."user_tokens"."fcm_token" IS 'Unique device push token. One user may have many rows (phone + tablet).';



COMMENT ON COLUMN "public"."user_tokens"."platform" IS 'Device OS for this push token: ios | android | web. Helps debug delivery; not a security boundary.';



CREATE TABLE IF NOT EXISTS "public"."users" (
    "id" "uuid" NOT NULL,
    "role" "text" DEFAULT 'student'::"text" NOT NULL,
    "canteen_id" "uuid" NOT NULL,
    "college_id" "uuid" NOT NULL,
    "created_at" timestamp with time zone DEFAULT "now"() NOT NULL,
    "is_banned" boolean DEFAULT false NOT NULL,
    "veg_mode_enabled" boolean DEFAULT false NOT NULL,
    "is_deleted" boolean DEFAULT false NOT NULL,
    "deleted_at" timestamp with time zone,
    CONSTRAINT "users_role_check" CHECK (("role" = ANY (ARRAY['student'::"text", 'canteen_admin'::"text", 'super_admin'::"text"])))
);


ALTER TABLE "public"."users" OWNER TO "postgres";


COMMENT ON TABLE "public"."users" IS 'RLS: SELECT own; INSERT denied (create_user_profile_from_auth); UPDATE own student only (canteen_id/veg_mode via trigger); DELETE denied (soft_delete_own_account RPC).';



COMMENT ON COLUMN "public"."users"."is_banned" IS 'When true, client sign-in flow rejects the user (see AuthContext). Use service_role/SQL to set.';



COMMENT ON COLUMN "public"."users"."veg_mode_enabled" IS 'Stores whether the user has enabled Veg Mode in the app.';



COMMENT ON COLUMN "public"."users"."is_deleted" IS 'Soft-delete flag; true during 7-day grace before auth.users purge';



COMMENT ON COLUMN "public"."users"."deleted_at" IS 'When soft-delete started; purge when deleted_at <= now() - 7 days';



CREATE OR REPLACE VIEW "public"."z_active_open_canteens" WITH ("security_invoker"='true') AS
 SELECT "id",
    "college_id",
    "name",
    "is_active",
    "is_open",
    "is_deleted",
    "takeaway_charge",
    "app_orders_enabled",
    "auto_ready",
    "created_at",
    (("is_open" = true) AND ("app_orders_enabled" = true)) AS "accepting_app_orders"
   FROM "public"."canteens"
  WHERE (("is_deleted" = false) AND ("is_active" = true));


ALTER VIEW "public"."z_active_open_canteens" OWNER TO "postgres";


COMMENT ON VIEW "public"."z_active_open_canteens" IS 'Active non-deleted canteens with accepting_app_orders flag.';



CREATE OR REPLACE VIEW "public"."z_canteen_day_sales" WITH ("security_invoker"='true') AS
 SELECT "canteen_id",
    "token_date",
    "count"(*) AS "order_count",
    COALESCE("sum"("total_amount"), (0)::numeric) AS "revenue",
    "count"(*) FILTER (WHERE ("is_takeaway" IS TRUE)) AS "takeaway_count",
    "count"(*) FILTER (WHERE ("is_takeaway" IS NOT TRUE)) AS "dine_in_count",
    "history_source"
   FROM ( SELECT "orders"."canteen_id",
            "orders"."token_date",
            "orders"."total_amount",
            "orders"."is_takeaway",
            'live'::"text" AS "history_source"
           FROM "public"."orders"
          WHERE ("orders"."status" = 'delivered'::"text")
        UNION ALL
         SELECT "archived_orders"."canteen_id",
            "archived_orders"."token_date",
            "archived_orders"."total_amount",
            "archived_orders"."is_takeaway",
            'archived'::"text" AS "history_source"
           FROM "public"."archived_orders"
          WHERE ("archived_orders"."status" = 'delivered'::"text")) "s"
  GROUP BY "canteen_id", "token_date", "history_source";


ALTER VIEW "public"."z_canteen_day_sales" OWNER TO "postgres";


COMMENT ON VIEW "public"."z_canteen_day_sales" IS 'Delivered order counts/revenue by token_date.';



CREATE OR REPLACE VIEW "public"."z_cds_aggregated_items" WITH ("security_invoker"='true') AS
 SELECT "oi"."item_id",
    COALESCE("i"."name", 'Item'::"text") AS "item_name",
    "sum"("oi"."quantity") AS "total_quantity",
    "count"(DISTINCT "oi"."order_id") AS "order_count",
    "o"."canteen_id"
   FROM (("public"."order_items" "oi"
     JOIN "public"."orders" "o" ON (("o"."id" = "oi"."order_id")))
     LEFT JOIN "public"."items" "i" ON (("i"."id" = "oi"."item_id")))
  WHERE (("o"."status" = ANY (ARRAY['preparing'::"text", 'partially_ready'::"text", 'ready'::"text"])) AND ("oi"."status" = ANY (ARRAY['preparing'::"text", 'ready'::"text"])))
  GROUP BY "oi"."item_id", "i"."name", "o"."canteen_id";


ALTER VIEW "public"."z_cds_aggregated_items" OWNER TO "postgres";


COMMENT ON VIEW "public"."z_cds_aggregated_items" IS 'Kitchen CDS totals by item for open queue statuses.';



CREATE OR REPLACE VIEW "public"."z_kitchen_queue" WITH ("security_invoker"='true') AS
 SELECT "o"."id" AS "order_id",
    "o"."canteen_id",
    "o"."order_token",
    "o"."barcode",
    "o"."status" AS "order_status",
    "o"."is_takeaway",
    "o"."total_amount",
    "o"."placed_by",
    "o"."placed_by_role",
    "o"."created_at",
    "o"."updated_at",
    "o"."token_date",
    "oi"."id" AS "order_item_id",
    "oi"."item_id",
    "oi"."item_name",
    "oi"."quantity",
    "oi"."ready_count",
    "oi"."status" AS "item_status",
    "oi"."unit_price",
    "oi"."line_total"
   FROM ("public"."orders" "o"
     JOIN "public"."order_items" "oi" ON (("oi"."order_id" = "o"."id")))
  WHERE (("o"."status" = ANY (ARRAY['preparing'::"text", 'partially_ready'::"text", 'ready'::"text"])) AND ("oi"."status" = ANY (ARRAY['preparing'::"text", 'ready'::"text"])));


ALTER VIEW "public"."z_kitchen_queue" OWNER TO "postgres";


COMMENT ON VIEW "public"."z_kitchen_queue" IS 'Open kitchen order lines (preparing/ready).';



CREATE OR REPLACE VIEW "public"."z_menu_for_canteen" WITH ("security_invoker"='true') AS
 SELECT "i"."id",
    "i"."canteen_id",
    "i"."category_id",
    "i"."name",
    "i"."price",
    "i"."created_at",
    "i"."available_stock",
    "i"."is_active",
    "i"."image_url",
    "i"."is_vegetarian",
    "i"."description",
    "i"."ingredients",
    "i"."batch_size",
    "i"."is_available",
    "i"."is_deleted",
    "i"."auto_ready",
    "c"."name" AS "category_name",
    "c"."sort_order" AS "category_sort_order",
    "c"."image_url" AS "category_image_url"
   FROM ("public"."items" "i"
     JOIN "public"."categories" "c" ON (("c"."id" = "i"."category_id")))
  WHERE (("i"."is_deleted" = false) AND ("i"."is_active" = true) AND (COALESCE("c"."is_deleted", false) = false));


ALTER VIEW "public"."z_menu_for_canteen" OWNER TO "postgres";


COMMENT ON VIEW "public"."z_menu_for_canteen" IS 'Active menu items + category fields for a canteen.';



CREATE OR REPLACE VIEW "public"."z_order_payment_summary" WITH ("security_invoker"='true') AS
 SELECT DISTINCT ON ("p"."order_id") "p"."order_id",
    "p"."id" AS "payment_id",
    "p"."amount",
    "p"."status" AS "payment_status",
    "p"."gateway_name",
    "p"."gateway_order_id",
    "p"."gateway_payment_id",
    "p"."created_at" AS "payment_created_at",
    "p"."updated_at" AS "payment_updated_at",
    "o"."status" AS "order_status",
    "o"."canteen_id",
    "o"."placed_by",
    "o"."order_token",
    "o"."total_amount" AS "order_total"
   FROM ("public"."payments" "p"
     LEFT JOIN "public"."orders" "o" ON (("o"."id" = "p"."order_id")))
  ORDER BY "p"."order_id", "p"."created_at" DESC;


ALTER VIEW "public"."z_order_payment_summary" OWNER TO "postgres";


COMMENT ON VIEW "public"."z_order_payment_summary" IS 'Latest payment per order (service_role; payments RLS blocks clients).';



CREATE OR REPLACE VIEW "public"."z_refunds_due" WITH ("security_invoker"='true') AS
 SELECT "id",
    "payment_id",
    "order_id",
    "amount",
    "status",
    "gateway_name",
    "gateway_refund_id",
    "reason",
    "customer_email",
    "retry_count",
    "process_after",
    "created_at",
    "failure_reason"
   FROM "public"."refunds" "r"
  WHERE (("status" = 'scheduled'::"text") AND (("process_after" IS NULL) OR ("process_after" <= "timezone"('UTC'::"text", "now"()))));


ALTER VIEW "public"."z_refunds_due" OWNER TO "postgres";


COMMENT ON VIEW "public"."z_refunds_due" IS 'Scheduled refunds ready to process (service_role).';



CREATE OR REPLACE VIEW "public"."z_student_order_feed" WITH ("security_invoker"='true') AS
 SELECT "o"."id",
    "o"."canteen_id",
    "o"."placed_by",
    "o"."placed_by_role",
    "o"."order_token",
    "o"."barcode",
    "o"."status",
    "o"."is_takeaway",
    "o"."total_amount",
    "o"."token_date",
    "o"."created_at",
    "o"."updated_at",
    NULL::timestamp with time zone AS "archived_at",
    NULL::"text" AS "archive_reason",
    'live'::"text" AS "history_source"
   FROM "public"."orders" "o"
  WHERE ("o"."status" IS DISTINCT FROM 'pending_payment'::"text")
UNION ALL
 SELECT "a"."id",
    "a"."canteen_id",
    "a"."placed_by",
    "a"."placed_by_role",
    "a"."order_token",
    "a"."barcode",
    "a"."status",
    "a"."is_takeaway",
    "a"."total_amount",
    "a"."token_date",
    "a"."created_at",
    "a"."updated_at",
    "a"."archived_at",
    "a"."archive_reason",
    'archived'::"text" AS "history_source"
   FROM "public"."archived_orders" "a"
UNION ALL
 SELECT "f"."id",
    "f"."canteen_id",
    "f"."placed_by",
    "f"."placed_by_role",
    "f"."order_token",
    "f"."barcode",
    "f"."status",
    "f"."is_takeaway",
    "f"."total_amount",
    "f"."token_date",
    "f"."created_at",
    "f"."updated_at",
    "f"."archived_at",
    "f"."archive_reason",
    'failed'::"text" AS "history_source"
   FROM "public"."failed_orders" "f";


ALTER VIEW "public"."z_student_order_feed" OWNER TO "postgres";


COMMENT ON VIEW "public"."z_student_order_feed" IS 'Live + archived + failed order headers (RLS applies).';



CREATE OR REPLACE VIEW "public"."z_user_inbox" WITH ("security_invoker"='true') AS
 SELECT "id",
    "user_id",
    "title",
    "body",
    "type",
    "data",
    "is_read",
    "created_at"
   FROM "public"."notifications"
  WHERE ("is_read" = false);


ALTER VIEW "public"."z_user_inbox" OWNER TO "postgres";


COMMENT ON VIEW "public"."z_user_inbox" IS 'Unread notifications for the current user (RLS).';



ALTER TABLE ONLY "private"."hungertap_config"
    ADD CONSTRAINT "hungertap_config_pkey" PRIMARY KEY ("key");



ALTER TABLE ONLY "public"."archived_order_items"
    ADD CONSTRAINT "archived_order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."archived_orders"
    ADD CONSTRAINT "archived_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."archived_payments"
    ADD CONSTRAINT "archived_payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."archived_refunds"
    ADD CONSTRAINT "archived_refunds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."canteen_close_jobs"
    ADD CONSTRAINT "canteen_close_jobs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."canteen_daily_token_counters"
    ADD CONSTRAINT "canteen_daily_token_counters_pkey" PRIMARY KEY ("canteen_id", "token_date");



ALTER TABLE ONLY "public"."canteens"
    ADD CONSTRAINT "canteens_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."canteens"
    ADD CONSTRAINT "canteens_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."categories"
    ADD CONSTRAINT "categories_sort_order_key" UNIQUE ("sort_order");



ALTER TABLE ONLY "public"."colleges"
    ADD CONSTRAINT "colleges_name_key" UNIQUE ("name");



ALTER TABLE ONLY "public"."colleges"
    ADD CONSTRAINT "colleges_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."failed_order_items"
    ADD CONSTRAINT "failed_order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."failed_orders"
    ADD CONSTRAINT "failed_orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_barcode_key" UNIQUE ("barcode");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_gateways"
    ADD CONSTRAINT "payment_gateways_code_key" UNIQUE ("code");



ALTER TABLE ONLY "public"."payment_gateways"
    ADD CONSTRAINT "payment_gateways_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payment_webhook_events"
    ADD CONSTRAINT "payment_webhook_events_gateway_event_unique" UNIQUE ("gateway", "event_id");



ALTER TABLE ONLY "public"."payment_webhook_events"
    ADD CONSTRAINT "payment_webhook_events_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."payments"
    ADD CONSTRAINT "payments_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."refunds"
    ADD CONSTRAINT "refunds_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."system_error_logs"
    ADD CONSTRAINT "system_error_logs_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."user_tokens"
    ADD CONSTRAINT "user_tokens_new_pkey" PRIMARY KEY ("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_pkey" PRIMARY KEY ("id");



CREATE INDEX "archived_orders_archived_at_idx" ON "public"."archived_orders" USING "btree" ("archived_at");



CREATE INDEX "archived_orders_created_at_idx" ON "public"."archived_orders" USING "btree" ("created_at");



CREATE INDEX "archived_orders_updated_at_idx" ON "public"."archived_orders" USING "btree" ("updated_at");



CREATE INDEX "canteen_close_jobs_created_at_idx" ON "public"."canteen_close_jobs" USING "btree" ("created_at");



CREATE INDEX "idx_archived_order_items_item" ON "public"."archived_order_items" USING "btree" ("item_id");



CREATE INDEX "idx_archived_orders_archived_at_desc" ON "public"."archived_order_items" USING "btree" ("archived_at" DESC NULLS LAST);



COMMENT ON INDEX "public"."idx_archived_orders_archived_at_desc" IS 'Archived Orders list: ORDER BY archived_at DESC LIMIT n';



CREATE INDEX "idx_archived_orders_canteen_archived" ON "public"."archived_orders" USING "btree" ("canteen_id", "archived_at" DESC);



CREATE INDEX "idx_archived_orders_canteen_token_date" ON "public"."archived_orders" USING "btree" ("canteen_id", "token_date");



CREATE INDEX "idx_archived_orders_order_id" ON "public"."archived_order_items" USING "btree" ("order_id");



COMMENT ON INDEX "public"."idx_archived_orders_order_id" IS 'Restore/delete by order_id; IN (order_id...) for dashboard revenue.';



CREATE INDEX "idx_archived_orders_placed_by" ON "public"."archived_orders" USING "btree" ("placed_by");



CREATE INDEX "idx_archived_orders_placed_by_canteen_token_date" ON "public"."archived_orders" USING "btree" ("placed_by", "canteen_id", "token_date");



CREATE INDEX "idx_archived_payments_order_id" ON "public"."archived_payments" USING "btree" ("order_id");



CREATE INDEX "idx_archived_refunds_order_id" ON "public"."archived_refunds" USING "btree" ("order_id");



CREATE INDEX "idx_canteen_close_jobs_canteen_id" ON "public"."canteen_close_jobs" USING "btree" ("canteen_id");



CREATE INDEX "idx_canteen_close_jobs_pending" ON "public"."canteen_close_jobs" USING "btree" ("created_at") WHERE ("status" = 'pending'::"text");



CREATE INDEX "idx_canteens_college_id" ON "public"."canteens" USING "btree" ("college_id");



CREATE INDEX "idx_failed_order_items_order_id" ON "public"."failed_order_items" USING "btree" ("order_id");



CREATE INDEX "idx_failed_orders_canteen_archived" ON "public"."failed_orders" USING "btree" ("canteen_id", "archived_at" DESC);



CREATE INDEX "idx_failed_orders_canteen_token_date" ON "public"."failed_orders" USING "btree" ("canteen_id", "token_date");



CREATE INDEX "idx_failed_orders_placed_by" ON "public"."failed_orders" USING "btree" ("placed_by");



CREATE INDEX "idx_failed_orders_placed_by_canteen_token_date" ON "public"."failed_orders" USING "btree" ("placed_by", "canteen_id", "token_date");



CREATE INDEX "idx_items_canteen_active_not_deleted" ON "public"."items" USING "btree" ("canteen_id") WHERE (("is_active" = true) AND ("is_deleted" = false));



CREATE INDEX "idx_items_canteen_id_is_active" ON "public"."items" USING "btree" ("canteen_id", "is_active");



COMMENT ON INDEX "public"."idx_items_canteen_id_is_active" IS 'Canteen menu / filtered lists; canteen_id-only uses left prefix.';



CREATE INDEX "idx_items_category_id" ON "public"."items" USING "btree" ("category_id");



CREATE INDEX "idx_items_id_canteen_price" ON "public"."items" USING "btree" ("id", "canteen_id") INCLUDE ("name", "price", "category_id");



CREATE INDEX "idx_order_items_created_at" ON "public"."order_items" USING "btree" ("created_at");



COMMENT ON INDEX "public"."idx_order_items_created_at" IS 'Global time filters without order_id (use only if profiling shows benefit).';



CREATE INDEX "idx_order_items_fifo_queue" ON "public"."order_items" USING "btree" ("item_id", "status", "created_at");



CREATE INDEX "idx_order_items_item" ON "public"."order_items" USING "btree" ("item_id");



CREATE INDEX "idx_order_items_item_id_status" ON "public"."order_items" USING "btree" ("item_id", "status");



COMMENT ON INDEX "public"."idx_order_items_item_id_status" IS 'allocate_ready_fifo_resolver, get_item_order_count; item_id prefix alone covered.';



CREATE INDEX "idx_order_items_order" ON "public"."order_items" USING "btree" ("order_id");



CREATE INDEX "idx_order_items_order_id_created_at" ON "public"."order_items" USING "btree" ("order_id", "created_at");



COMMENT ON INDEX "public"."idx_order_items_order_id_created_at" IS 'Lines per order + sort; UPDATE WHERE order_id uses prefix.';



CREATE INDEX "idx_order_items_order_id_status" ON "public"."order_items" USING "btree" ("order_id", "status");



CREATE INDEX "idx_order_items_status" ON "public"."order_items" USING "btree" ("status");



CREATE INDEX "idx_orders_canteen_created_token" ON "public"."orders" USING "btree" ("canteen_id", "created_at" DESC, "order_token" DESC);



CREATE INDEX "idx_orders_canteen_id" ON "public"."orders" USING "btree" ("canteen_id");



CREATE INDEX "idx_orders_canteen_id_created_at" ON "public"."orders" USING "btree" ("canteen_id", "created_at" DESC);



COMMENT ON INDEX "public"."idx_orders_canteen_id_created_at" IS 'Canteen dashboards, predictions, notifications; prefix on canteen_id.';



CREATE INDEX "idx_orders_canteen_status" ON "public"."orders" USING "btree" ("canteen_id", "status");



CREATE INDEX "idx_orders_canteen_token" ON "public"."orders" USING "btree" ("canteen_id", "order_token");



CREATE INDEX "idx_orders_created_at" ON "public"."orders" USING "btree" ("created_at" DESC);



COMMENT ON INDEX "public"."idx_orders_created_at" IS 'Global created_at filters; optional if all queries scope canteen_id.';



CREATE INDEX "idx_orders_order_token" ON "public"."orders" USING "btree" ("order_token");



COMMENT ON INDEX "public"."idx_orders_order_token" IS 'eq(order_token) for scan + generateUniqueToken collision checks.';



CREATE INDEX "idx_orders_placed_by" ON "public"."orders" USING "btree" ("placed_by");



CREATE INDEX "idx_orders_placed_by_canteen_token_date" ON "public"."orders" USING "btree" ("placed_by", "canteen_id", "token_date");



CREATE INDEX "idx_orders_rate_created" ON "public"."orders" USING "btree" ("placed_by", "created_at" DESC);



CREATE INDEX "idx_orders_rate_status" ON "public"."orders" USING "btree" ("placed_by", "status");



CREATE INDEX "idx_payments_order_id" ON "public"."payments" USING "btree" ("order_id");



CREATE INDEX "idx_payments_status_created_at" ON "public"."payments" USING "btree" ("status", "created_at");



CREATE INDEX "idx_refunds_order_id" ON "public"."refunds" USING "btree" ("order_id");



CREATE INDEX "idx_system_error_logs_created_at" ON "public"."system_error_logs" USING "btree" ("created_at" DESC);



CREATE INDEX "idx_system_error_logs_order_id" ON "public"."system_error_logs" USING "btree" ("order_id") WHERE ("order_id" IS NOT NULL);



CREATE INDEX "idx_system_error_logs_request_id" ON "public"."system_error_logs" USING "btree" ("request_id") WHERE ("request_id" IS NOT NULL);



CREATE INDEX "idx_system_error_logs_service_created" ON "public"."system_error_logs" USING "btree" ("service", "created_at" DESC);



CREATE INDEX "idx_system_error_logs_user_id" ON "public"."system_error_logs" USING "btree" ("user_id") WHERE ("user_id" IS NOT NULL);



CREATE INDEX "idx_user_tokens_user_enabled" ON "public"."user_tokens" USING "btree" ("user_id") WHERE ("is_enabled" = true);



CREATE INDEX "idx_user_tokens_user_id" ON "public"."user_tokens" USING "btree" ("user_id");



CREATE INDEX "idx_users_canteen_id" ON "public"."users" USING "btree" ("canteen_id");



CREATE INDEX "idx_users_college_id" ON "public"."users" USING "btree" ("college_id");



CREATE INDEX "idx_users_role" ON "public"."users" USING "btree" ("role");



COMMENT ON INDEX "public"."idx_users_role" IS 'Global role filters (admin check, getAdminUserId).';



CREATE INDEX "items_available_stock_idx" ON "public"."items" USING "btree" ("available_stock");



CREATE INDEX "items_canteen_id_idx" ON "public"."items" USING "btree" ("canteen_id");



CREATE INDEX "items_is_active_idx" ON "public"."items" USING "btree" ("is_active");



CREATE INDEX "items_is_deleted_idx" ON "public"."items" USING "btree" ("is_deleted");



CREATE INDEX "items_name_idx" ON "public"."items" USING "btree" ("name");



CREATE UNIQUE INDEX "max_one_default_payment_gateway" ON "public"."payment_gateways" USING "btree" ("is_default") WHERE ("is_default" = true);



CREATE INDEX "notifications_user_id_idx" ON "public"."notifications" USING "btree" ("user_id");



CREATE INDEX "orders_status_idx" ON "public"."orders" USING "btree" ("status");



CREATE INDEX "orders_updated_at_idx" ON "public"."orders" USING "btree" ("updated_at");



CREATE INDEX "payments_gateway_order_id_idx" ON "public"."payments" USING "btree" ("gateway_order_id");



CREATE UNIQUE INDEX "payments_gateway_order_id_unique" ON "public"."payments" USING "btree" ("lower"("gateway_name"), "gateway_order_id") WHERE ("gateway_order_id" IS NOT NULL);



CREATE UNIQUE INDEX "payments_gateway_payment_id_unique" ON "public"."payments" USING "btree" ("lower"("gateway_name"), "gateway_payment_id") WHERE ("gateway_payment_id" IS NOT NULL);



CREATE UNIQUE INDEX "refunds_gateway_refund_id_unique" ON "public"."refunds" USING "btree" ("lower"("gateway_name"), "gateway_refund_id") WHERE ("gateway_refund_id" IS NOT NULL);



CREATE INDEX "refunds_scheduled_due_idx" ON "public"."refunds" USING "btree" ("process_after") WHERE ("status" = 'scheduled'::"text");



CREATE UNIQUE INDEX "unique_refunds_payment_id" ON "public"."refunds" USING "btree" ("payment_id");



CREATE UNIQUE INDEX "uq_idx_orders_daily_token" ON "public"."orders" USING "btree" ("canteen_id", "token_date", "order_token") WHERE ("order_token" IS NOT NULL);



CREATE UNIQUE INDEX "user_tokens_fcm_token_key" ON "public"."user_tokens" USING "btree" ("fcm_token");



CREATE INDEX "users_soft_deleted_purge_idx" ON "public"."users" USING "btree" ("deleted_at") WHERE ("is_deleted" IS TRUE);



CREATE OR REPLACE TRIGGER "canteens_cache_sync" AFTER UPDATE ON "public"."canteens" FOR EACH ROW EXECUTE FUNCTION "public"."notify_sync_canteen_cache"();



CREATE OR REPLACE TRIGGER "categories_cache_sync" AFTER INSERT OR DELETE OR UPDATE ON "public"."categories" FOR EACH ROW EXECUTE FUNCTION "public"."notify_sync_canteen_cache"();



CREATE OR REPLACE TRIGGER "colleges_cache_sync" AFTER UPDATE ON "public"."colleges" FOR EACH ROW EXECUTE FUNCTION "public"."notify_sync_canteen_cache"();



CREATE OR REPLACE TRIGGER "items_cache_sync" AFTER INSERT OR DELETE OR UPDATE ON "public"."items" FOR EACH ROW EXECUTE FUNCTION "public"."notify_sync_canteen_cache"();



CREATE OR REPLACE TRIGGER "notifications_push" AFTER INSERT ON "public"."notifications" FOR EACH ROW EXECUTE FUNCTION "public"."notify_push_on_notification"();



CREATE OR REPLACE TRIGGER "restrict_canteen_update" BEFORE UPDATE ON "public"."canteens" FOR EACH ROW EXECUTE FUNCTION "public"."restrict_canteen_update"();



CREATE OR REPLACE TRIGGER "restrict_item_updates" BEFORE UPDATE ON "public"."items" FOR EACH ROW EXECUTE FUNCTION "public"."restrict_item_updates"();



CREATE OR REPLACE TRIGGER "restrict_notification_update" BEFORE UPDATE ON "public"."notifications" FOR EACH ROW EXECUTE FUNCTION "public"."prevent_notification_update"();



CREATE OR REPLACE TRIGGER "restrict_user_update" BEFORE UPDATE ON "public"."users" FOR EACH ROW EXECUTE FUNCTION "public"."restrict_user_update"();



CREATE OR REPLACE TRIGGER "sync_order_items_status_from_orders" AFTER UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."sync_order_items_status_from_order"();



CREATE OR REPLACE TRIGGER "trg_canteens_enqueue_close_job" AFTER UPDATE OF "is_open" ON "public"."canteens" FOR EACH ROW EXECUTE FUNCTION "public"."enqueue_canteen_close_job"();



CREATE OR REPLACE TRIGGER "trg_check_stock_before_order_item_insert" BEFORE INSERT ON "public"."order_items" FOR EACH ROW WHEN (("new"."status" = 'pending_payment'::"text")) EXECUTE FUNCTION "public"."check_available_stock_before_insert"();



CREATE OR REPLACE TRIGGER "trg_close_college" AFTER UPDATE OF "is_deleted" ON "public"."colleges" FOR EACH ROW EXECUTE FUNCTION "public"."handle_close_college"();



CREATE OR REPLACE TRIGGER "trg_enforce_order_rate_limits" BEFORE INSERT ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."enforce_order_rate_limits"();



CREATE OR REPLACE TRIGGER "trg_items_sync_is_available" BEFORE INSERT OR UPDATE OF "available_stock" ON "public"."items" FOR EACH ROW EXECUTE FUNCTION "public"."sync_items_is_available_from_stock"();



CREATE OR REPLACE TRIGGER "trg_order_status_notification" AFTER UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."create_order_status_notification"();



CREATE OR REPLACE TRIGGER "trg_orders_cancel_scheduled_refund_on_uncancel" BEFORE UPDATE OF "status" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."trg_orders_cancel_scheduled_refund_on_uncancel"();



CREATE OR REPLACE TRIGGER "trg_orders_ensure_refund_on_cancel" AFTER UPDATE OF "status" ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."trg_orders_ensure_refund_on_cancel"();



CREATE OR REPLACE TRIGGER "trg_refund_status_notification" AFTER INSERT OR UPDATE OF "status" ON "public"."refunds" FOR EACH ROW EXECUTE FUNCTION "public"."create_refund_status_notification"();



CREATE OR REPLACE TRIGGER "trg_refunds_hold_window" BEFORE INSERT ON "public"."refunds" FOR EACH ROW EXECUTE FUNCTION "public"."trg_refunds_hold_window"();



CREATE OR REPLACE TRIGGER "trg_refunds_notify_insert" AFTER INSERT ON "public"."refunds" FOR EACH ROW EXECUTE FUNCTION "public"."notify_refund_edge"();



CREATE OR REPLACE TRIGGER "trg_refunds_notify_update" AFTER UPDATE OF "status", "retry_count" ON "public"."refunds" FOR EACH ROW EXECUTE FUNCTION "public"."notify_refund_edge"();



CREATE OR REPLACE TRIGGER "trg_restore_stock_on_cancel" AFTER UPDATE OF "status" ON "public"."order_items" FOR EACH ROW WHEN ((("old"."status" IS DISTINCT FROM "new"."status") AND ("old"."status" = ANY (ARRAY['preparing'::"text", 'ready'::"text"])) AND ("new"."status" = 'cancelled_by_vendor'::"text"))) EXECUTE FUNCTION "public"."restore_stock_on_cancel"();



CREATE OR REPLACE TRIGGER "trg_restrict_order_item_updates" BEFORE UPDATE ON "public"."order_items" FOR EACH ROW EXECUTE FUNCTION "public"."restrict_order_item_update"();



CREATE OR REPLACE TRIGGER "trg_restrict_order_updates" BEFORE UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."restrict_order_update"();



CREATE OR REPLACE TRIGGER "trg_set_order_items_updated_at" BEFORE UPDATE ON "public"."order_items" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_set_orders_delivered_at" BEFORE UPDATE OF "status" ON "public"."orders" FOR EACH ROW WHEN ((("new"."status" = 'delivered'::"text") AND ("old"."status" IS DISTINCT FROM "new"."status"))) EXECUTE FUNCTION "public"."set_delivered_at_on_status"();



CREATE OR REPLACE TRIGGER "trg_set_orders_updated_at" BEFORE UPDATE ON "public"."orders" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



CREATE OR REPLACE TRIGGER "trg_soft_delete_item" BEFORE DELETE ON "public"."items" FOR EACH ROW EXECUTE FUNCTION "public"."soft_delete_item_instead_of_hard_delete"();



CREATE OR REPLACE TRIGGER "trg_sync_order_status_from_order_items" AFTER UPDATE ON "public"."order_items" FOR EACH ROW EXECUTE FUNCTION "public"."sync_order_status_from_order_items"();



CREATE OR REPLACE TRIGGER "trg_user_tokens_updated_at" BEFORE UPDATE ON "public"."user_tokens" FOR EACH ROW EXECUTE FUNCTION "public"."set_updated_at"();



ALTER TABLE ONLY "public"."archived_order_items"
    ADD CONSTRAINT "archieved_order_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id");



ALTER TABLE ONLY "public"."archived_order_items"
    ADD CONSTRAINT "archieved_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."archived_orders"("id") ON UPDATE CASCADE ON DELETE CASCADE;



ALTER TABLE ONLY "public"."archived_orders"
    ADD CONSTRAINT "archieved_orders_canteen_id_fkey" FOREIGN KEY ("canteen_id") REFERENCES "public"."canteens"("id");



ALTER TABLE ONLY "public"."canteen_close_jobs"
    ADD CONSTRAINT "canteen_close_jobs_canteen_id_fkey" FOREIGN KEY ("canteen_id") REFERENCES "public"."canteens"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."canteen_daily_token_counters"
    ADD CONSTRAINT "canteen_daily_token_counters_canteen_id_fkey" FOREIGN KEY ("canteen_id") REFERENCES "public"."canteens"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."canteens"
    ADD CONSTRAINT "canteens_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "public"."colleges"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."failed_order_items"
    ADD CONSTRAINT "failed_order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."failed_orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."failed_orders"
    ADD CONSTRAINT "failed_orders_canteen_id_fkey" FOREIGN KEY ("canteen_id") REFERENCES "public"."canteens"("id");



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_canteen_id_fkey" FOREIGN KEY ("canteen_id") REFERENCES "public"."canteens"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."items"
    ADD CONSTRAINT "items_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "public"."categories"("id") ON DELETE SET NULL;



ALTER TABLE ONLY "public"."notifications"
    ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "public"."items"("id");



ALTER TABLE ONLY "public"."order_items"
    ADD CONSTRAINT "order_items_order_id_fkey" FOREIGN KEY ("order_id") REFERENCES "public"."orders"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_canteen_id_fkey" FOREIGN KEY ("canteen_id") REFERENCES "public"."canteens"("id");



ALTER TABLE ONLY "public"."orders"
    ADD CONSTRAINT "orders_placed_by_fkey" FOREIGN KEY ("placed_by") REFERENCES "public"."users"("id");



ALTER TABLE ONLY "public"."refunds"
    ADD CONSTRAINT "refunds_payment_id_fkey" FOREIGN KEY ("payment_id") REFERENCES "public"."payments"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."user_tokens"
    ADD CONSTRAINT "user_tokens_new_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "auth"."users"("id") ON DELETE CASCADE;



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_canteen_id_fkey" FOREIGN KEY ("canteen_id") REFERENCES "public"."canteens"("id");



ALTER TABLE ONLY "public"."users"
    ADD CONSTRAINT "users_college_id_fkey" FOREIGN KEY ("college_id") REFERENCES "public"."colleges"("id");



ALTER TABLE "private"."hungertap_config" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "Allow service_role full access to system_error_logs" ON "public"."system_error_logs" TO "service_role" USING (true) WITH CHECK (true);



CREATE POLICY "admin_insert_items" ON "public"."items" FOR INSERT TO "authenticated" WITH CHECK ((("canteen_id" = "public"."get_my_canteen_id"()) AND ("public"."get_my_role"() = 'canteen_admin'::"text")));



CREATE POLICY "admin_update_items" ON "public"."items" FOR UPDATE TO "authenticated" USING ((("canteen_id" = "public"."get_my_canteen_id"()) AND ("public"."get_my_role"() = 'canteen_admin'::"text"))) WITH CHECK ((("canteen_id" = "public"."get_my_canteen_id"()) AND ("public"."get_my_role"() = 'canteen_admin'::"text")));



CREATE POLICY "archieved_orders_select" ON "public"."archived_orders" FOR SELECT USING ((("placed_by" = "public"."get_my_user_id"()) OR (("canteen_id" = "public"."get_my_canteen_id"()) AND ("public"."get_my_role"() = 'canteen_admin'::"text"))));



CREATE POLICY "archived_items_select" ON "public"."archived_order_items" FOR SELECT USING ((EXISTS ( SELECT 1
   FROM "public"."archived_orders" "ao"
  WHERE (("ao"."id" = "archived_order_items"."order_id") AND (("ao"."placed_by" = "public"."get_my_user_id"()) OR (("ao"."canteen_id" = "public"."get_my_canteen_id"()) AND ("public"."get_my_role"() = 'canteen_admin'::"text")))))));



ALTER TABLE "public"."archived_order_items" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."archived_orders" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."archived_payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."archived_refunds" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."canteen_close_jobs" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."canteen_daily_token_counters" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."canteens" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "canteens_select_authenticated" ON "public"."canteens" FOR SELECT TO "authenticated" USING (((("public"."get_my_role"() = 'student'::"text") AND ("college_id" = "public"."get_my_college_id"()) AND ("is_active" = true) AND ("is_deleted" = false)) OR (("public"."get_my_role"() = 'canteen_admin'::"text") AND ("id" = "public"."get_my_canteen_id"()))));



CREATE POLICY "canteens_update" ON "public"."canteens" FOR UPDATE TO "authenticated" USING ((("id" = "public"."get_my_canteen_id"()) AND ("public"."get_my_role"() = 'canteen_admin'::"text"))) WITH CHECK ((("id" = "public"."get_my_canteen_id"()) AND ("public"."get_my_role"() = 'canteen_admin'::"text")));



ALTER TABLE "public"."categories" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."colleges" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "colleges_no_delete" ON "public"."colleges" FOR DELETE TO "authenticated", "anon" USING (false);



CREATE POLICY "colleges_no_insert" ON "public"."colleges" FOR INSERT TO "authenticated", "anon" WITH CHECK (false);



CREATE POLICY "colleges_no_update" ON "public"."colleges" FOR UPDATE TO "authenticated", "anon" USING (false) WITH CHECK (false);



CREATE POLICY "colleges_select" ON "public"."colleges" FOR SELECT TO "authenticated" USING ((("id" = "public"."get_my_college_id"()) AND ("is_deleted" IS NOT TRUE)));



ALTER TABLE "public"."failed_order_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "failed_order_items_select" ON "public"."failed_order_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."failed_orders" "fo"
  WHERE (("fo"."id" = "failed_order_items"."order_id") AND (("fo"."placed_by" = "public"."get_my_user_id"()) OR (("fo"."canteen_id" = "public"."get_my_canteen_id"()) AND ("public"."get_my_role"() = 'canteen_admin'::"text")))))));



ALTER TABLE "public"."failed_orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "failed_orders_select" ON "public"."failed_orders" FOR SELECT TO "authenticated" USING ((("placed_by" = "public"."get_my_user_id"()) OR (("canteen_id" = "public"."get_my_canteen_id"()) AND ("public"."get_my_role"() = 'canteen_admin'::"text"))));



ALTER TABLE "public"."items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "items_select" ON "public"."items" FOR SELECT TO "authenticated" USING ((("canteen_id" = ( SELECT "public"."get_my_canteen_id"() AS "get_my_canteen_id")) AND (((( SELECT "public"."get_my_role"() AS "get_my_role") = 'student'::"text") AND ("is_active" = true) AND ("is_deleted" = false) AND (("is_vegetarian" = true) OR (( SELECT "u"."veg_mode_enabled"
   FROM "public"."users" "u"
  WHERE ("u"."id" = ( SELECT "public"."get_my_user_id"() AS "get_my_user_id"))) = false))) OR (( SELECT "public"."get_my_role"() AS "get_my_role") = 'canteen_admin'::"text"))));



CREATE POLICY "no_all_archieved_payments_ins" ON "public"."archived_payments" FOR INSERT WITH CHECK (false);



CREATE POLICY "no_all_archieved_refunds_ins" ON "public"."archived_refunds" FOR INSERT WITH CHECK (false);



CREATE POLICY "no_client_canteen_close_jobs" ON "public"."canteen_close_jobs" TO "authenticated", "anon" USING (false) WITH CHECK (false);



CREATE POLICY "no_client_payment_webhook_events" ON "public"."payment_webhook_events" TO "authenticated", "anon" USING (false) WITH CHECK (false);



CREATE POLICY "no_client_payments" ON "public"."payments" TO "authenticated", "anon" USING (false) WITH CHECK (false);



CREATE POLICY "no_client_refunds" ON "public"."refunds" TO "authenticated", "anon" USING (false) WITH CHECK (false);



CREATE POLICY "no_client_token_counters" ON "public"."canteen_daily_token_counters" TO "authenticated", "anon" USING (false) WITH CHECK (false);



CREATE POLICY "no_delete_archieved_orders" ON "public"."archived_orders" FOR DELETE USING (false);



CREATE POLICY "no_delete_archived" ON "public"."archived_order_items" FOR DELETE TO "authenticated" USING (false);



CREATE POLICY "no_delete_canteens" ON "public"."canteens" FOR DELETE TO "authenticated" USING (false);



CREATE POLICY "no_delete_categories" ON "public"."categories" FOR DELETE TO "authenticated" USING (false);



CREATE POLICY "no_delete_failed_order_items" ON "public"."failed_order_items" FOR DELETE TO "authenticated", "anon" USING (false);



CREATE POLICY "no_delete_failed_orders" ON "public"."failed_orders" FOR DELETE TO "authenticated", "anon" USING (false);



CREATE POLICY "no_delete_items" ON "public"."items" FOR DELETE TO "authenticated", "anon" USING (false);



CREATE POLICY "no_delete_notifications" ON "public"."notifications" FOR DELETE TO "authenticated", "anon" USING (false);



CREATE POLICY "no_delete_payment_gateways" ON "public"."payment_gateways" FOR DELETE TO "authenticated", "anon" USING (false);



CREATE POLICY "no_insert_archieved_orders" ON "public"."archived_orders" FOR INSERT WITH CHECK (false);



CREATE POLICY "no_insert_archived" ON "public"."archived_order_items" FOR INSERT TO "authenticated" WITH CHECK (false);



CREATE POLICY "no_insert_canteens" ON "public"."canteens" FOR INSERT TO "authenticated" WITH CHECK (false);



CREATE POLICY "no_insert_categories" ON "public"."categories" FOR INSERT TO "authenticated" WITH CHECK (false);



CREATE POLICY "no_insert_failed_order_items" ON "public"."failed_order_items" FOR INSERT TO "authenticated", "anon" WITH CHECK (false);



CREATE POLICY "no_insert_failed_orders" ON "public"."failed_orders" FOR INSERT TO "authenticated", "anon" WITH CHECK (false);



CREATE POLICY "no_insert_notifications" ON "public"."notifications" FOR INSERT TO "authenticated", "anon" WITH CHECK (false);



CREATE POLICY "no_insert_payment_gateways" ON "public"."payment_gateways" FOR INSERT TO "authenticated", "anon" WITH CHECK (false);



CREATE POLICY "no_select_archieved_payments" ON "public"."archived_payments" FOR SELECT USING (false);



CREATE POLICY "no_select_archieved_refunds" ON "public"."archived_refunds" FOR SELECT USING (false);



CREATE POLICY "no_update_archieved_orders" ON "public"."archived_orders" FOR UPDATE USING (false);



CREATE POLICY "no_update_categories" ON "public"."categories" FOR UPDATE TO "authenticated" USING (false);



CREATE POLICY "no_update_failed_order_items" ON "public"."failed_order_items" FOR UPDATE TO "authenticated", "anon" USING (false) WITH CHECK (false);



CREATE POLICY "no_update_failed_orders" ON "public"."failed_orders" FOR UPDATE TO "authenticated", "anon" USING (false) WITH CHECK (false);



CREATE POLICY "no_update_payment_gateways" ON "public"."payment_gateways" FOR UPDATE TO "authenticated", "anon" USING (false) WITH CHECK (false);



ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "notifications_select_own" ON "public"."notifications" FOR SELECT TO "authenticated" USING (("user_id" = "public"."get_my_user_id"()));



CREATE POLICY "notifications_update_own" ON "public"."notifications" FOR UPDATE TO "authenticated" USING (("user_id" = "public"."get_my_user_id"())) WITH CHECK (("user_id" = "public"."get_my_user_id"()));



ALTER TABLE "public"."order_items" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "order_items_no_delete" ON "public"."order_items" FOR DELETE TO "authenticated", "anon" USING (false);



CREATE POLICY "order_items_no_insert" ON "public"."order_items" FOR INSERT TO "authenticated", "anon" WITH CHECK (false);



CREATE POLICY "order_items_select_via_order" ON "public"."order_items" FOR SELECT TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "order_items"."order_id") AND (("o"."placed_by" = ( SELECT "public"."get_my_user_id"() AS "get_my_user_id")) OR (("o"."canteen_id" = ( SELECT "public"."get_my_canteen_id"() AS "get_my_canteen_id")) AND (( SELECT "public"."get_my_role"() AS "get_my_role") = 'canteen_admin'::"text")))))));



CREATE POLICY "order_items_update_canteen_admin" ON "public"."order_items" FOR UPDATE TO "authenticated" USING ((EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "order_items"."order_id") AND ("o"."canteen_id" = ( SELECT "public"."get_my_canteen_id"() AS "get_my_canteen_id")) AND (( SELECT "public"."get_my_role"() AS "get_my_role") = 'canteen_admin'::"text"))))) WITH CHECK ((EXISTS ( SELECT 1
   FROM "public"."orders" "o"
  WHERE (("o"."id" = "order_items"."order_id") AND ("o"."canteen_id" = ( SELECT "public"."get_my_canteen_id"() AS "get_my_canteen_id")) AND (( SELECT "public"."get_my_role"() AS "get_my_role") = 'canteen_admin'::"text")))));



ALTER TABLE "public"."orders" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "orders_no_delete" ON "public"."orders" FOR DELETE TO "authenticated", "anon" USING (false);



CREATE POLICY "orders_no_insert" ON "public"."orders" FOR INSERT TO "authenticated", "anon" WITH CHECK (false);



CREATE POLICY "orders_select_own_or_canteen" ON "public"."orders" FOR SELECT TO "authenticated" USING ((("placed_by" = ( SELECT "public"."get_my_user_id"() AS "get_my_user_id")) OR (("canteen_id" = ( SELECT "public"."get_my_canteen_id"() AS "get_my_canteen_id")) AND (( SELECT "public"."get_my_role"() AS "get_my_role") = 'canteen_admin'::"text"))));



CREATE POLICY "orders_update_canteen_admin" ON "public"."orders" FOR UPDATE TO "authenticated" USING ((("canteen_id" = ( SELECT "public"."get_my_canteen_id"() AS "get_my_canteen_id")) AND (( SELECT "public"."get_my_role"() AS "get_my_role") = 'canteen_admin'::"text"))) WITH CHECK ((("canteen_id" = ( SELECT "public"."get_my_canteen_id"() AS "get_my_canteen_id")) AND (( SELECT "public"."get_my_role"() AS "get_my_role") = 'canteen_admin'::"text")));



ALTER TABLE "public"."payment_gateways" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "payment_gateways_select" ON "public"."payment_gateways" FOR SELECT TO "authenticated" USING ((("enabled" = true) AND ("user_selectable" = true)));



ALTER TABLE "public"."payment_webhook_events" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."payments" ENABLE ROW LEVEL SECURITY;


ALTER TABLE "public"."refunds" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "service_role_payment_webhook_events" ON "public"."payment_webhook_events" TO "service_role" USING (true) WITH CHECK (true);



ALTER TABLE "public"."system_error_logs" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "system_error_logs_no_delete" ON "public"."system_error_logs" FOR DELETE TO "authenticated", "anon" USING (false);



CREATE POLICY "system_error_logs_no_insert" ON "public"."system_error_logs" FOR INSERT TO "authenticated", "anon" WITH CHECK (false);



CREATE POLICY "system_error_logs_no_select" ON "public"."system_error_logs" FOR SELECT TO "authenticated", "anon" USING (false);



CREATE POLICY "system_error_logs_no_update" ON "public"."system_error_logs" FOR UPDATE TO "authenticated", "anon" USING (false) WITH CHECK (false);



ALTER TABLE "public"."user_tokens" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "user_tokens_delete_own" ON "public"."user_tokens" FOR DELETE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "user_tokens_insert_own" ON "public"."user_tokens" FOR INSERT TO "authenticated" WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "user_tokens_select_own" ON "public"."user_tokens" FOR SELECT TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



CREATE POLICY "user_tokens_update_own" ON "public"."user_tokens" FOR UPDATE TO "authenticated" USING (("user_id" = ( SELECT "auth"."uid"() AS "uid"))) WITH CHECK (("user_id" = ( SELECT "auth"."uid"() AS "uid")));



ALTER TABLE "public"."users" ENABLE ROW LEVEL SECURITY;


CREATE POLICY "users_can_view_categories" ON "public"."categories" FOR SELECT TO "authenticated" USING (("is_deleted" = false));



CREATE POLICY "users_no_delete" ON "public"."users" FOR DELETE TO "authenticated", "anon" USING (false);



CREATE POLICY "users_no_insert" ON "public"."users" FOR INSERT TO "authenticated", "anon" WITH CHECK (false);



CREATE POLICY "users_select_own" ON "public"."users" FOR SELECT TO "authenticated" USING (("id" = ( SELECT "public"."get_my_user_id"() AS "get_my_user_id")));



CREATE POLICY "users_update_own_student" ON "public"."users" FOR UPDATE TO "authenticated" USING ((("id" = ( SELECT "public"."get_my_user_id"() AS "get_my_user_id")) AND (( SELECT "public"."get_my_role"() AS "get_my_role") = 'student'::"text"))) WITH CHECK ((("id" = ( SELECT "public"."get_my_user_id"() AS "get_my_user_id")) AND (( SELECT "public"."get_my_role"() AS "get_my_role") = 'student'::"text")));





ALTER PUBLICATION "supabase_realtime" OWNER TO "postgres";






ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."canteens";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."items";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."order_items";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."orders";



ALTER PUBLICATION "supabase_realtime" ADD TABLE ONLY "public"."payments";









GRANT USAGE ON SCHEMA "private" TO "service_role";



GRANT USAGE ON SCHEMA "public" TO "postgres";
GRANT USAGE ON SCHEMA "public" TO "anon";
GRANT USAGE ON SCHEMA "public" TO "authenticated";
GRANT USAGE ON SCHEMA "public" TO "service_role";














































































































































































































































































































































































REVOKE ALL ON FUNCTION "public"."allocate_ready_count_fifo"("p_item_id" "text", "p_ready_count_to_allocate" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."allocate_ready_count_fifo"("p_item_id" "text", "p_ready_count_to_allocate" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."allocate_ready_count_fifo"("p_item_id" "text", "p_ready_count_to_allocate" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_payment_success"("p_payment_id" "uuid", "p_order_id" "uuid", "p_gateway_payment_id" "text", "p_gateway_response" "jsonb", "p_gateway_name" "text", "p_verify_amount" numeric, "p_verify_currency" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_payment_success"("p_payment_id" "uuid", "p_order_id" "uuid", "p_gateway_payment_id" "text", "p_gateway_response" "jsonb", "p_gateway_name" "text", "p_verify_amount" numeric, "p_verify_currency" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."apply_refund_success"("p_gateway_name" "text", "p_gateway_refund_id" "text", "p_gateway_response" "jsonb", "p_verify_amount" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."apply_refund_success"("p_gateway_name" "text", "p_gateway_refund_id" "text", "p_gateway_response" "jsonb", "p_verify_amount" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."calculate_cart_totals_v2"("p_canteen_id" "uuid", "p_items" "jsonb", "p_is_takeaway" boolean, "p_takeaway_charge" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."calculate_cart_totals_v2"("p_canteen_id" "uuid", "p_items" "jsonb", "p_is_takeaway" boolean, "p_takeaway_charge" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."calculate_cart_totals_v2"("p_canteen_id" "uuid", "p_items" "jsonb", "p_is_takeaway" boolean, "p_takeaway_charge" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_order_by_admin"("p_order_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_order_by_admin"("p_order_id" "uuid", "p_reason" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."cancel_order_by_admin"("p_order_id" "uuid", "p_reason" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."cancel_scheduled_refund_for_order"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."cancel_scheduled_refund_for_order"("p_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."check_available_stock_before_insert"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."check_available_stock_before_insert"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_user_push_token"("p_fcm_token" "text", "p_platform" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_user_push_token"("p_fcm_token" "text", "p_platform" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."claim_user_push_token"("p_fcm_token" "text", "p_platform" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."claim_webhook_event"("p_gateway" "text", "p_event_id" "text", "p_event_type" "text", "p_payload" "jsonb", "p_gateway_version" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."claim_webhook_event"("p_gateway" "text", "p_event_id" "text", "p_event_type" "text", "p_payload" "jsonb", "p_gateway_version" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."close_canteen_cleanup"("p_canteen_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."close_canteen_cleanup"("p_canteen_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_webhook_event"("p_db_id" "uuid", "p_status" "text", "p_error" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_webhook_event"("p_db_id" "uuid", "p_status" "text", "p_error" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."complete_webhook_event"("p_db_id" "uuid", "p_status" "text", "p_error" "text", "p_failure_class" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."complete_webhook_event"("p_db_id" "uuid", "p_status" "text", "p_error" "text", "p_failure_class" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."compute_order_status_from_items"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."compute_order_status_from_items"("p_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."count_recent_ready_orders"("p_canteen_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."count_recent_ready_orders"("p_canteen_id" "uuid") TO "service_role";
GRANT ALL ON FUNCTION "public"."count_recent_ready_orders"("p_canteen_id" "uuid") TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_order_payment_v2"("p_order_id" "uuid", "p_total_amount" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_order_payment_v2"("p_order_id" "uuid", "p_total_amount" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_order_status_notification"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_order_status_notification"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_order_v2"("p_items" "jsonb", "p_is_takeaway" boolean, "p_create_payment" boolean) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_order_v2"("p_items" "jsonb", "p_is_takeaway" boolean, "p_create_payment" boolean) TO "service_role";
GRANT ALL ON FUNCTION "public"."create_order_v2"("p_items" "jsonb", "p_is_takeaway" boolean, "p_create_payment" boolean) TO "authenticated";



REVOKE ALL ON FUNCTION "public"."create_order_v2_app"("p_gateway_code" "text", "p_is_takeaway" boolean, "p_items" "jsonb", "p_placed_by" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_order_v2_app"("p_gateway_code" "text", "p_is_takeaway" boolean, "p_items" "jsonb", "p_placed_by" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_refund_status_notification"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_refund_status_notification"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."create_user_profile_from_auth"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."create_user_profile_from_auth"("p_user_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."create_user_profile_from_auth"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."email_already_registered"("p_email" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."email_already_registered"("p_email" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."email_already_registered"("p_email" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."email_already_registered"("p_email" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."enforce_order_rate_limits"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enforce_order_rate_limits"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."enqueue_canteen_close_job"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."enqueue_canteen_close_job"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."ensure_refund_for_order"("p_order_id" "uuid", "p_reason" "text", "p_amount" numeric) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."ensure_refund_for_order"("p_order_id" "uuid", "p_reason" "text", "p_amount" numeric) TO "authenticated";
GRANT ALL ON FUNCTION "public"."ensure_refund_for_order"("p_order_id" "uuid", "p_reason" "text", "p_amount" numeric) TO "service_role";



REVOKE ALL ON FUNCTION "public"."expire_stale_payments"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."expire_stale_payments"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."generate_daily_order_token_v2"("p_canteen_id" "uuid", "p_canteen_tz" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_daily_order_token_v2"("p_canteen_id" "uuid", "p_canteen_tz" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."generate_unique_barcode_v2"("p_canteen_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."generate_unique_barcode_v2"("p_canteen_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_cds_aggregated_items"("p_canteen_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_cds_aggregated_items"("p_canteen_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_cds_aggregated_items"("p_canteen_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_delivered_revenue_aggregate"("p_canteen_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_order_type" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_delivered_revenue_aggregate"("p_canteen_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_order_type" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_delivered_revenue_aggregate"("p_canteen_id" "uuid", "p_from" timestamp with time zone, "p_to" timestamp with time zone, "p_order_type" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_kitchen_cards"("p_canteen_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_kitchen_cards"("p_canteen_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_kitchen_cards"("p_canteen_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_minimum_supported_app_version"("p_platform" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_minimum_supported_app_version"("p_platform" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."get_minimum_supported_app_version"("p_platform" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_minimum_supported_app_version"("p_platform" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_canteen_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_canteen_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_canteen_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_college_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_college_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_college_id"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_role"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_role"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_role"() TO "service_role";



GRANT ALL ON FUNCTION "public"."get_my_user_id"() TO "anon";
GRANT ALL ON FUNCTION "public"."get_my_user_id"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_my_user_id"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."get_order_barcode_for_reprint"("p_order_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."get_order_barcode_for_reprint"("p_order_id" "uuid") TO "authenticated";
GRANT ALL ON FUNCTION "public"."get_order_barcode_for_reprint"("p_order_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."handle_close_college"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."handle_close_college"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."hungertap_in_close_cleanup"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."hungertap_in_close_cleanup"() TO "anon";
GRANT ALL ON FUNCTION "public"."hungertap_in_close_cleanup"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."hungertap_in_close_cleanup"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."hungertap_project_url"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."hungertap_project_url"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."hungertap_webhook_secret"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."hungertap_webhook_secret"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."insert_order_and_items_v2"("p_order_id" "uuid", "p_canteen_id" "uuid", "p_placed_by" "uuid", "p_placed_by_role" "text", "p_order_token" "text", "p_barcode" "text", "p_is_takeaway" boolean, "p_total_amount" numeric, "p_items" "jsonb", "p_takeaway_charge" numeric, OUT "p_order_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."insert_order_and_items_v2"("p_order_id" "uuid", "p_canteen_id" "uuid", "p_placed_by" "uuid", "p_placed_by_role" "text", "p_order_token" "text", "p_barcode" "text", "p_is_takeaway" boolean, "p_total_amount" numeric, "p_items" "jsonb", "p_takeaway_charge" numeric, OUT "p_order_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."invoke_purge_deleted_users"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."invoke_purge_deleted_users"() TO "service_role";



GRANT ALL ON FUNCTION "public"."kitchen_suggested_quantity"("p_batch_size" integer, "p_remainings" integer[]) TO "anon";
GRANT ALL ON FUNCTION "public"."kitchen_suggested_quantity"("p_batch_size" integer, "p_remainings" integer[]) TO "authenticated";
GRANT ALL ON FUNCTION "public"."kitchen_suggested_quantity"("p_batch_size" integer, "p_remainings" integer[]) TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_my_orders_page"("p_limit" integer, "p_before_created_at" timestamp with time zone, "p_before_id" "uuid", "p_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_my_orders_page"("p_limit" integer, "p_before_created_at" timestamp with time zone, "p_before_id" "uuid", "p_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."list_my_orders_page"("p_limit" integer, "p_before_created_at" timestamp with time zone, "p_before_id" "uuid", "p_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."list_users_due_for_auth_purge"("p_limit" integer) FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."list_users_due_for_auth_purge"("p_limit" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."lookup_canteen_for_signup"("p_query" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."lookup_canteen_for_signup"("p_query" "text") TO "anon";
GRANT ALL ON FUNCTION "public"."lookup_canteen_for_signup"("p_query" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."lookup_canteen_for_signup"("p_query" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_push_on_notification"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_push_on_notification"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_refund_edge"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_refund_edge"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."notify_sync_canteen_cache"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."notify_sync_canteen_cache"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."prevent_notification_update"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."prevent_notification_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."promote_scheduled_refunds"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."promote_scheduled_refunds"() TO "service_role";



GRANT ALL ON FUNCTION "public"."prune_system_error_logs"("p_retention_days" integer) TO "anon";
GRANT ALL ON FUNCTION "public"."prune_system_error_logs"("p_retention_days" integer) TO "authenticated";
GRANT ALL ON FUNCTION "public"."prune_system_error_logs"("p_retention_days" integer) TO "service_role";



REVOKE ALL ON FUNCTION "public"."purge_terminal_payment_rows"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."purge_terminal_payment_rows"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."restore_own_account"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."restore_own_account"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."restore_own_account"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."restore_stock_on_cancel"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."restore_stock_on_cancel"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."restrict_canteen_update"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."restrict_canteen_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."restrict_item_updates"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."restrict_item_updates"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."restrict_order_item_update"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."restrict_order_item_update"() TO "anon";
GRANT ALL ON FUNCTION "public"."restrict_order_item_update"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."restrict_order_item_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."restrict_order_update"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."restrict_order_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."restrict_user_update"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."restrict_user_update"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."revert_order_status_v2"("p_order_id" "uuid", "p_revert_kind" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."revert_order_status_v2"("p_order_id" "uuid", "p_revert_kind" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."revert_order_status_v2"("p_order_id" "uuid", "p_revert_kind" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."run_canteen_close_job"("p_job_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."run_canteen_close_job"("p_job_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_default_payment_gateway"("p_code" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_default_payment_gateway"("p_code" "text") TO "service_role";



GRANT ALL ON FUNCTION "public"."set_delivered_at_on_status"() TO "anon";
GRANT ALL ON FUNCTION "public"."set_delivered_at_on_status"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."set_delivered_at_on_status"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."set_updated_at"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."set_updated_at"() TO "service_role";



GRANT ALL ON FUNCTION "public"."soft_delete_item_instead_of_hard_delete"() TO "anon";
GRANT ALL ON FUNCTION "public"."soft_delete_item_instead_of_hard_delete"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."soft_delete_item_instead_of_hard_delete"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."soft_delete_own_account"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."soft_delete_own_account"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."soft_delete_own_account"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_items_is_available_from_stock"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_items_is_available_from_stock"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_order_items_status_from_order"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_order_items_status_from_order"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."sync_order_status_from_order_items"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."sync_order_status_from_order_items"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_orders_cancel_scheduled_refund_on_uncancel"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_orders_cancel_scheduled_refund_on_uncancel"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."trg_orders_ensure_refund_on_cancel"() FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."trg_orders_ensure_refund_on_cancel"() TO "service_role";



GRANT ALL ON FUNCTION "public"."trg_refunds_hold_window"() TO "anon";
GRANT ALL ON FUNCTION "public"."trg_refunds_hold_window"() TO "authenticated";
GRANT ALL ON FUNCTION "public"."trg_refunds_hold_window"() TO "service_role";



REVOKE ALL ON FUNCTION "public"."update_order_status_flexible"("p_order_id" "uuid", "p_new_status" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."update_order_status_flexible"("p_order_id" "uuid", "p_new_status" "text") TO "authenticated";
GRANT ALL ON FUNCTION "public"."update_order_status_flexible"("p_order_id" "uuid", "p_new_status" "text") TO "service_role";



REVOKE ALL ON FUNCTION "public"."validate_user_canteen_role_v2"("p_user_id" "uuid") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."validate_user_canteen_role_v2"("p_user_id" "uuid") TO "service_role";



REVOKE ALL ON FUNCTION "public"."void_failed_checkout_order"("p_order_id" "uuid", "p_payment_id" "uuid", "p_reason" "text") FROM PUBLIC;
GRANT ALL ON FUNCTION "public"."void_failed_checkout_order"("p_order_id" "uuid", "p_payment_id" "uuid", "p_reason" "text") TO "service_role";

































GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "private"."hungertap_config" TO "service_role";



GRANT ALL ON TABLE "public"."archived_order_items" TO "service_role";
GRANT SELECT ON TABLE "public"."archived_order_items" TO "authenticated";



GRANT SELECT,REFERENCES,TRIGGER,MAINTAIN ON TABLE "public"."archived_orders" TO "anon";
GRANT ALL ON TABLE "public"."archived_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."archived_orders" TO "service_role";



GRANT ALL ON TABLE "public"."archived_payments" TO "service_role";



GRANT ALL ON TABLE "public"."archived_refunds" TO "service_role";



GRANT ALL ON TABLE "public"."canteen_close_jobs" TO "service_role";



GRANT ALL ON TABLE "public"."canteen_daily_token_counters" TO "service_role";



GRANT SELECT,MAINTAIN,UPDATE ON TABLE "public"."canteens" TO "authenticated";
GRANT ALL ON TABLE "public"."canteens" TO "service_role";



GRANT ALL ON TABLE "public"."categories" TO "service_role";
GRANT SELECT ON TABLE "public"."categories" TO "authenticated";



GRANT ALL ON TABLE "public"."colleges" TO "service_role";
GRANT SELECT ON TABLE "public"."colleges" TO "authenticated";



GRANT SELECT,MAINTAIN ON TABLE "public"."failed_order_items" TO "authenticated";
GRANT ALL ON TABLE "public"."failed_order_items" TO "service_role";



GRANT SELECT,MAINTAIN ON TABLE "public"."failed_orders" TO "authenticated";
GRANT ALL ON TABLE "public"."failed_orders" TO "service_role";



GRANT SELECT,INSERT,MAINTAIN,UPDATE ON TABLE "public"."items" TO "authenticated";
GRANT ALL ON TABLE "public"."items" TO "service_role";



GRANT SELECT,MAINTAIN,UPDATE ON TABLE "public"."notifications" TO "authenticated";
GRANT ALL ON TABLE "public"."notifications" TO "service_role";



GRANT ALL ON TABLE "public"."order_items" TO "service_role";
GRANT SELECT,UPDATE ON TABLE "public"."order_items" TO "authenticated";



GRANT ALL ON TABLE "public"."orders" TO "service_role";
GRANT SELECT,UPDATE ON TABLE "public"."orders" TO "authenticated";



GRANT SELECT,MAINTAIN ON TABLE "public"."payment_gateways" TO "authenticated";
GRANT ALL ON TABLE "public"."payment_gateways" TO "service_role";



GRANT ALL ON TABLE "public"."payment_webhook_events" TO "service_role";



GRANT ALL ON TABLE "public"."payments" TO "service_role";



GRANT ALL ON TABLE "public"."refunds" TO "service_role";



GRANT ALL ON TABLE "public"."system_error_logs" TO "service_role";



GRANT ALL ON TABLE "public"."user_tokens" TO "service_role";
GRANT SELECT,INSERT,DELETE,UPDATE ON TABLE "public"."user_tokens" TO "authenticated";



GRANT ALL ON TABLE "public"."users" TO "service_role";
GRANT SELECT,UPDATE ON TABLE "public"."users" TO "authenticated";



GRANT ALL ON TABLE "public"."z_active_open_canteens" TO "anon";
GRANT ALL ON TABLE "public"."z_active_open_canteens" TO "authenticated";
GRANT ALL ON TABLE "public"."z_active_open_canteens" TO "service_role";



GRANT ALL ON TABLE "public"."z_canteen_day_sales" TO "anon";
GRANT ALL ON TABLE "public"."z_canteen_day_sales" TO "authenticated";
GRANT ALL ON TABLE "public"."z_canteen_day_sales" TO "service_role";



GRANT ALL ON TABLE "public"."z_cds_aggregated_items" TO "anon";
GRANT ALL ON TABLE "public"."z_cds_aggregated_items" TO "authenticated";
GRANT ALL ON TABLE "public"."z_cds_aggregated_items" TO "service_role";



GRANT ALL ON TABLE "public"."z_kitchen_queue" TO "anon";
GRANT ALL ON TABLE "public"."z_kitchen_queue" TO "authenticated";
GRANT ALL ON TABLE "public"."z_kitchen_queue" TO "service_role";



GRANT ALL ON TABLE "public"."z_menu_for_canteen" TO "anon";
GRANT ALL ON TABLE "public"."z_menu_for_canteen" TO "authenticated";
GRANT ALL ON TABLE "public"."z_menu_for_canteen" TO "service_role";



GRANT ALL ON TABLE "public"."z_order_payment_summary" TO "anon";
GRANT ALL ON TABLE "public"."z_order_payment_summary" TO "authenticated";
GRANT ALL ON TABLE "public"."z_order_payment_summary" TO "service_role";



GRANT ALL ON TABLE "public"."z_refunds_due" TO "anon";
GRANT ALL ON TABLE "public"."z_refunds_due" TO "authenticated";
GRANT ALL ON TABLE "public"."z_refunds_due" TO "service_role";



GRANT ALL ON TABLE "public"."z_student_order_feed" TO "anon";
GRANT ALL ON TABLE "public"."z_student_order_feed" TO "authenticated";
GRANT ALL ON TABLE "public"."z_student_order_feed" TO "service_role";



GRANT ALL ON TABLE "public"."z_user_inbox" TO "anon";
GRANT ALL ON TABLE "public"."z_user_inbox" TO "authenticated";
GRANT ALL ON TABLE "public"."z_user_inbox" TO "service_role";









ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON SEQUENCES TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON FUNCTIONS TO "service_role";






ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "postgres";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "anon";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "authenticated";
ALTER DEFAULT PRIVILEGES FOR ROLE "postgres" IN SCHEMA "public" GRANT ALL ON TABLES TO "service_role";































