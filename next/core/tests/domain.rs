use finance_core::{parse_bank_notification, BankFlow, NewTransaction, Totals, TxKind};

#[test]
fn verifies_finance_signs_and_transfers() {
    let totals = Totals::from_rows(&[
        (TxKind::Income, 10_000_000), (TxKind::Expense, 2_000_000),
        (TxKind::CardCharge, 1_200_000), (TxKind::CardPayment, 700_000),
        (TxKind::Transfer, 9_000_000),
    ]).unwrap();
    assert_eq!(totals.income_vnd, 10_000_000);
    assert_eq!(totals.expense_vnd, 2_000_000);
    assert_eq!(totals.card_charge_vnd - totals.card_payment_vnd, 500_000);
}
#[test]
fn requires_idempotency_and_sane_vnd() {
    let input = NewTransaction {
        request_id:"r-20261120-0001".into(), occurred_at:"2026-11-20".into(),
        kind:TxKind::Transfer, amount_vnd:1_000_000, account_id:"a".into(),
        other_account_id:Some("a".into()), category_id:None, counterparty_id:None,
        debt_id:None, merchant:String::new(), note:String::new()
    };
    assert!(input.validate().is_err());
    let input=NewTransaction{other_account_id:Some("b".into()), ..input};
    assert!(input.validate().is_ok());
    let input=NewTransaction{amount_vnd:0, ..input};
    assert!(input.validate().is_err());
}
#[test]
fn notification_parsing_is_review_only() {
    let candidate=parse_bank_notification("TK nhận tiền; Số tiền: 1.234.567 VND; nội dung ABC").unwrap();
    assert_eq!(candidate.amount_vnd, 1_234_567);
    assert_eq!(candidate.flow, BankFlow::Credit);
    assert!(!candidate.redacted_summary.contains("ABC"));
    assert!(parse_bank_notification("Biến động số dư 500000 VND").is_err());
    let debit=parse_bank_notification("TK ghi nợ: 35,000 VND").unwrap();
    assert_eq!(debit.amount_vnd, 35_000);
    assert_eq!(debit.flow, BankFlow::Debit);
}
