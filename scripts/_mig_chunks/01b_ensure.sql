-- 3. ensure_refund_for_order: stamp gateway_name on INSERT/UPDATE
CREATE OR REPLACE FUNCTION public.ensure_refund_for_order(
  p_order_id uuid,
  p_reason text DEFAULT 'Vendor cancelled order'::text,
  p_amount numeric DEFAULT NULL::numeric
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
  v_now timestamptz := NOW();
  v_gateway text;
BEGIN
  IF p_order_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_id_required');
  END IF;

  SELECT * INTO v_order
  FROM public.orders
  WHERE id = p_order_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'order_not_found');
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
    SELECT COALESCE(SUM(line_total), 0)
    INTO v_refund_amount
    FROM public.order_items
    WHERE order_id = p_order_id
      AND status = 'cancelled_by_vendor';

    IF v_refund_amount <= 0 THEN
      v_refund_amount := COALESCE(v_payment.amount, v_order.total_amount, 0);
    END IF;
  END IF;

  IF v_refund_amount <= 0 THEN
    RETURN jsonb_build_object('ok', true, 'refund_required', false, 'reason', 'zero_amount');
  END IF;

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
      COALESCE(NULLIF(trim(p_reason), ''), 'Vendor cancelled order'), 0, v_email,
      v_gateway
    )
    RETURNING id INTO v_refund_id;
  ELSE
    UPDATE public.refunds
    SET customer_email = COALESCE(customer_email, v_email),
        amount = COALESCE(NULLIF(amount, 0), v_refund_amount),
        reason = COALESCE(reason, p_reason),
        gateway_name = COALESCE(gateway_name, v_gateway)
    WHERE id = v_refund_id
      AND status IS DISTINCT FROM 'success';
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'refund_required', true,
    'refund_id', v_refund_id,
    'payment_id', v_payment.id,
    'order_id', p_order_id,
    'amount', v_refund_amount
  );
END;
$body$;

