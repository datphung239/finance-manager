//! Finance Manager v2 domain rules. No database, browser or authentication dependencies.
use regex::Regex;
use serde::{Deserialize, Serialize};

pub const MAX_AMOUNT_VND: i64 = 9_000_000_000_000;

pub fn valid_iso_date(date: &str) -> bool {
    let bytes = date.as_bytes();
    if bytes.len() != 10 || bytes[4] != b'-' || bytes[7] != b'-' ||
       !bytes.iter().enumerate().all(|(i, b)| i == 4 || i == 7 || b.is_ascii_digit()) {
        return false;
    }
    let year = date[0..4].parse::<u16>().unwrap_or(0);
    let month = date[5..7].parse::<usize>().unwrap_or(0);
    let day = date[8..10].parse::<u8>().unwrap_or(0);
    if year == 0 || !(1..=12).contains(&month) {
        return false;
    }
    let leap = year % 4 == 0 && (year % 100 != 0 || year % 400 == 0);
    let days = [31, if leap {29} else {28}, 31,30,31,30,31,31,30,31,30,31];
    day > 0 && day <= days[month-1]
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum TxKind {
    Income,
    Expense,
    Transfer,
    CardCharge,
    CardPayment,
    DebtCollection,
    DebtPayment,
}

impl TxKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Income => "income",
            Self::Expense => "expense",
            Self::Transfer => "transfer",
            Self::CardCharge => "card_charge",
            Self::CardPayment => "card_payment",
            Self::DebtCollection => "debt_collection",
            Self::DebtPayment => "debt_payment",
        }
    }
}

#[derive(Debug, Clone, Deserialize)]
#[serde(deny_unknown_fields)]
pub struct NewTransaction {
    pub request_id: String,
    pub occurred_at: String,
    pub kind: TxKind,
    pub amount_vnd: i64,
    pub account_id: String,
    #[serde(default)]
    pub other_account_id: Option<String>,
    #[serde(default)]
    pub category_id: Option<String>,
    #[serde(default)]
    pub counterparty_id: Option<String>,
    #[serde(default)]
    pub debt_id: Option<String>,
    #[serde(default)]
    pub merchant: String,
    #[serde(default)]
    pub note: String,
}

impl NewTransaction {
    pub fn validate(&self) -> Result<(), &'static str> {
        if self.amount_vnd <= 0 || self.amount_vnd > MAX_AMOUNT_VND {
            return Err("amount_vnd must be a positive integer in supported VND range");
        }
        if self.request_id.len() < 8
            || self.request_id.len() > 100
            || !self
                .request_id
                .bytes()
                .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
        {
            return Err("invalid request_id");
        }
        if self.account_id.is_empty() || self.account_id.len() > 100 {
            return Err("account_id is required");
        }
        if !valid_iso_date(&self.occurred_at) {
            return Err("occurred_at must be a valid YYYY-MM-DD date");
        }
        if self.kind == TxKind::Transfer
            && (self.other_account_id.as_deref().unwrap_or("").is_empty()
                || self.other_account_id.as_deref() == Some(&self.account_id))
        {
            return Err("transfer requires a different destination account");
        }
        if matches!(self.kind, TxKind::DebtCollection | TxKind::DebtPayment)
            && self.debt_id.is_none()
        {
            return Err("debt settlement requires debt_id");
        }
        if self.merchant.len() > 160 || self.note.len() > 1000 {
            return Err("merchant or note is too long");
        }
        Ok(())
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum BankFlow {
    Credit,
    Debit,
}

impl BankFlow {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Credit => "credit",
            Self::Debit => "debit",
        }
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct BankCandidate {
    pub amount_vnd: i64,
    pub flow: BankFlow,
    pub redacted_summary: String,
}

/// Only parse explicit VND amounts and known credit/debit verbs.
/// Do NOT infer debts or post automatically from a notification.
pub fn parse_bank_notification(content: &str) -> Result<BankCandidate, &'static str> {
    let normalized = content.to_lowercase();
    if content.len() > 4000 {
        return Err("notification too long");
    }
    let credit = [
        "nhận tiền",
        "tiền vào",
        "ghi có",
        "credited",
        "credit to",
        "số tiền nhận",
        "biến động tăng",
    ]
    .iter()
    .any(|marker| normalized.contains(marker));
    let debit = [
        "chuyển tiền",
        "tiền ra",
        "ghi nợ",
        "debited",
        "debit from",
        "thanh toán",
        "biến động giảm",
    ]
    .iter()
    .any(|marker| normalized.contains(marker));
    if credit == debit {
        return Err("ambiguous bank notification direction");
    }

    let re = Regex::new(r"(?i)(?:vnd|vnđ|số tiền|ghi nợ|ghi có|amount|giao dịch|gd|\+|\-)\s*[:=]?\s*([0-9]{1,3}(?:[.,][0-9]{3})+|[0-9]{4,13})(?:\s*(?:vnd|vnđ|đ))?")
        .map_err(|_| "parser initialization failure")?;
    let cap = re.captures(content).ok_or("no explicit VND amount found")?;
    let raw = cap.get(1).ok_or("amount missing")?.as_str();
    let digits = raw.replace([',', '.'], "");
    let amount_vnd = digits.parse::<i64>().map_err(|_| "invalid amount")?;
    if !(1..=MAX_AMOUNT_VND).contains(&amount_vnd) {
        return Err("amount out of range");
    }
    Ok(BankCandidate {
        amount_vnd,
        flow: if credit {
            BankFlow::Credit
        } else {
            BankFlow::Debit
        },
        redacted_summary: format!(
            "{} • {} VND • chờ xác nhận",
            if credit { "Tiền vào" } else { "Tiền ra" },
            amount_vnd
        ),
    })
}

#[derive(Debug, Clone, Serialize, Deserialize, Default, PartialEq, Eq)]
pub struct Totals {
    pub income_vnd: i64,
    pub expense_vnd: i64,
    pub card_charge_vnd: i64,
    pub card_payment_vnd: i64,
    pub collected_debt_vnd: i64,
    pub paid_debt_vnd: i64,
}
impl Totals {
    pub fn from_rows(rows: &[(TxKind, i64)]) -> Result<Self, &'static str> {
        let mut totals = Self::default();
        for &(kind, amount) in rows {
            if !(1..=MAX_AMOUNT_VND).contains(&amount) {
                return Err("invalid ledger amount");
            }
            let dest = match kind {
                TxKind::Income => &mut totals.income_vnd,
                TxKind::Expense => &mut totals.expense_vnd,
                TxKind::CardCharge => &mut totals.card_charge_vnd,
                TxKind::CardPayment => &mut totals.card_payment_vnd,
                TxKind::DebtCollection => &mut totals.collected_debt_vnd,
                TxKind::DebtPayment => &mut totals.paid_debt_vnd,
                TxKind::Transfer => continue,
            };
            *dest = dest.checked_add(amount).ok_or("ledger total overflow")?;
        }
        Ok(totals)
    }
}
