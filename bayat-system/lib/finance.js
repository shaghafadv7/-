// ============================================================
// بيات الأكنة — المحرك المالي المركزي (v1.12)
// المصدر الوحيد للحقيقة لكل رقم مالي في النظام:
// قاعدة البيانات → المحرك المالي → API → الواجهة/PDF/Excel
//
// قواعد ثابتة لا تُكرَّر في أي مكان آخر:
//   السعر النهائي  = السعر الأساسي − الخصومات النشطة + صافي التسويات المعتمدة
//   إجمالي المدفوع = الدفعات المحصّلة فعليًا + العربون المربوط بالصفقة (مرة واحدة)
//   المتبقي        = السعر النهائي − إجمالي المدفوع   (السالب = رصيد دائن للعميل)
//   الإيراد المحقق = min(المدفوع، السعر النهائي)  ← الدفع الزائد ليس إيرادًا
//   صافي الربح     = الإيراد المحقق − تكلفة العقار − العمولة − المصروفات
//
// سياسة الحالات المالية (payment_status) المعتمدة:
//   received / deposited → محصّلة فعليًا (تدخل في المدفوع)
//   pending              → معلقة، لا تدخل في المدفوع (تُعرض منفصلة)
//   refunded / cancelled → لا تدخل في المدفوع إطلاقًا
//   وكذلك أي سجل status='cancelled' لا يدخل في أي حساب.
// ============================================================

// الحالات التي تُعتبر تحصيلًا فعليًا
const COLLECTED_STATUSES = ['received', 'deposited'];
const PENDING_STATUSES = ['pending'];
// دفعات الحجز المربوطة فعليًا بصفقة بيع
const LINKED_DEPOSIT_STATUSES = ['transferred', 'linked_to_sale'];

const inList = arr => arr.map(() => '?').join(',');

function build(db) {
  // ---------- استعلامات مُعدّة مسبقًا (أداء: تُحضَّر مرة واحدة) ----------
  const qPayments = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN COALESCE(payment_status,'received') IN (${inList(COLLECTED_STATUSES)}) THEN amount ELSE 0 END),0) collected,
      COALESCE(SUM(CASE WHEN COALESCE(payment_status,'received') IN (${inList(PENDING_STATUSES)}) THEN amount ELSE 0 END),0) pending,
      COALESCE(SUM(CASE WHEN COALESCE(payment_status,'received')='refunded' THEN amount ELSE 0 END),0) refunded
    FROM payments WHERE sale_id=? AND status='active'`);
  const qDeposits = db.prepare(`SELECT
      COALESCE(SUM(CASE WHEN COALESCE(payment_status,'received') IN (${inList(COLLECTED_STATUSES)}) THEN amount ELSE 0 END),0) collected,
      COALESCE(SUM(CASE WHEN COALESCE(payment_status,'received') IN (${inList(PENDING_STATUSES)}) THEN amount ELSE 0 END),0) pending,
      COALESCE(SUM(CASE WHEN COALESCE(payment_status,'received')='refunded' THEN amount ELSE 0 END),0) refunded,
      COUNT(*) cnt
    FROM reservation_payments WHERE sale_id=? AND status IN (${inList(LINKED_DEPOSIT_STATUSES)})`);
  const qDiscounts = db.prepare("SELECT COALESCE(SUM(amount),0) t FROM discounts WHERE sale_id=? AND status='active'");
  const qExpenses = db.prepare("SELECT COALESCE(SUM(amount),0) t FROM expenses WHERE sale_id=? AND status='active'");
  const qAdjust = db.prepare(`SELECT adjustment_type,COALESCE(SUM(amount),0) amount FROM financial_adjustments
    WHERE sale_id=? AND status='active' AND adjustment_type IN ('balance_debit','balance_credit') GROUP BY adjustment_type`);
  const qCommissionPaid = db.prepare("SELECT COALESCE(SUM(amount),0) t FROM commission_payments WHERE sale_id=? AND status='active'");
  const qSale = db.prepare('SELECT * FROM sales WHERE id=?');

  // ---------- لبنات الحساب ----------
  const discountsSum = saleId => qDiscounts.get(saleId).t;
  const expensesSum = saleId => qExpenses.get(saleId).t;
  const commissionPaidSum = saleId => qCommissionPaid.get(saleId).t;

  function adjustments(saleId) {
    const rows = qAdjust.all(saleId);
    const m = Object.fromEntries(rows.map(x => [x.adjustment_type, x.amount]));
    const debit = m.balance_debit || 0, credit = m.balance_credit || 0;
    return { debit, credit, net: debit - credit };
  }

  // تفصيل المدفوع: دفعات البيع + العربون المربوط — كل قيد يُحتسب مرة واحدة فقط
  function paidBreakdown(saleId) {
    // ترتيب الوسائط يتبع ترتيب علامات الاستفهام في الاستعلام:
    // حالات التحصيل ← الحالات المعلقة ← sale_id ← (للعربون) حالات الربط
    const p = qPayments.get(...COLLECTED_STATUSES, ...PENDING_STATUSES, saleId);
    const d = qDeposits.get(...COLLECTED_STATUSES, ...PENDING_STATUSES, saleId, ...LINKED_DEPOSIT_STATUSES);
    return {
      payments: p.collected,
      deposit: d.collected,
      deposit_count: d.cnt,
      paid: p.collected + d.collected,
      pending: p.pending + d.pending,
      refunded: p.refunded + d.refunded,
    };
  }
  const totalPaid = saleId => paidBreakdown(saleId).paid;

  // ---------- الملخص المالي الكامل للصفقة ----------
  function saleFinance(sale) {
    const s = typeof sale === 'object' ? sale : qSale.get(sale);
    if (!s) return null;
    const cancelled = s.status === 'cancelled';
    const base = s.base_price || s.list_price || 0;
    const disc = cancelled ? 0 : discountsSum(s.id);
    const adj = cancelled ? { debit: 0, credit: 0, net: 0 } : adjustments(s.id);
    const final = Math.max(0, base - disc + adj.net);
    const br = paidBreakdown(s.id);
    const paid = br.paid;
    const remaining = final - paid;                 // سالب = رصيد دائن للعميل
    const expenses = expensesSum(s.id);
    const commission = cancelled ? 0 : (s.commission_total || 0);
    const commissionPaid = commissionPaidSum(s.id);
    const propertyCost = s.property_cost ?? s.purchase_cost ?? s.purchase_price ?? 0;
    // الدفع الزائد لا يُعتبر إيرادًا — يُحتسب رصيدًا دائنًا للعميل
    const realizedRevenue = Math.min(paid, Math.max(0, final));
    const overpaid = Math.max(0, paid - Math.max(0, final));
    const grossProfit = realizedRevenue - propertyCost;
    const totalCosts = propertyCost + expenses + commission;
    const netProfit = realizedRevenue - totalCosts;
    const pct = v => propertyCost > 0 ? Math.round(v / propertyCost * 10000) / 100 : null;
    return {
      // — الملخص المعتمد (الترتيب المعروض في كل الشاشات والتقارير) —
      base, discounts: disc, adjustments: adj, final,
      paid, paid_payments: br.payments, paid_deposit: br.deposit, deposit_count: br.deposit_count,
      pending_amount: br.pending, refunded_amount: br.refunded,
      collected: paid, realized_revenue: realizedRevenue,
      remaining,
      receivable: remaining > 0 ? remaining : 0,
      overpaid,
      client_state: remaining > 0.001 ? 'due_from_client' : (remaining < -0.001 ? 'due_to_client' : 'settled'),
      client_due: remaining > 0 ? remaining : 0,
      client_credit: remaining < 0 ? -remaining : 0,
      property_cost: propertyCost, purchase_cost: propertyCost,
      resale_price: s.is_resale ? final : null,
      expenses, commission, commission_paid: commissionPaid,
      commission_remaining: Math.max(0, commission - commissionPaid),
      total_costs: totalCosts,
      gross_profit: grossProfit, gross_profit_pct: pct(grossProfit),
      net_profit: netProfit, net_profit_pct: pct(netProfit),
      profit_basis: 'collected',
      profit_state: netProfit > 0 ? 'profit' : (netProfit < 0 ? 'loss' : 'even'),
      commission_pct: s.commission_type === 'percent' ? s.commission_value : null,
      prev_owner_finance: (() => {
        if (!s.prev_sale_id) return null;
        const ps = qSale.get(s.prev_sale_id);
        if (!ps) return null;
        const pf = saleFinance(ps);
        return { paid: pf.paid, remaining: pf.remaining, final: pf.final };
      })(),
      new_owner_finance: { paid, remaining },
    };
  }

  // ---------- إعادة احتساب وتخزين أرقام الصفقة ----------
  // تكتب في sales نفس ما يحسبه المحرك — فلا يوجد رقمان مختلفان أبدًا.
  function recalcSale(saleId) {
    const s = qSale.get(saleId);
    if (!s) return null;
    const f = saleFinance(s);
    db.prepare('UPDATE sales SET discount_amount=?,final_price=?,paid_amount=?,remaining_amount=? WHERE id=?')
      .run(f.discounts, f.final, f.paid, f.remaining, saleId);
    if (s.status === 'active') {
      const st = f.remaining <= 0.005 ? 'paid' : 'sold';
      db.prepare("UPDATE units SET status=?,updated_at=CURRENT_TIMESTAMP WHERE id=? AND status IN ('sold','paid')").run(st, s.unit_id);
    }
    return f;
  }

  function recalcCommission(saleId) {
    const s = qSale.get(saleId);
    if (!s) return;
    const paid = commissionPaidSum(saleId);
    let status = s.commission_status;
    if (s.commission_status !== 'cancelled') {
      if (!s.marketer_id || !(s.commission_total > 0)) status = 'none';
      else if (paid >= s.commission_total && s.commission_total > 0) status = 'paid';
      else if (paid > 0) status = 'partial';
      else status = 'unpaid';
    }
    db.prepare('UPDATE sales SET commission_paid=?,commission_status=? WHERE id=?').run(paid, status, saleId);
  }

  return {
    COLLECTED_STATUSES, PENDING_STATUSES, LINKED_DEPOSIT_STATUSES,
    discountsSum, expensesSum, commissionPaidSum, adjustments,
    paidBreakdown, totalPaid, saleFinance, recalcSale, recalcCommission,
  };
}

module.exports = { build, COLLECTED_STATUSES, PENDING_STATUSES, LINKED_DEPOSIT_STATUSES };
