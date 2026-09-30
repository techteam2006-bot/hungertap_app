-- Student-app offers. Discount snapshot lives on offer_redemptions, not on orders.
-- Old checkouts that omit p_offer_code keep today's totals (food + takeaway).
-- 5% (and any percent/flat offer) can exclude beverages and takeaway.

CREATE TABLE IF NOT EXISTS public.offers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  canteen_id uuid NOT NULL REFERENCES public.canteens(id),
  code text NOT NULL,
  title text NOT NULL,
  description text,
  kind text NOT NULL,
  value numeric(10,2) NOT NULL,
  min_order_amount numeric(12,2) NOT NULL DEFAULT 0,
  max_discount numeric(12,2),
  exclude_beverages boolean NOT NULL DEFAULT true,
  exclude_takeaway boolean NOT NULL DEFAULT true,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  is_public boolean NOT NULL DEFAULT true,
  campaign text,
  per_user_limit integer,
  global_limit integer,
  stackable boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT offers_kind_check CHECK (kind IN ('percent', 'flat')),
  CONSTRAINT offers_value_check CHECK (value > 0),
  CONSTRAINT offers_window_check CHECK (ends_at > starts_at)
);

CREATE UNIQUE INDEX IF NOT EXISTS offers_canteen_code_uidx
  ON public.offers (canteen_id, upper(code));

CREATE INDEX IF NOT EXISTS offers_active_window_idx
  ON public.offers (canteen_id, is_active, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS public.offer_redemptions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  offer_id uuid NOT NULL REFERENCES public.offers(id),
  user_id uuid NOT NULL,
  order_id uuid NOT NULL REFERENCES public.orders(id),
  status text NOT NULL,
  discount_amount numeric(12,2) NOT NULL,
  subtotal_amount numeric(12,2) NOT NULL,
  discountable_subtotal numeric(12,2) NOT NULL,
  takeaway_amount numeric(12,2) NOT NULL DEFAULT 0,
  amount_before_discount numeric(12,2) NOT NULL,
  amount_after_discount numeric(12,2) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  redeemed_at timestamptz,
  released_at timestamptz,
  CONSTRAINT offer_redemptions_status_check CHECK (status IN ('reserved', 'redeemed', 'released')),
  CONSTRAINT offer_redemptions_order_uidx UNIQUE (order_id)
);

CREATE INDEX IF NOT EXISTS offer_redemptions_redeemed_user_idx
  ON public.offer_redemptions (offer_id, user_id)
  WHERE status = 'redeemed';

CREATE UNIQUE INDEX IF NOT EXISTS offer_redemptions_reserved_user_uidx
  ON public.offer_redemptions (offer_id, user_id)
  WHERE status = 'reserved';

ALTER TABLE public.offers ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.offer_redemptions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS offers_select_own_canteen ON public.offers;
CREATE POLICY offers_select_own_canteen ON public.offers
  FOR SELECT TO authenticated
  USING (
    canteen_id = public.get_my_canteen_id()
    AND is_active
    AND is_public
    AND now() >= starts_at
    AND now() < ends_at
  );

DROP POLICY IF EXISTS offer_redemptions_select_own ON public.offer_redemptions;
CREATE POLICY offer_redemptions_select_own ON public.offer_redemptions
  FOR SELECT TO authenticated
  USING (user_id = auth.uid());

REVOKE ALL ON public.offers FROM PUBLIC, anon;
REVOKE ALL ON public.offer_redemptions FROM PUBLIC, anon;
GRANT SELECT ON public.offers TO authenticated;
GRANT SELECT ON public.offer_redemptions TO authenticated;

-- ---------------------------------------------------------------------------
-- Shared math. Beverage category matches calculate_cart_totals_v2.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.compute_cart_offer_breakdown(
  p_canteen_id uuid,
  p_items jsonb,
  p_is_takeaway boolean,
  p_takeaway_charge numeric,
  p_offer_code text,
  p_user_id uuid,
  p_check_limits boolean DEFAULT true
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  c_beverage constant uuid := '728f2bff-1065-400e-9885-bcc9a8d1e491';
  c_max_quantity_per_line constant int := 15;
  v_offer public.offers%ROWTYPE;
  v_code text := upper(trim(coalesce(p_offer_code, '')));
  v_subtotal numeric(12,2);
  v_discountable numeric(12,2);
  v_takeaway numeric(12,2);
  v_discount numeric(12,2);
  v_before numeric(12,2);
  v_after numeric(12,2);
  v_redeemed int;
  v_reserved int;
BEGIN
  IF v_code = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'offer_invalid');
  END IF;

  SELECT * INTO v_offer
  FROM public.offers
  WHERE canteen_id = p_canteen_id
    AND upper(code) = v_code
  ORDER BY is_active DESC, starts_at DESC
  LIMIT 1;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'offer_invalid');
  END IF;

  IF NOT v_offer.is_active OR now() < v_offer.starts_at OR now() >= v_offer.ends_at THEN
    RETURN jsonb_build_object('ok', false, 'error', 'offer_expired');
  END IF;

  WITH input_items AS (
    SELECT
      coalesce((item->>'item_id')::uuid, (item->>'itemId')::uuid) AS item_id,
      SUM(GREATEST(1, (item->>'quantity')::int))::int AS quantity
    FROM jsonb_array_elements(p_items) AS item
    GROUP BY 1
  ),
  valid_items AS (
    SELECT ii.quantity, i.price, i.category_id
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
    round(coalesce(sum(vi.quantity * vi.price), 0)::numeric, 2),
    round(coalesce(sum(
      CASE
        WHEN NOT v_offer.exclude_beverages OR vi.category_id IS DISTINCT FROM c_beverage
        THEN vi.quantity * vi.price
        ELSE 0
      END
    ), 0)::numeric, 2),
    round((
      CASE WHEN coalesce(p_is_takeaway, false) THEN
        coalesce(sum(
          CASE
            WHEN vi.category_id IS DISTINCT FROM c_beverage
            THEN vi.quantity * coalesce(p_takeaway_charge, 10.00)
            ELSE 0
          END
        ), 0)
      ELSE 0 END
    )::numeric, 2)
  INTO v_subtotal, v_discountable, v_takeaway
  FROM valid_items vi;

  IF NOT v_offer.exclude_takeaway THEN
    v_discountable := round(v_discountable + v_takeaway, 2);
  END IF;

  IF coalesce(v_offer.min_order_amount, 0) > v_discountable THEN
    RETURN jsonb_build_object('ok', false, 'error', 'offer_min_order');
  END IF;

  IF v_offer.kind = 'percent' THEN
    v_discount := round(v_discountable * v_offer.value / 100.0, 2);
  ELSE
    v_discount := least(v_offer.value, v_discountable);
  END IF;

  IF v_offer.max_discount IS NOT NULL THEN
    v_discount := least(v_discount, v_offer.max_discount);
  END IF;
  v_discount := greatest(coalesce(v_discount, 0), 0);

  v_before := round(v_subtotal + v_takeaway, 2);
  v_after := round(v_subtotal - v_discount + v_takeaway, 2);

  IF v_after < 1 OR v_after > 2000 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'offer_makes_total_invalid');
  END IF;

  IF p_check_limits AND p_user_id IS NOT NULL THEN
    IF v_offer.per_user_limit IS NOT NULL THEN
      SELECT count(*)::int INTO v_redeemed
      FROM public.offer_redemptions
      WHERE offer_id = v_offer.id
        AND user_id = p_user_id
        AND status = 'redeemed';
      IF v_redeemed >= v_offer.per_user_limit THEN
        RETURN jsonb_build_object('ok', false, 'error', 'offer_already_used');
      END IF;
    END IF;

    IF v_offer.global_limit IS NOT NULL THEN
      SELECT count(*)::int INTO v_redeemed
      FROM public.offer_redemptions
      WHERE offer_id = v_offer.id
        AND status = 'redeemed';
      IF v_redeemed >= v_offer.global_limit THEN
        RETURN jsonb_build_object('ok', false, 'error', 'offer_limit_reached');
      END IF;
    END IF;

    SELECT count(*)::int INTO v_reserved
    FROM public.offer_redemptions r
    JOIN public.orders o ON o.id = r.order_id
    WHERE r.offer_id = v_offer.id
      AND r.user_id = p_user_id
      AND r.status = 'reserved'
      AND o.status = 'pending_payment';
    IF v_reserved > 0 THEN
      RETURN jsonb_build_object('ok', false, 'error', 'offer_in_flight');
    END IF;
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'offer_id', v_offer.id,
    'code', v_offer.code,
    'title', v_offer.title,
    'description', v_offer.description,
    'kind', v_offer.kind,
    'value', v_offer.value,
    'min_order_amount', v_offer.min_order_amount,
    'campaign', v_offer.campaign,
    'exclude_beverages', v_offer.exclude_beverages,
    'exclude_takeaway', v_offer.exclude_takeaway,
    'subtotal_amount', v_subtotal,
    'discountable_subtotal', v_discountable,
    'takeaway_amount', v_takeaway,
    'discount_amount', v_discount,
    'amount_before_discount', v_before,
    'amount_after_discount', v_after,
    'total_amount', v_after
  );
END;
$$;

REVOKE ALL ON FUNCTION public.compute_cart_offer_breakdown(uuid, jsonb, boolean, numeric, text, uuid, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.compute_cart_offer_breakdown(uuid, jsonb, boolean, numeric, text, uuid, boolean) TO service_role;

CREATE OR REPLACE FUNCTION public.list_active_offers_for_user()
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_canteen uuid;
  v_user uuid := auth.uid();
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  v_canteen := public.get_my_canteen_id();
  IF v_canteen IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'offers', '[]'::jsonb);
  END IF;

  RETURN jsonb_build_object(
    'ok', true,
    'offers', coalesce((
      SELECT jsonb_agg(row_to_json(x) ORDER BY x.sort_key, x.title)
      FROM (
        SELECT
          o.id,
          o.code,
          o.title,
          o.description,
          o.kind,
          o.value,
          o.min_order_amount,
          o.max_discount,
          o.campaign,
          o.exclude_beverages,
          o.exclude_takeaway,
          CASE WHEN o.campaign = 'inauguration' THEN 0 ELSE 1 END AS sort_key
        FROM public.offers o
        WHERE o.canteen_id = v_canteen
          AND o.is_active
          AND o.is_public
          AND now() >= o.starts_at
          AND now() < o.ends_at
          AND (
            o.per_user_limit IS NULL
            OR (
              SELECT count(*) FROM public.offer_redemptions r
              WHERE r.offer_id = o.id AND r.user_id = v_user AND r.status = 'redeemed'
            ) < o.per_user_limit
          )
      ) x
    ), '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.list_active_offers_for_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.list_active_offers_for_user() TO authenticated, service_role;

CREATE OR REPLACE FUNCTION public.preview_offer_discount(
  p_offer_code text,
  p_items jsonb,
  p_is_takeaway boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
DECLARE
  v_user uuid := auth.uid();
  v_canteen uuid;
  v_role text;
  v_takeaway numeric(10,2);
BEGIN
  IF v_user IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT canteen_id, role INTO v_canteen, v_role
  FROM public.validate_user_canteen_role_v2(v_user);

  SELECT coalesce(takeaway_charge, 10.00) INTO v_takeaway
  FROM public.canteens WHERE id = v_canteen;

  RETURN public.compute_cart_offer_breakdown(
    v_canteen,
    p_items,
    p_is_takeaway,
    v_takeaway,
    p_offer_code,
    v_user,
    true
  );
END;
$$;

REVOKE ALL ON FUNCTION public.preview_offer_discount(text, jsonb, boolean) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.preview_offer_discount(text, jsonb, boolean) TO authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Order status drives reserved → redeemed / released. No extra orders columns.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.sync_offer_redemption_on_order_status()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'pg_temp'
AS $$
BEGIN
  IF OLD.status = 'pending_payment'
     AND NEW.status IN ('preparing', 'partially_ready', 'ready') THEN
    UPDATE public.offer_redemptions
    SET status = 'redeemed', redeemed_at = now()
    WHERE order_id = NEW.id AND status = 'reserved';
  ELSIF OLD.status = 'payment_failed'
     AND NEW.status IN ('preparing', 'partially_ready', 'ready') THEN
    UPDATE public.offer_redemptions r
    SET status = 'redeemed', redeemed_at = coalesce(r.redeemed_at, now()), released_at = NULL
    WHERE r.order_id = NEW.id AND r.status IN ('reserved', 'released');
  ELSIF OLD.status = 'pending_payment' AND NEW.status = 'payment_failed' THEN
    UPDATE public.offer_redemptions
    SET status = 'released', released_at = now()
    WHERE order_id = NEW.id AND status = 'reserved';
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_offer_redemption ON public.orders;
CREATE TRIGGER trg_sync_offer_redemption
  AFTER UPDATE OF status ON public.orders
  FOR EACH ROW
  WHEN (OLD.status IS DISTINCT FROM NEW.status)
  EXECUTE FUNCTION public.sync_offer_redemption_on_order_status();

-- ---------------------------------------------------------------------------
-- create_order_v2_app: optional p_offer_code. Null path is unchanged.
-- ---------------------------------------------------------------------------
DROP FUNCTION IF EXISTS public.create_order_v2_app(text, boolean, jsonb, uuid);

CREATE OR REPLACE FUNCTION public.create_order_v2_app(
  p_gateway_code text DEFAULT 'cashfree',
  p_is_takeaway boolean DEFAULT false,
  p_items jsonb DEFAULT '[]'::jsonb,
  p_placed_by uuid DEFAULT NULL,
  p_offer_code text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
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
  v_gateway_code        TEXT := lower(trim(COALESCE(p_gateway_code, 'cashfree')));
  v_offer               jsonb;
  v_offer_code          TEXT := NULLIF(upper(trim(coalesce(p_offer_code, ''))), '');
BEGIN
  IF auth.uid() IS NOT NULL AND p_placed_by IS NOT NULL AND p_placed_by <> auth.uid() THEN
    RETURN jsonb_build_object('success', false, 'error', 'Invalid placed_by user');
  END IF;

  v_placed_by := COALESCE(p_placed_by, auth.uid());
  IF v_placed_by IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'User ID is required');
  END IF;

  IF EXISTS (SELECT 1 FROM information_schema.tables WHERE table_schema = 'public' AND table_name = 'payment_gateways') THEN
    IF NOT EXISTS (SELECT 1 FROM public.payment_gateways WHERE code = v_gateway_code AND enabled = true) THEN
      RETURN jsonb_build_object('success', false, 'error', 'Selected payment gateway is unavailable');
    END IF;
  END IF;

  v_order_id := gen_random_uuid();

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

  SELECT valid_count, total_quantity, total_amount
  INTO v_valid_count, v_total_quantity, v_total_amount
  FROM public.calculate_cart_totals_v2(v_canteen_id, p_items, p_is_takeaway, v_takeaway_charge);

  IF v_offer_code IS NOT NULL THEN
    PERFORM pg_advisory_xact_lock(hashtext(v_offer_code || ':' || v_placed_by::text));
    v_offer := public.compute_cart_offer_breakdown(
      v_canteen_id, p_items, p_is_takeaway, v_takeaway_charge, v_offer_code, v_placed_by, true
    );
    IF coalesce(v_offer->>'ok', 'false') <> 'true' THEN
      RETURN jsonb_build_object('success', false, 'error', coalesce(v_offer->>'error', 'offer_invalid'));
    END IF;
    v_total_amount := (v_offer->>'amount_after_discount')::numeric;
  END IF;

  v_order_token := public.generate_daily_order_token_v2(v_canteen_id);
  v_barcode := public.generate_unique_barcode_v2(v_canteen_id);

  v_order_status := public.insert_order_and_items_v2(
    v_order_id, v_canteen_id, v_placed_by, v_placed_by_role,
    v_order_token, v_barcode, p_is_takeaway, v_total_amount, p_items, v_takeaway_charge
  );

  IF v_order_status = 'pending_payment' THEN
    INSERT INTO public.payments (order_id, gateway_name, amount, status, created_at)
    VALUES (v_order_id, v_gateway_code, v_total_amount, 'initiated', NOW())
    RETURNING id INTO v_payment_id;

    IF v_offer_code IS NOT NULL THEN
      INSERT INTO public.offer_redemptions (
        offer_id, user_id, order_id, status,
        discount_amount, subtotal_amount, discountable_subtotal, takeaway_amount,
        amount_before_discount, amount_after_discount
      ) VALUES (
        (v_offer->>'offer_id')::uuid,
        v_placed_by,
        v_order_id,
        'reserved',
        (v_offer->>'discount_amount')::numeric,
        (v_offer->>'subtotal_amount')::numeric,
        (v_offer->>'discountable_subtotal')::numeric,
        (v_offer->>'takeaway_amount')::numeric,
        (v_offer->>'amount_before_discount')::numeric,
        (v_offer->>'amount_after_discount')::numeric
      );
    END IF;
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
    'gateway_code', v_gateway_code,
    'offer_code', v_offer->>'code',
    'discount_amount', CASE WHEN v_offer IS NULL THEN 0 ELSE (v_offer->>'discount_amount')::numeric END,
    'subtotal_amount', v_offer->>'subtotal_amount',
    'takeaway_amount', v_offer->>'takeaway_amount',
    'amount_after_discount', v_total_amount
  );
END;
$$;

ALTER FUNCTION public.create_order_v2_app(text, boolean, jsonb, uuid, text) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.create_order_v2_app(text, boolean, jsonb, uuid, text) FROM PUBLIC;
GRANT ALL ON FUNCTION public.create_order_v2_app(text, boolean, jsonb, uuid, text) TO service_role;
GRANT ALL ON FUNCTION public.create_order_v2_app(text, boolean, jsonb, uuid, text) TO authenticated;

-- 5% off non-beverage food. Takeaway is never discounted. One row per canteen.
INSERT INTO public.offers (
  canteen_id, code, title, description,
  kind, value, min_order_amount, max_discount,
  exclude_beverages, exclude_takeaway,
  starts_at, ends_at, is_active, is_public,
  campaign, per_user_limit, stackable
)
SELECT
  c.id,
  'SAVE5',
  '5% off food',
  '5% off food items. Beverages and takeaway charges are not discounted.',
  'percent',
  5,
  0,
  NULL,
  true,
  true,
  now(),
  now() + interval '365 days',
  true,
  true,
  NULL,
  NULL,
  false
FROM public.canteens c
WHERE NOT EXISTS (
  SELECT 1 FROM public.offers o
  WHERE o.canteen_id = c.id AND upper(o.code) = 'SAVE5'
);

NOTIFY pgrst, 'reload schema';
