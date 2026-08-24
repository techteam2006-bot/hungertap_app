-- 5. close_canteen_cleanup: all refund INSERTs include gateway_name
CREATE OR REPLACE FUNCTION public.close_canteen_cleanup(p_canteen_id uuid) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $body$
DECLARE
  v_now timestamptz := timezone('UTC', now());
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
      INSERT INTO public.archieved_orders (
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

      INSERT INTO public.archieved_order_items (
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

    INSERT INTO public.archieved_payments (
      id, order_id, amount, status, gateway_name, gateway_payment_id,
      gateway_response, created_at, updated_at, archived_at
    )
    SELECT
      p.id, p.order_id, p.amount, p.status, p.gateway_name, p.gateway_payment_id,
      p.gateway_response, p.created_at, p.updated_at, v_now
    FROM public.payments p
    WHERE p.order_id = v_order.id
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      gateway_response = EXCLUDED.gateway_response,
      updated_at = EXCLUDED.updated_at,
      archived_at = EXCLUDED.archived_at;

    INSERT INTO public.archieved_refunds (
      id, payment_id, order_id, amount, status, gateway_refund_id,
      gateway_response, reason, customer_email, retry_count, created_at,
      refunded_at, archived_at
    )
    SELECT
      r.id, r.payment_id, r.order_id, r.amount, r.status, r.gateway_refund_id,
      r.gateway_response, r.reason, r.customer_email, r.retry_count, r.created_at,
      r.refunded_at, v_now
    FROM public.refunds r
    WHERE r.order_id = v_order.id
    ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      gateway_response = EXCLUDED.gateway_response,
      customer_email = COALESCE(EXCLUDED.customer_email, public.archieved_refunds.customer_email),
      archived_at = EXCLUDED.archived_at;

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
$body$;
