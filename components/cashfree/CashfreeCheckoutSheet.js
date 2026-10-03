/**
 * HungerTap × Cashfree payment UI (React Native) — v2, single-screen checkout.
 *
 *
 * Screens:  checkout (UPI | Card | Bank | Wallet tabs) → processing → failed
 * Success is NOT drawn here: onVerify in PaymentProcessingScreen shows
 * "Verifying your payment…" and then the existing OrderConfirmation screen.
 *
 * What Cashfree does vs. what we draw:
 *   UPI apps / UPI ID / Card / Net banking → our UI, paid with Cashfree Element SDK calls
 *   Wallets → Cashfree's own wallet page (the RN SDK has no direct wallet call)
 *
 * Colours / radii / fonts / bank list: lib/cashfreeUiTheme.js
 */
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ScrollView,
  StyleSheet,
  ActivityIndicator,
  Animated,
  Easing,
  BackHandler,
  KeyboardAvoidingView,
  Platform,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import AppIcon from '../AppIcon';
import {
  cfColors as C,
  cfRadius as R,
  cfFonts as F,
  UPI_APP_LOOKS,
  NETBANKING_BANKS,
  WALLETS,
} from '../../lib/cashfreeUiTheme';
import { resolveItemUnitPrice } from '../../lib/itemPrice';
import {
  getCashfreeUpiApps,
  startCashfreeUpiIntent,
  startCashfreeUpiCollect,
  startCashfreeNetBanking,
  startCashfreeCheckout,
  getCashfreeCardElement,
} from '../../lib/cashfreeCheckout';

const UPI_ID_RE = /^[\w.\-]{2,}@[a-zA-Z]{2,}$/;
const QUICK_BANKS = NETBANKING_BANKS.filter((b) => b.quick);
const OTHER_BANKS = NETBANKING_BANKS.filter((b) => !b.quick);

function formatInr(n) {
  return `₹${(Number(n) || 0).toFixed(2)}`;
}

/* ------------------------------------------------------------------ */
/*  Small building blocks                                              */
/* ------------------------------------------------------------------ */

function CashfreeBadge() {
  return (
    <View style={s.cfBadge}>
      <View style={s.cfMark}><View style={s.cfMarkInner} /></View>
      <Text style={s.cfBadgeText}>cashfree</Text>
    </View>
  );
}

function Tile({ label, short, color, textColor, onPress }) {
  return (
    <TouchableOpacity style={s.tile} onPress={onPress} activeOpacity={0.8}>
      <View style={[s.tileIcon, { backgroundColor: color || C.ink700 }]}>
        <Text style={[s.tileIconText, textColor && { color: textColor }]} numberOfLines={1}>{short}</Text>
      </View>
      <Text style={s.tileLabel} numberOfLines={1}>{label}</Text>
    </TouchableOpacity>
  );
}

function Field({ label, error, children }) {
  return (
    <View style={s.field}>
      {label ? <Text style={s.label}>{label}</Text> : null}
      {children}
      {error ? <Text style={s.hintError}>{error}</Text> : null}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Main component                                                     */
/* ------------------------------------------------------------------ */

/**
 * @param {{
 *   paymentSessionId: string,
 *   orderId: string,
 *   environment: string,
 *   orderItems?: any[],
 *   orderTotal?: number,
 *   isTakeaway?: boolean,
 *   attempt?: { key: number, status: 'failed', message?: string } | null,
 *   onPaymentLaunched?: () => void,
 *   onCancelOrder: () => void,
 *   onBackToCart: () => void,
 * }} props
 */
export default function CashfreeCheckoutSheet({
  paymentSessionId,
  orderId,
  environment,
  orderItems = [],
  orderTotal = 0,
  isTakeaway = false,
  takeawayCharge = 0,
  discountAmount = 0,
  offerCode = '',
  attempt = null,
  onPaymentLaunched,
  onCancelOrder,
  onBackToCart,
}) {
  const insets = useSafeAreaInsets();
  const [screen, setScreen] = useState('checkout'); // checkout | processing | failed
  const [failMessage, setFailMessage] = useState('');
  const [notice, setNotice] = useState('');

  const session = useMemo(
    () => ({ paymentSessionId, orderId, environment }),
    [paymentSessionId, orderId, environment]
  );

  /* failure pushed from PaymentProcessingScreen */
  useEffect(() => {
    if (attempt?.status === 'failed') {
      setFailMessage(attempt.message || '');
      setScreen('failed');
    }
  }, [attempt?.key]); // eslint-disable-line react-hooks/exhaustive-deps

  const launch = useCallback(
    (fn) => {
      setNotice('');
      try {
        fn();
        setScreen('processing');
        onPaymentLaunched?.();
      } catch (e) {
        setNotice(`Could not start payment (${e?.message || 'unknown error'}). Please try another method.`);
      }
    },
    [onPaymentLaunched]
  );

  /* Android back: blocked while paying; failed → cart; checkout → parent cancels order */
  useEffect(() => {
    const sub = BackHandler.addEventListener('hardwareBackPress', () => {
      if (screen === 'processing') return true;
      if (screen === 'failed') {
        onBackToCart?.();
        return true;
      }
      return false;
    });
    return () => sub.remove();
  }, [screen, onBackToCart]);

  const bottomPad = Math.max(insets.bottom, 12);

  return (
    <View style={[s.root, { paddingTop: insets.top }]}>
      {screen === 'checkout' && (
        <CheckoutScreen
          session={session}
          orderItems={orderItems}
          orderTotal={orderTotal}
          isTakeaway={isTakeaway}
          takeawayCharge={takeawayCharge}
          discountAmount={discountAmount}
          offerCode={offerCode}
          notice={notice}
          bottomPad={bottomPad}
          onBack={onCancelOrder}
          launch={launch}
        />
      )}
      {screen === 'processing' && <ProcessingScreen bottomPad={bottomPad} />}
      {screen === 'failed' && (
        <FailedScreen message={failMessage} bottomPad={bottomPad} onTryAgain={onBackToCart} />
      )}
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Screen 1: Checkout — all methods on one screen                     */
/* ------------------------------------------------------------------ */

const METHODS = [
  { key: 'upi', label: 'UPI', icon: 'U' },
  { key: 'card', label: 'Card', icon: '💳' },
  { key: 'netbanking', label: 'Bank', icon: '🏦' },
  { key: 'wallet', label: 'Wallet', icon: 'W' },
];

function CheckoutScreen({ session, orderItems, orderTotal, isTakeaway, takeawayCharge, discountAmount, offerCode, notice, bottomPad, onBack, launch }) {
  const amountLabel = formatInr(orderTotal);
  const lines = Array.isArray(orderItems) ? orderItems : [];
  const itemCount = lines.reduce((n, it) => n + Math.max(1, Number(it?.quantity) || 1), 0);

  const [open, setOpen] = useState(false);
  const [method, setMethod] = useState('upi');

  // UPI
  const [apps, setApps] = useState(null); // null = loading
  const [vpa, setVpa] = useState('');
  const [vpaError, setVpaError] = useState('');
  // Card
  const card = useMemo(() => getCashfreeCardElement(), []);
  const cardRef = useRef(null);
  const [cardInfo, setCardInfo] = useState({ network: '', luhnOk: false, length: 0 });
  const [expiry, setExpiry] = useState('');
  const [cvv, setCvv] = useState('');
  const [name, setName] = useState('');
  const [cardErrors, setCardErrors] = useState({});
  // Bank
  const [bank, setBank] = useState(null);
  const [bankListOpen, setBankListOpen] = useState(false);

  const [focus, setFocus] = useState('');

  useEffect(() => {
    let alive = true;
    getCashfreeUpiApps().then((list) => { if (alive) setApps(list); });
    return () => { alive = false; };
  }, []);

  const cfCardSession = useMemo(() => {
    try { return card ? card.buildCardSession(session) : null; } catch (_) { return null; }
  }, [card, session]);

  const onCardListener = useCallback((json) => {
    try {
      const r = JSON.parse(json);
      setCardInfo({
        network: String(r?.card_network || '').toUpperCase(),
        luhnOk: r?.luhn_check_info === 'SUCCESS',
        length: Number(r?.card_length) || 0,
      });
    } catch (_) { /* ignore */ }
  }, []);

  /* ---------- pay actions ---------- */
  const payUpiApp = (appId) => launch(() => startCashfreeUpiIntent({ ...session, appId }));
  const payBank = (code) => launch(() => startCashfreeNetBanking({ ...session, bankCode: code }));
  const payWallet = () => launch(() => startCashfreeCheckout({ ...session, modes: ['WALLET'] }));

  const payUpiId = () => {
    const v = vpa.trim();
    if (!UPI_ID_RE.test(v)) {
      setVpaError(v ? 'Enter a valid UPI ID, e.g. name@okaxis' : 'Tap a UPI app above or enter your UPI ID');
      return;
    }
    setVpaError('');
    launch(() => startCashfreeUpiCollect({ ...session, vpa: v }));
  };

  const payCard = () => {
    const [mm, yy] = expiry.split('/');
    const mmN = Number(mm);
    const next = {
      number: !(cardInfo.luhnOk && cardInfo.length >= 12) ? 'Enter a valid card number' : '',
      expiry: !(/^\d{2}\/\d{2}$/.test(expiry) && mmN >= 1 && mmN <= 12) ? 'Enter expiry as MM/YY' : '',
      cvv: cvv.length < 3 ? 'Enter CVV' : '',
      name: name.trim().length < 2 ? 'Enter the name on the card' : '',
    };
    setCardErrors(next);
    if (Object.values(next).some(Boolean)) return;
    launch(() => {
      if (!cardRef.current?.doPayment) throw new Error('card input not ready');
      cardRef.current.doPayment(
        card.makeElementCard({ name: name.trim(), expiryMM: mm, expiryYY: yy, cvv, saveCard: false })
      );
    });
  };

  const onPay = () => {
    if (method === 'upi') return payUpiId();
    if (method === 'card') return payCard();
    if (method === 'netbanking' && bank) return payBank(bank.code);
    return undefined;
  };

  let payLabel = `Pay ${amountLabel}`;
  let payDisabled = false;
  if (method === 'netbanking' && !bank) { payLabel = 'Select a bank above'; payDisabled = true; }
  if (method === 'wallet') { payLabel = 'Tap a wallet above'; payDisabled = true; }
  if (method === 'card' && (!card || !cfCardSession)) { payLabel = 'Card payments unavailable'; payDisabled = true; }

  const inputStyle = (key, err) => [s.input, focus === key && s.inputFocus, err && s.inputInvalid];

  return (
    <KeyboardAvoidingView style={{ flex: 1 }} behavior={Platform.OS === 'ios' ? 'padding' : undefined}>
      {/* Top bar */}
      <View style={s.topbar}>
        <TouchableOpacity style={s.topbarBack} onPress={onBack} accessibilityLabel="Back to cart" hitSlop={8}>
          <AppIcon name="arrow-back" size={17} color={C.ink800} />
        </TouchableOpacity>
        <View style={{ flex: 1 }}>
          <Text style={s.topbarTitle}>Checkout</Text>
          <Text style={s.topbarSub}>{isTakeaway ? 'Takeaway' : 'Dine-in'}</Text>
        </View>
      </View>

      <ScrollView style={s.body} contentContainerStyle={{ paddingBottom: 18 }} keyboardShouldPersistTaps="handled">
        {notice ? (
          <View style={s.errorBox}>
            <AppIcon name="alert-circle-outline" size={15} color={C.danger} />
            <Text style={s.errorBoxText}>{notice}</Text>
          </View>
        ) : null}

        {/* Order summary disclosure */}
        <TouchableOpacity style={s.disclosure} onPress={() => setOpen((v) => !v)} activeOpacity={0.8}>
          <View style={{ flex: 1 }}>
            <Text style={s.disclosureTitle}>{`Your order · ${itemCount} item${itemCount === 1 ? '' : 's'}`}</Text>
            <Text style={s.disclosureSub}>
              Amount payable <Text style={s.disclosureAmount}>{amountLabel}</Text>
            </Text>
          </View>
          <AppIcon name={open ? 'chevron-down' : 'chevron-forward'} size={16} color={C.ink400} />
        </TouchableOpacity>
        {open ? (
          <View style={s.orderCard}>
            {lines.map((it, i) => {
              const qty = Math.max(1, Number(it?.quantity) || 1);
              const unit = resolveItemUnitPrice(it);
              return (
                <View key={`${it?.id ?? i}`} style={s.orderRow}>
                  <Text style={s.orderItem} numberOfLines={1}>{`${it?.name || 'Item'} × ${qty}`}</Text>
                  {unit > 0 ? <Text style={s.orderPrice}>{formatInr(unit * qty)}</Text> : null}
                </View>
              );
            })}
            {isTakeaway && Number(takeawayCharge) > 0 ? (
              <View style={s.orderRow}>
                <Text style={s.orderItem}>Takeaway Charge(s)</Text>
                <Text style={s.orderPrice}>{formatInr(takeawayCharge)}</Text>
              </View>
            ) : null}
            {Number(discountAmount) > 0 ? (
              <View style={s.orderRow}>
                <Text style={s.orderItem}>
                  {offerCode ? `Discount (${offerCode})` : 'Discount'}
                </Text>
                <Text style={[s.orderPrice, { color: C.success }]}>
                  −{formatInr(discountAmount)}
                </Text>
              </View>
            ) : null}
            <View style={s.divider} />
            <View style={s.orderRow}>
              <Text style={s.orderTotalLabel}>Amount payable</Text>
              <Text style={s.orderTotalValue}>{amountLabel}</Text>
            </View>
          </View>
        ) : null}

        {/* Method tabs */}
        <Text style={s.sectionTitle}>Choose payment method</Text>
        <View style={s.methodTabs}>
          {METHODS.map((m) => {
            const active = method === m.key;
            return (
              <TouchableOpacity
                key={m.key}
                style={[s.methodTab, active && s.methodTabActive]}
                onPress={() => setMethod(m.key)}
                activeOpacity={0.8}
              >
                <View style={[s.methodTabIcon, active && s.methodTabIconActive]}>
                  <Text style={[s.methodTabIconText, active && { color: C.onBrand }]}>{m.icon}</Text>
                </View>
                <Text style={[s.methodTabLabel, active && s.methodTabLabelActive]}>{m.label}</Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* UPI pane */}
        {method === 'upi' ? (
          <View>
            {apps === null ? (
              <ActivityIndicator color={C.brandDark} style={{ marginVertical: 18 }} />
            ) : apps.length ? (
              <View style={s.grid}>
                {apps.map((a) => {
                  const look = UPI_APP_LOOKS[a.id] || {};
                  const label = look.label || a.name || 'UPI';
                  return (
                    <Tile key={a.id} label={label} short={look.short || label.slice(0, 2)} color={look.color} onPress={() => payUpiApp(a.id)} />
                  );
                })}
              </View>
            ) : (
              <Text style={s.emptyText}>No UPI apps found on this phone — enter your UPI ID below.</Text>
            )}
            <Field label="Or enter your UPI ID" error={vpaError}>
              <TextInput
                value={vpa}
                onChangeText={(t) => { setVpa(t); if (vpaError) setVpaError(''); }}
                placeholder="yourname@okhdfcbank"
                placeholderTextColor={C.ink400}
                autoCapitalize="none"
                autoCorrect={false}
                keyboardType="email-address"
                onFocus={() => setFocus('vpa')}
                onBlur={() => setFocus('')}
                style={inputStyle('vpa', vpaError)}
              />
            </Field>
          </View>
        ) : null}

        {/* Card pane */}
        {method === 'card' ? (
          card && cfCardSession ? (
            <View>
              <Field label="Card number" error={cardErrors.number}>
                <View style={{ justifyContent: 'center' }}>
                  {/* Cashfree-owned input: the full card number never reaches our JS state */}
                  <card.CFCardInput
                    ref={cardRef}
                    cfSession={cfCardSession}
                    cardListener={onCardListener}
                    placeholder="1234 5678 9012 3456"
                    placeholderTextColor={C.ink400}
                    maxLength={23}
                    onFocus={() => setFocus('number')}
                    onBlur={() => setFocus('')}
                    style={[...inputStyle('number', cardErrors.number), { paddingRight: 70 }]}
                  />
                  {cardInfo.network ? <Text style={s.brandTag}>{cardInfo.network}</Text> : null}
                </View>
              </Field>
              <View style={s.fieldRow}>
                <View style={{ flex: 1 }}>
                  <Field label="Expiry" error={cardErrors.expiry}>
                    <TextInput
                      value={expiry}
                      onChangeText={(t) => {
                        let d = t.replace(/\D/g, '').slice(0, 4);
                        if (d.length > 2) d = `${d.slice(0, 2)}/${d.slice(2)}`;
                        setExpiry(d);
                      }}
                      placeholder="MM/YY"
                      placeholderTextColor={C.ink400}
                      keyboardType="number-pad"
                      maxLength={5}
                      onFocus={() => setFocus('expiry')}
                      onBlur={() => setFocus('')}
                      style={inputStyle('expiry', cardErrors.expiry)}
                    />
                  </Field>
                </View>
                <View style={{ flex: 1 }}>
                  <Field label="CVV" error={cardErrors.cvv}>
                    <TextInput
                      value={cvv}
                      onChangeText={(t) => setCvv(t.replace(/\D/g, '').slice(0, 4))}
                      placeholder="•••"
                      placeholderTextColor={C.ink400}
                      keyboardType="number-pad"
                      secureTextEntry
                      maxLength={4}
                      onFocus={() => setFocus('cvv')}
                      onBlur={() => setFocus('')}
                      style={inputStyle('cvv', cardErrors.cvv)}
                    />
                  </Field>
                </View>
              </View>
              {/* Cashfree's native card builder needs a card-holder name */}
              <Field label="Name on card" error={cardErrors.name}>
                <TextInput
                  value={name}
                  onChangeText={setName}
                  placeholder="As printed on card"
                  placeholderTextColor={C.ink400}
                  autoCapitalize="characters"
                  onFocus={() => setFocus('name')}
                  onBlur={() => setFocus('')}
                  style={inputStyle('name', cardErrors.name)}
                />
              </Field>
            </View>
          ) : (
            <Text style={s.emptyText}>Card payments aren't available in this version of the app. Please use UPI or Net banking.</Text>
          )
        ) : null}

        {/* Net banking pane */}
        {method === 'netbanking' ? (
          <View>
            <View style={s.grid}>
              {QUICK_BANKS.map((b) => (
                <Tile key={b.code} label={b.short} short={b.short} color={b.color} onPress={() => payBank(b.code)} />
              ))}
            </View>
            <Field label="Or choose another bank">
              <TouchableOpacity
                style={[s.input, s.select, bankListOpen && s.inputFocus]}
                onPress={() => setBankListOpen((v) => !v)}
                activeOpacity={0.8}
              >
                <Text style={[s.selectText, !bank && { color: C.ink400 }]} numberOfLines={1}>
                  {bank ? bank.name : 'Select your bank'}
                </Text>
                <AppIcon name={bankListOpen ? 'chevron-up' : 'chevron-down'} size={16} color={C.ink500} />
              </TouchableOpacity>
              {bankListOpen ? (
                <View style={s.bankList}>
                  {OTHER_BANKS.map((b) => (
                    <TouchableOpacity
                      key={b.code}
                      style={[s.bankRow, bank?.code === b.code && s.bankRowActive]}
                      onPress={() => { setBank(b); setBankListOpen(false); }}
                    >
                      <Text style={s.bankRowText}>{b.name}</Text>
                      {bank?.code === b.code ? <AppIcon name="checkmark" size={16} color={C.brandDeep} /> : null}
                    </TouchableOpacity>
                  ))}
                </View>
              ) : null}
            </Field>
          </View>
        ) : null}

        {/* Wallet pane */}
        {method === 'wallet' ? (
          <View style={s.grid}>
            {WALLETS.map((w) => (
              <Tile key={w.id} label={w.label} short={w.short} color={w.color} textColor={w.textColor} onPress={payWallet} />
            ))}
          </View>
        ) : null}

        <View style={s.infoBanner}>
          <AppIcon name="shield-checkmark-outline" size={15} color={C.ink700} style={{ marginTop: 1 }} />
          <Text style={s.infoBannerText}>
            Your payment is processed securely by <Text style={{ fontFamily: F.bold }}>Cashfree Payments</Text>, an
            RBI-authorised PA. HungerTap never stores your card, bank or wallet details.
          </Text>
        </View>
      </ScrollView>

      <View style={[s.footer, { paddingBottom: bottomPad }]}>
        <TouchableOpacity
          activeOpacity={0.85}
          onPress={onPay}
          disabled={payDisabled}
          style={[s.btn, s.btnPrimary, payDisabled && s.btnDisabled]}
        >
          <Text style={s.btnPrimaryText}>{payLabel}</Text>
        </TouchableOpacity>
        <View style={s.trustStrip}><CashfreeBadge /></View>
      </View>
    </KeyboardAvoidingView>
  );
}

/* ------------------------------------------------------------------ */
/*  Screen 2: Processing                                               */
/* ------------------------------------------------------------------ */

function ProcessingScreen({ bottomPad }) {
  const spin = useRef(new Animated.Value(0)).current;
  useEffect(() => {
    const loop = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1000, easing: Easing.linear, useNativeDriver: true })
    );
    loop.start();
    return () => loop.stop();
  }, [spin]);
  const rotate = spin.interpolate({ inputRange: [0, 1], outputRange: ['0deg', '360deg'] });

  return (
    <View style={[s.centerWrap, { paddingBottom: bottomPad }]}>
      <View style={s.ringBox}>
        <Animated.View style={[s.ring, { transform: [{ rotate }] }]} />
        <AppIcon name="lock-closed-outline" size={30} color={C.brandDark} />
      </View>
      <Text style={s.processingTitle}>Processing your payment…</Text>
      <Text style={s.processingText}>
        Please wait while <Text style={{ fontFamily: F.bold, color: C.cashfree }}>cashfree</Text> securely confirms
        this transaction with your bank.
      </Text>
      <View style={s.processingWarn}>
        <AppIcon name="alert-circle-outline" size={14} color={C.warning} />
        <Text style={s.processingWarnText}>Do not press back or close the app</Text>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Screen 3: Failed                                                   */
/*  The Cashfree webhook voids the order on a failed attempt           */
/*  (void_failed_checkout_order), so "Try again" goes back to the cart  */
/*  to place a fresh order — never pay again on this one.               */
/* ------------------------------------------------------------------ */

function FailedScreen({ message, bottomPad, onTryAgain }) {
  return (
    <View style={[s.centerWrap, { paddingBottom: bottomPad }]}>
      <View style={s.resultIcon}>
        <AppIcon name="close" size={40} color={C.danger} />
      </View>
      <Text style={s.resultTitle}>Payment failed</Text>
      <Text style={s.resultDesc}>
        If any amount was deducted, it will be automatically refunded to your original payment method within 5–7 business days.
      </Text>
      {message ? <Text style={s.resultReason}>{message}</Text> : null}
      <View style={{ width: '100%' }}>
        <TouchableOpacity activeOpacity={0.85} onPress={onTryAgain} style={[s.btn, s.btnPrimary]}>
          <Text style={s.btnPrimaryText}>Try again</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const s = StyleSheet.create({
  root: { flex: 1, backgroundColor: C.white },

  topbar: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingHorizontal: 18, paddingTop: 10, paddingBottom: 14 },
  topbarBack: { width: 34, height: 34, borderRadius: 17, backgroundColor: C.ink100, alignItems: 'center', justifyContent: 'center' },
  topbarTitle: { fontSize: 18, fontFamily: F.bold, color: C.ink900 },
  topbarSub: { fontSize: 12.5, fontFamily: F.regular, color: C.ink500, marginTop: 1 },

  body: { flex: 1, paddingHorizontal: 18 },
  footer: { paddingHorizontal: 18, paddingTop: 14, borderTopWidth: 1, borderTopColor: C.ink100, backgroundColor: C.white },

  errorBox: { flexDirection: 'row', gap: 8, backgroundColor: C.dangerBg, borderRadius: R.sm, padding: 12, marginBottom: 12 },
  errorBoxText: { flex: 1, fontSize: 13, fontFamily: F.semiBold, color: C.danger },

  disclosure: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderWidth: 1.5, borderColor: C.ink100, borderRadius: R.md, backgroundColor: C.ink50, marginBottom: 10 },
  disclosureTitle: { fontSize: 14, fontFamily: F.bold, color: C.ink800 },
  disclosureSub: { fontSize: 13, fontFamily: F.regular, color: C.ink500, marginTop: 2 },
  disclosureAmount: { fontFamily: F.bold, color: C.ink900 },
  orderCard: { borderWidth: 1, borderColor: C.ink100, borderRadius: R.md, paddingVertical: 8, paddingHorizontal: 16, marginBottom: 6 },
  orderRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 6 },
  orderItem: { flex: 1, marginRight: 10, fontSize: 15, fontFamily: F.regular, color: C.ink700 },
  orderPrice: { fontSize: 15, fontFamily: F.semiBold, color: C.ink900 },
  orderTotalLabel: { fontSize: 16, fontFamily: F.bold, color: C.ink900 },
  orderTotalValue: { fontSize: 18, fontFamily: F.bold, color: C.ink900 },
  divider: { height: 1, backgroundColor: C.ink100, marginVertical: 6 },

  sectionTitle: { fontSize: 12.5, fontFamily: F.bold, color: C.ink400, textTransform: 'uppercase', letterSpacing: 0.6, marginTop: 14, marginBottom: 10 },

  methodTabs: { flexDirection: 'row', gap: 8, marginBottom: 16 },
  methodTab: { flex: 1, alignItems: 'center', gap: 5, paddingVertical: 10, paddingHorizontal: 4, borderWidth: 1.5, borderColor: C.ink100, borderRadius: R.sm, backgroundColor: C.white },
  methodTabActive: { borderColor: C.brand, backgroundColor: C.brand50 },
  methodTabIcon: { width: 28, height: 28, borderRadius: 14, backgroundColor: C.ink100, alignItems: 'center', justifyContent: 'center' },
  methodTabIconActive: { backgroundColor: C.brand },
  methodTabIconText: { fontSize: 13, fontFamily: F.bold, color: C.ink700 },
  methodTabLabel: { fontSize: 13, fontFamily: F.bold, color: C.ink500 },
  methodTabLabelActive: { color: C.brandDeep },

  grid: { flexDirection: 'row', flexWrap: 'wrap', marginHorizontal: -6, marginBottom: 4 },
  tile: { width: '25%', alignItems: 'center', paddingHorizontal: 6, marginBottom: 12 },
  tileIcon: { width: 52, height: 52, borderRadius: 14, alignItems: 'center', justifyContent: 'center', elevation: 1 },
  tileIconText: { color: '#fff', fontSize: 14, fontFamily: F.bold },
  tileLabel: { marginTop: 6, fontSize: 12, fontFamily: F.semiBold, color: C.ink700 },
  emptyText: { fontSize: 13.5, lineHeight: 20, fontFamily: F.regular, color: C.ink500, marginVertical: 10 },

  field: { marginBottom: 14 },
  fieldRow: { flexDirection: 'row', gap: 10 },
  label: { fontSize: 13, fontFamily: F.bold, color: C.ink700, marginBottom: 6 },
  input: { borderWidth: 1.5, borderColor: C.ink200, borderRadius: R.sm, paddingVertical: 12, paddingHorizontal: 14, fontSize: 16, fontFamily: F.regular, color: C.ink900, backgroundColor: C.white },
  inputFocus: { borderColor: C.brand },
  inputInvalid: { borderColor: C.danger },
  hintError: { fontSize: 12, fontFamily: F.semiBold, color: C.danger, marginTop: 5 },
  brandTag: { position: 'absolute', right: 12, fontSize: 11, fontFamily: F.bold, color: C.ink700 },
  select: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  selectText: { flex: 1, fontSize: 16, fontFamily: F.regular, color: C.ink900 },
  bankList: { marginTop: 6, borderWidth: 1, borderColor: C.ink200, borderRadius: R.sm, overflow: 'hidden' },
  bankRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingVertical: 12, paddingHorizontal: 14, borderBottomWidth: 1, borderBottomColor: C.ink100 },
  bankRowActive: { backgroundColor: C.brand50 },
  bankRowText: { fontSize: 15, fontFamily: F.medium, color: C.ink800 },

  infoBanner: { flexDirection: 'row', gap: 10, padding: 12, borderRadius: R.sm, backgroundColor: C.brand50, borderWidth: 1, borderColor: C.brandLight, marginTop: 6 },
  infoBannerText: { flex: 1, fontSize: 12.5, lineHeight: 18, fontFamily: F.regular, color: C.ink700 },

  btn: { width: '100%', borderRadius: R.sm, paddingVertical: 15, paddingHorizontal: 18, alignItems: 'center', justifyContent: 'center' },
  btnPrimary: { backgroundColor: C.brand, elevation: 4, shadowColor: C.brandDark, shadowOpacity: 0.35, shadowRadius: 10, shadowOffset: { width: 0, height: 6 } },
  btnPrimaryText: { color: C.onBrand, fontSize: 16.5, fontFamily: F.bold },
  btnDisabled: { opacity: 0.5, elevation: 0, shadowOpacity: 0 },

  trustStrip: { alignItems: 'center', paddingTop: 10, paddingBottom: 2 },
  cfBadge: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  cfMark: { width: 15, height: 15, borderRadius: 4, backgroundColor: C.cashfreeGreen, alignItems: 'center', justifyContent: 'center' },
  cfMarkInner: { width: 7, height: 7, borderRadius: 2, backgroundColor: '#fff' },
  cfBadgeText: { fontSize: 12.5, fontFamily: F.bold, color: C.cashfree },

  centerWrap: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24 },
  ringBox: { width: 96, height: 96, alignItems: 'center', justifyContent: 'center', marginBottom: 28 },
  ring: { position: 'absolute', width: 96, height: 96, borderRadius: 48, borderWidth: 5, borderColor: C.brandLight, borderTopColor: C.brand },
  processingTitle: { fontSize: 19, fontFamily: F.bold, color: C.ink900, marginBottom: 8, textAlign: 'center' },
  processingText: { fontSize: 14, lineHeight: 21, fontFamily: F.regular, color: C.ink500, textAlign: 'center', maxWidth: 270 },
  processingWarn: { marginTop: 28, flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 10, paddingHorizontal: 14, backgroundColor: C.warningBg, borderRadius: R.sm },
  processingWarnText: { fontSize: 12.5, fontFamily: F.semiBold, color: C.warning },

  resultIcon: { width: 84, height: 84, borderRadius: 42, backgroundColor: C.dangerBg, alignItems: 'center', justifyContent: 'center', marginBottom: 22 },
  resultTitle: { fontSize: 22, fontFamily: F.bold, color: C.ink900, marginBottom: 6 },
  resultDesc: { fontSize: 14, lineHeight: 21, fontFamily: F.regular, color: C.ink500, textAlign: 'center', maxWidth: 290, marginBottom: 14 },
  resultReason: { fontSize: 12.5, fontFamily: F.medium, color: C.ink400, textAlign: 'center', marginBottom: 20 },
});
