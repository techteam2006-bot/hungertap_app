-- 4. cancel_order_by_admin: include gateway_name on refund INSERT/UPDATE
CREATE OR REPLACE FUNCTION public.cancel_order_by_admin(
  p_order_id uuid,
  p_reason text DEFAULT 'Vendor cancelled order'::text
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $body$
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
     AND current_user NOT IN ('postgres', 'supabase_admin')
  THEN
    IF auth.uid() IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_authenticated');
    END IF;

    SELECT role, canteen_id INTO v_user_role, v_my_canteen
    FROM public.users
    WHERE id = auth.uid();

    IF v_user_role IS DISTINCT FROM 'canteen_admin' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'not_canteen_admin');
    END IF;
  ELSE
    v_my_canteen := NULL;
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

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
    COALESCE(SUM(line_total) FILTER (
      WHERE status NOT IN ('delivered', 'cancelled_by_vendor', 'payment_failed', 'pickup_failed')
    ), 0)
  INTO v_delivered_count, v_cancellable_count, v_refund_amount
  FROM public.order_items
  WHERE order_id = p_order_id;

  IF v_cancellable_count = 0 AND v_delivered_count > 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'only_delivered_lines_remain');
  END IF;

  UPDATE public.order_items
  SET status = 'cancelled_by_vendor',
      updated_at = v_now
  WHERE order_id = p_order_id
    AND status NOT IN ('delivered', 'cancelled_by_vendor', 'payment_failed', 'pickup_failed');

  IF v_delivered_count > 0 THEN
    UPDATE public.orders
    SET status = 'delivered',
        updated_at = v_now
    WHERE id = p_order_id;
  ELSE
    UPDATE public.orders
    SET status = 'cancelled_by_vendor',
        updated_at = v_now
    WHERE id = p_order_id;
  END IF;

  SELECT * INTO v_payment
  FROM public.payments
  WHERE order_id = p_order_id
    AND status IN ('success', 'refund_pending', 'refund_failed')
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND OR v_refund_amount <= 0 THEN
    RETURN jsonb_build_object(
      'ok', true,
      'action', 'cancelled',
      'refund_required', false,
      'order_id', p_order_id
    );
  END IF;

  IF v_payment.gateway_payment_id IS NULL OR length(trim(v_payment.gateway_payment_id)) = 0 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'payment_missing_gateway_id',
      'payment_id', v_payment.id
    );
  END IF;

  v_gateway := lower(trim(v_payment.gateway_name));

  SELECT au.email INTO v_email
  FROM auth.users au
  WHERE au.id = v_order.placed_by;

  UPDATE public.payments
  SET status = 'refund_pending',
      updated_at = v_now
  WHERE id = v_payment.id
    AND status IS DISTINCT FROM 'refunded';

  SELECT r.id INTO v_refund_id
  FROM public.refunds r
  WHERE r.payment_id = v_payment.id
  LIMIT 1;

  IF v_refund_id IS NULL THEN
    INSERT INTO public.refunds (
      order_id, payment_id, amount, status, reason, retry_count, customer_email, gateway_name
    ) VALUES (
      p_order_id, v_payment.id, v_refund_amount, 'initiated',
      COALESCE(p_reason, 'Vendor cancelled order'), 0, v_email, v_gateway
    )
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
    'ok', true,
    'action', 'cancelled',
    'refund_required', true,
    'refund_id', v_refund_id,
    'payment_id', v_payment.id,
    'order_id', p_order_id,
    'amount', v_refund_amount,
    'txnid', v_payment.gateway_payment_id,
    'email', v_email
  );
END;
$body$;

