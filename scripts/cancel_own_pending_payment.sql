-- Student-safe cancel of own pending_payment checkout (run in Supabase SQL editor).
-- Used when the user backs out of the Easebuzz gateway.

CREATE OR REPLACE FUNCTION public.cancel_own_pending_payment(p_order_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  v_uid uuid := auth.uid();
  v_row public.orders%ROWTYPE;
BEGIN
  IF v_uid IS NULL THEN
    RAISE EXCEPTION 'Not authenticated';
  END IF;

  IF p_order_id IS NULL THEN
    RAISE EXCEPTION 'Missing order id';
  END IF;

  SELECT * INTO v_row
  FROM public.orders
  WHERE id = p_order_id
    AND placed_by = v_uid
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Order not found';
  END IF;

  IF v_row.status IS DISTINCT FROM 'pending_payment' THEN
    RETURN jsonb_build_object(
      'ok', true,
      'already_final', true,
      'status', v_row.status
    );
  END IF;

  UPDATE public.orders
  SET status = 'payment_cancelled',
      updated_at = now()
  WHERE id = p_order_id
    AND placed_by = v_uid
    AND status = 'pending_payment';

  RETURN jsonb_build_object('ok', true, 'status', 'payment_cancelled');
END;
$function$;

REVOKE ALL ON FUNCTION public.cancel_own_pending_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.cancel_own_pending_payment(uuid) TO authenticated;
