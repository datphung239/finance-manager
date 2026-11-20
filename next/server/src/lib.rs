//! Finance Manager v2: Rust Cloudflare Worker API. No Apps Script/Sheets.
#![forbid(unsafe_code)]
mod auth;

use finance_core::{parse_bank_notification, NewTransaction, TxKind};
use js_sys::{Function, Reflect};
use serde::Deserialize;
use serde_json::{json, Value};
use wasm_bindgen::{JsCast, JsValue};
use worker::*;

#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NewAccount {
    name: String,
    kind: String,
    #[serde(default)]
    opening_balance_vnd: i64,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NewCategory {
    name: String,
    kind: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NewCounterparty {
    name: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NewDebt {
    counterparty_id: String,
    direction: String,
    title: String,
    principal_vnd: i64,
    #[serde(default)]
    due_date: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NewSettlement {
    request_id: String,
    account_id: String,
    amount_vnd: i64,
    occurred_at: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NotificationPreview {
    text: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct NewBankInbox {
    source_package: String,
    dedupe_key: String,
    text: String,
    #[serde(default)]
    occurred_at: Option<String>,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct PostInbox {
    request_id: String,
    account_id: String,
    #[serde(default)]
    category_id: Option<String>,
}

fn uid() -> Result<String> {
    let crypto = Reflect::get(&js_sys::global(), &JsValue::from_str("crypto"))
        .map_err(|_| Error::RustError("Crypto is not available".into()))?;
    let fun: Function = Reflect::get(&crypto, &JsValue::from_str("randomUUID"))
        .map_err(|_| Error::RustError("Crypto randomUUID unavailable".into()))?
        .dyn_into()
        .map_err(|_| Error::RustError("Crypto.randomUUID is not a function".into()))?;
    fun.call0(&crypto)
        .map_err(|_| Error::RustError("UUID generation failed".into()))?
        .as_string()
        .ok_or_else(|| Error::RustError("Invalid UUID".into()))
}
fn json_ok(data: &Value) -> Result<Response> {
    let mut response = Response::from_json(data)?;
    response
        .headers_mut()
        .set("Cache-Control", "no-store, private")?;
    response
        .headers_mut()
        .set("X-Content-Type-Options", "nosniff")?;
    Ok(response)
}
fn invalid(message: &str) -> Result<Response> {
    Response::from_json(&json!({"ok":false,"error":message})).map(|mut r| {
        r.headers_mut().set("Cache-Control", "no-store").ok();
        r.with_status(400)
    })
}
fn conflict(message: &str) -> Result<Response> {
    Response::from_json(&json!({"ok":false,"error":message})).map(|mut r| {
        r.headers_mut().set("Cache-Control", "no-store").ok();
        r.with_status(409)
    })
}
fn not_found() -> Result<Response> {
    Response::error("Not found", 404)
}
fn map_db_error() -> Result<Response> {
    Response::error("Database operation failed", 500)
}

async fn rows(db: &D1Database, owner: &str, sql: &str) -> Result<Vec<Value>> {
    query!(db, sql, owner)?.all().await?.results::<Value>()
}
async fn exists(db: &D1Database, table: &str, owner: &str, id: &str) -> Result<bool> {
    // Table name is internal constant chosen here; never interpolated from user input.
    if !matches!(
        table,
        "accounts" | "categories" | "counterparties" | "debts"
    ) {
        return Ok(false);
    }
    let sql = format!("SELECT id FROM {table} WHERE owner_id = ?1 AND id = ?2 LIMIT 1");
    Ok(query!(db, &sql, owner, id)?
        .first::<Value>(None)
        .await?
        .is_some())
}
async fn bootstrap(db: &D1Database, user: &auth::AccessUser) -> Result<Response> {
    let owner = &user.sub;
    let accounts = rows(db,owner,
        "SELECT id,name,kind,opening_balance_vnd FROM accounts WHERE owner_id=?1 AND archived_at IS NULL ORDER BY kind,name").await?;
    let categories = rows(db,owner,
        "SELECT id,name,kind FROM categories WHERE owner_id=?1 AND archived_at IS NULL ORDER BY kind,name").await?;
    let counterparties = rows(
        db,
        owner,
        "SELECT id,name FROM counterparties WHERE owner_id=?1 ORDER BY name",
    )
    .await?;
    let transactions = rows(db,owner,
        "SELECT id,request_id,occurred_at,kind,amount_vnd,account_id,other_account_id,category_id,counterparty_id,debt_id,merchant,note,source FROM transactions WHERE owner_id=?1 AND deleted_at IS NULL ORDER BY occurred_at DESC, created_at DESC LIMIT 250").await?;
    let debts = rows(db,owner,
        "SELECT d.id,d.title,d.direction,d.principal_vnd,d.settled_vnd,d.due_date,d.counterparty_id,c.name AS counterparty_name FROM debts d JOIN counterparties c ON c.id=d.counterparty_id AND c.owner_id=d.owner_id WHERE d.owner_id=?1 AND d.archived_at IS NULL ORDER BY d.created_at DESC LIMIT 250").await?;
    let bank_inbox = rows(db,owner,
        "SELECT id,source_package,redacted_summary,amount_vnd,flow,occurred_at,received_at,status FROM bank_inbox WHERE owner_id=?1 AND status='pending' ORDER BY received_at DESC LIMIT 100").await?;
    let totals = query!(db,
        "SELECT COALESCE(SUM(CASE WHEN kind='income' THEN amount_vnd ELSE 0 END),0) AS income_vnd,
         COALESCE(SUM(CASE WHEN kind='expense' THEN amount_vnd ELSE 0 END),0) AS expense_vnd,
         COALESCE(SUM(CASE WHEN kind='card_charge' THEN amount_vnd ELSE 0 END),0) AS card_charge_vnd,
         COALESCE(SUM(CASE WHEN kind='card_payment' THEN amount_vnd ELSE 0 END),0) AS card_payment_vnd
         FROM transactions WHERE owner_id=?1 AND deleted_at IS NULL",owner)?
         .first::<Value>(None).await?.unwrap_or_else(||json!({}));
    let balances = rows(db,owner,
        "SELECT a.id,a.name,a.kind,
         a.opening_balance_vnd + COALESCE((SELECT SUM(CASE
           WHEN t.account_id=a.id AND t.kind IN ('income','debt_collection') THEN t.amount_vnd
           WHEN t.account_id=a.id AND t.kind IN ('expense','debt_payment','transfer','card_payment','card_charge') THEN -t.amount_vnd
           WHEN t.other_account_id=a.id AND t.kind IN ('transfer','card_payment') THEN t.amount_vnd
           ELSE 0 END)
           FROM transactions t WHERE t.owner_id=a.owner_id AND t.deleted_at IS NULL
           AND (t.account_id=a.id OR t.other_account_id=a.id)),0) AS balance_vnd
         FROM accounts a WHERE a.owner_id=?1 AND a.archived_at IS NULL ORDER BY a.kind,a.name").await?;
    json_ok(&json!({"ok":true,"user":{"email":user.email},
        "accounts":accounts,"categories":categories,"counterparties":counterparties,
        "transactions":transactions,"debts":debts,"bank_inbox":bank_inbox,
        "totals":totals,"balances":balances}))
}
async fn create_account(req: &mut Request, db: &D1Database, owner: &str) -> Result<Response> {
    let input: NewAccount = match req.json().await {
        Ok(v) => v,
        Err(_) => return invalid("Invalid account JSON"),
    };
    let name = input.name.trim();
    if name.is_empty()
        || name.len() > 100
        || !matches!(input.kind.as_str(), "cash" | "bank" | "credit_card")
        || input.opening_balance_vnd < -9_000_000_000_000
        || input.opening_balance_vnd > 9_000_000_000_000
    {
        return invalid("Invalid account properties");
    }
    let id = uid()?;
    query!(
        db,
        "INSERT INTO accounts(id,owner_id,name,kind,opening_balance_vnd) VALUES(?1,?2,?3,?4,?5)",
        &id,
        owner,
        name,
        &input.kind,
        input.opening_balance_vnd
    )?
    .run()
    .await?;
    json_ok(&json!({"ok":true,"id":id}))
}
async fn create_category(req: &mut Request, db: &D1Database, owner: &str) -> Result<Response> {
    let input: NewCategory = match req.json().await {
        Ok(v) => v,
        Err(_) => return invalid("Invalid category JSON"),
    };
    let name = input.name.trim();
    if name.is_empty()
        || name.len() > 100
        || !matches!(input.kind.as_str(), "income" | "expense" | "both")
    {
        return invalid("Invalid category");
    }
    let id = uid()?;
    query!(
        db,
        "INSERT INTO categories(id,owner_id,name,kind) VALUES(?1,?2,?3,?4)",
        &id,
        owner,
        name,
        &input.kind
    )?
    .run()
    .await?;
    json_ok(&json!({"ok":true,"id":id}))
}
async fn create_counterparty(req: &mut Request, db: &D1Database, owner: &str) -> Result<Response> {
    let input: NewCounterparty = match req.json().await {
        Ok(v) => v,
        Err(_) => return invalid("Invalid counterparty JSON"),
    };
    let name = input.name.trim();
    if name.is_empty() || name.len() > 160 {
        return invalid("Invalid counterparty");
    }
    let id = uid()?;
    query!(
        db,
        "INSERT INTO counterparties(id,owner_id,name) VALUES(?1,?2,?3)",
        &id,
        owner,
        name
    )?
    .run()
    .await?;
    json_ok(&json!({"ok":true,"id":id}))
}
async fn create_debt(req: &mut Request, db: &D1Database, owner: &str) -> Result<Response> {
    let input: NewDebt = match req.json().await {
        Ok(v) => v,
        Err(_) => return invalid("Invalid debt JSON"),
    };
    if input.title.trim().is_empty()
        || input.title.len() > 200
        || input.principal_vnd <= 0
        || input.principal_vnd > finance_core::MAX_AMOUNT_VND
        || !matches!(input.direction.as_str(), "receivable" | "payable")
        || !exists(db, "counterparties", owner, &input.counterparty_id).await?
    {
        return invalid("Invalid debt or counterparty");
    }
    let id = uid()?;
    query!(db,"INSERT INTO debts(id,owner_id,counterparty_id,direction,principal_vnd,title,due_date) VALUES(?1,?2,?3,?4,?5,?6,?7)",
        &id,owner,&input.counterparty_id,&input.direction,input.principal_vnd,
        input.title.trim(),&input.due_date)?.run().await?;
    json_ok(&json!({"ok":true,"id":id}))
}
async fn create_tx(req: &mut Request, db: &D1Database, owner: &str) -> Result<Response> {
    let tx: NewTransaction = match req.json().await {
        Ok(v) => v,
        Err(_) => return invalid("Invalid transaction JSON"),
    };
    if let Err(e) = tx.validate() {
        return invalid(e);
    }
    if let Some(previous) =
        query!(db,
       "SELECT id,kind,amount_vnd,account_id,other_account_id,category_id,counterparty_id,debt_id,
               occurred_at,merchant,note
          FROM transactions WHERE owner_id=?1 AND request_id=?2 LIMIT 1",
        owner,&tx.request_id)?
        .first::<Value>(None)
        .await?
    {
        let text_eq =
            |key: &str, expected: &str| previous.get(key).and_then(Value::as_str) == Some(expected);
        let optional_eq = |key: &str, expected: &Option<String>| {
            previous.get(key).and_then(Value::as_str) == expected.as_deref()
        };
        let unchanged = text_eq("kind", tx.kind.as_str())
            && text_eq("account_id", &tx.account_id)
            && text_eq("occurred_at", &tx.occurred_at)
            && text_eq("merchant", &tx.merchant)
            && text_eq("note", &tx.note)
            && previous["amount_vnd"].as_i64() == Some(tx.amount_vnd)
            && optional_eq("other_account_id", &tx.other_account_id)
            && optional_eq("category_id", &tx.category_id)
            && optional_eq("counterparty_id", &tx.counterparty_id)
            && optional_eq("debt_id", &tx.debt_id);
        if !unchanged {
            return conflict("request_id already used for a different financial transaction");
        }
        return json_ok(&json!({"ok":true,"id":previous["id"],"idempotent":true}));
    }
    if !exists(db, "accounts", owner, &tx.account_id).await?
        || tx.other_account_id.as_ref().is_some_and(|v| v.len() > 100)
        || (tx.other_account_id.is_some()
            && !exists(
                db,
                "accounts",
                owner,
                tx.other_account_id.as_deref().unwrap_or(""),
            )
            .await?)
        || (tx.category_id.is_some()
            && !exists(
                db,
                "categories",
                owner,
                tx.category_id.as_deref().unwrap_or(""),
            )
            .await?)
        || (tx.debt_id.is_some()
            && !exists(db, "debts", owner, tx.debt_id.as_deref().unwrap_or("")).await?)
        || (tx.counterparty_id.is_some()
            && !exists(
                db,
                "counterparties",
                owner,
                tx.counterparty_id.as_deref().unwrap_or(""),
            )
            .await?)
    {
        return invalid("Referenced account, category or debt does not belong to this user");
    }
    // Enforce account semantics in the API, not only the browser form.
    // A card charge creates liability; a card payment transfers cash to a card.
    let account = query!(
        db,
        "SELECT kind FROM accounts WHERE owner_id=?1 AND id=?2 AND archived_at IS NULL",
        owner,
        &tx.account_id
    )?
    .first::<Value>(None)
    .await?;
    let src_kind = account
        .as_ref()
        .and_then(|v| v["kind"].as_str())
        .unwrap_or("");
    let other_kind = if let Some(ref destination) = tx.other_account_id {
        query!(
            db,
            "SELECT kind FROM accounts WHERE owner_id=?1 AND id=?2 AND archived_at IS NULL",
            owner,
            destination
        )?
        .first::<Value>(None)
        .await?
    } else {
        None
    };
    let dst_kind = other_kind
        .as_ref()
        .and_then(|v| v["kind"].as_str())
        .unwrap_or("");
    let permitted = match tx.kind {
        TxKind::Income | TxKind::Expense => {
            matches!(src_kind, "cash" | "bank") && tx.other_account_id.is_none()
        }
        TxKind::Transfer => {
            matches!(src_kind, "cash" | "bank") && matches!(dst_kind, "cash" | "bank")
        }
        TxKind::CardCharge => src_kind == "credit_card" && tx.other_account_id.is_none(),
        TxKind::CardPayment => matches!(src_kind, "cash" | "bank") && dst_kind == "credit_card",
        TxKind::DebtCollection | TxKind::DebtPayment => false,
    };
    if !permitted {
        return invalid("Account kinds do not match transaction type");
    }

    // Debt settlements must use the dedicated atomic settlement route.
    if matches!(tx.kind, TxKind::DebtCollection | TxKind::DebtPayment) {
        return invalid("Use the debt settlement endpoint");
    }
    let id = uid()?;
    let audit_id = uid()?;
    let transaction = query!(
        db,
        "INSERT INTO transactions(id,owner_id,request_id,occurred_at,kind,amount_vnd,
           account_id,other_account_id,category_id,counterparty_id,debt_id,merchant,note)
         VALUES(?1,?2,?3,?4,?5,?6,?7,?8,?9,?10,?11,?12,?13)",
        &id,
        owner,
        &tx.request_id,
        &tx.occurred_at,
        tx.kind.as_str(),
        tx.amount_vnd,
        &tx.account_id,
        &tx.other_account_id,
        &tx.category_id,
        &tx.counterparty_id,
        &tx.debt_id,
        &tx.merchant,
        &tx.note
    )?;
    let audit=query!(db,"INSERT INTO audit_log(id,owner_id,entity_kind,entity_id,action) VALUES(?1,?2,'transaction',?3,'create')",
        &audit_id,owner,&id)?;
    db.batch(vec![transaction, audit]).await?;
    json_ok(&json!({"ok":true,"id":id,"idempotent":false}))
}
async fn delete_tx(db: &D1Database, owner: &str, id: &str) -> Result<Response> {
    if id.len() > 100 {
        return invalid("Invalid transaction ID");
    }
    let audit_id = uid()?;
    // Use a conditional INSERT .. SELECT so no audit is produced for absent rows.
    db.batch(vec![
        query!(db,"UPDATE transactions SET deleted_at=datetime('now') WHERE owner_id=?1 AND id=?2 AND deleted_at IS NULL",owner,id)?,
        query!(db,"INSERT INTO audit_log(id,owner_id,entity_kind,entity_id,action)
              SELECT ?1,?2,'transaction',?3,'delete'
              WHERE EXISTS(SELECT 1 FROM transactions WHERE owner_id=?2 AND id=?3 AND deleted_at IS NOT NULL)",
              &audit_id,owner,id)?
    ]).await?;
    json_ok(&json!({"ok":true}))
}
async fn preview_notification(req: &mut Request) -> Result<Response> {
    let input: NotificationPreview = match req.json().await {
        Ok(v) => v,
        Err(_) => return invalid("Invalid notification JSON"),
    };
    match parse_bank_notification(&input.text) {
        Ok(candidate) => {
            json_ok(&json!({"ok":true,"candidate":candidate,"requires_confirmation":true}))
        }
        Err(reason) => invalid(reason),
    }
}
async fn create_bank_inbox(req: &mut Request, db: &D1Database, owner: &str) -> Result<Response> {
    let input: NewBankInbox = match req.json().await {
        Ok(v) => v,
        Err(_) => return invalid("Invalid bank notification"),
    };
    if input.source_package.len() > 200
        || input.source_package.len() < 3
        || input.dedupe_key.len() < 12
        || input.dedupe_key.len() > 200
        || !input
            .dedupe_key
            .bytes()
            .all(|c| c.is_ascii_alphanumeric() || c == b'-' || c == b'_')
    {
        return invalid("Invalid notification source or fingerprint");
    }
    let candidate = match parse_bank_notification(&input.text) {
        Ok(v) => v,
        Err(e) => return invalid(e),
    };
    // Raw bank notification text intentionally discarded; NEVER stored in D1.
    if let Some(previous) = query!(
        db,
        "SELECT id FROM bank_inbox WHERE owner_id=?1 AND dedupe_key=?2 LIMIT 1",
        owner,
        &input.dedupe_key
    )?
    .first::<Value>(None)
    .await?
    {
        return json_ok(&json!({"ok":true,"id":previous["id"],"idempotent":true}));
    }
    let id = uid()?;
    query!(db,"INSERT INTO bank_inbox(id,owner_id,source_package,dedupe_key,amount_vnd,flow,redacted_summary,occurred_at)
      VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
      &id,owner,&input.source_package,&input.dedupe_key,candidate.amount_vnd,
      candidate.flow.as_str(),&candidate.redacted_summary,&input.occurred_at)?.run().await?;
    json_ok(&json!({"ok":true,"id":id,"status":"pending","idempotent":false}))
}
async fn ignore_bank_inbox(db: &D1Database, owner: &str, id: &str) -> Result<Response> {
    query!(
        db,
        "UPDATE bank_inbox SET status='ignored' WHERE id=?1 AND owner_id=?2 AND status='pending'",
        id,
        owner
    )?
    .run()
    .await?;
    json_ok(&json!({"ok":true}))
}
async fn post_bank_inbox(
    req: &mut Request,
    db: &D1Database,
    owner: &str,
    id: &str,
) -> Result<Response> {
    let input: PostInbox = match req.json().await {
        Ok(v) => v,
        Err(_) => return invalid("Invalid post request"),
    };
    if input.request_id.len() < 8
        || input.request_id.len() > 100
        || !input
            .request_id
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || b == b'-' || b == b'_')
    {
        return invalid("Invalid posting request ID");
    }
    // Notifications are money in/out of a cash/bank account, never a card charge.
    let account = query!(
        db,
        "SELECT kind FROM accounts WHERE id=?1 AND owner_id=?2 AND archived_at IS NULL",
        &input.account_id,
        owner
    )?
    .first::<Value>(None)
    .await?;
    if !matches!(
        account.as_ref().and_then(|v| v["kind"].as_str()),
        Some("cash" | "bank")
    ) {
        return invalid("Bank posting requires an active bank/cash account");
    }
    let inbox=match query!(db,
        "SELECT amount_vnd,flow,status,redacted_summary,posted_transaction_id FROM bank_inbox WHERE owner_id=?1 AND id=?2",
        owner,id)?.first::<Value>(None).await?{
        Some(v)=>v,None=>return not_found()
    };
    if inbox["status"] == "posted" {
        if let Some(posted_id) = inbox["posted_transaction_id"].as_str() {
            let old=query!(db,"SELECT request_id FROM transactions WHERE owner_id=?1 AND id=?2 AND deleted_at IS NULL",owner,posted_id)?
               .first::<Value>(None).await?;
            if old.as_ref().and_then(|row| row["request_id"].as_str())
                == Some(input.request_id.as_str())
            {
                return json_ok(&json!({"ok":true,"transaction_id":posted_id,"idempotent":true}));
            }
        }
        return conflict("Bank notification was already posted");
    }
    if inbox["status"] != "pending" {
        return invalid("Notification is no longer pending");
    }
    let amount = inbox["amount_vnd"]
        .as_i64()
        .ok_or(Error::RustError("Invalid bank event amount".into()))?;
    let kind = if inbox["flow"] == "credit" {
        "income"
    } else {
        "expense"
    };
    if let Some(ref category_id) = input.category_id {
        let category = query!(
            db,
            "SELECT kind FROM categories WHERE owner_id=?1 AND id=?2 AND archived_at IS NULL",
            owner,
            category_id
        )?
        .first::<Value>(None)
        .await?;
        let category_kind = category
            .as_ref()
            .and_then(|v| v["kind"].as_str())
            .unwrap_or("");
        if !matches!(category_kind, "both" | "income" | "expense")
            || (category_kind != "both" && category_kind != kind)
        {
            return invalid("Category does not match bank inflow/outflow");
        }
    }
    if let Some(existing) = query!(
        db,
        "SELECT id FROM transactions WHERE owner_id=?1 AND request_id=?2 LIMIT 1",
        owner,
        &input.request_id
    )?
    .first::<Value>(None)
    .await?
    {
        return conflict("request_id already used for another transaction");
    }
    let txid = uid()?;
    // Insert-from-pending with explicit owner scope, then mark posted. Atomic D1 batch.
    let insert=query!(db,
      "INSERT INTO transactions(id,owner_id,request_id,occurred_at,kind,amount_vnd,account_id,category_id,note,source)
       SELECT ?1,?2,?3,COALESCE(occurred_at,substr(received_at,1,10)),?4,?5,?6,?7,'Xác nhận thông báo ngân hàng','bank_notification'
       FROM bank_inbox WHERE id=?8 AND owner_id=?2 AND status='pending'",
      &txid,owner,&input.request_id,kind,amount,&input.account_id,&input.category_id,id)?;
    let mark = query!(
        db,
        "UPDATE bank_inbox SET status='posted',posted_transaction_id=?1
       WHERE id=?2 AND owner_id=?3 AND status='pending'",
        &txid,
        id,
        owner
    )?;
    let audit_id = uid()?;
    let audit=query!(db,
      "INSERT INTO audit_log(id,owner_id,entity_kind,entity_id,action) VALUES(?1,?2,'bank_inbox',?3,'post')",
      &audit_id,owner,id)?;
    db.batch(vec![insert, mark, audit]).await?;
    json_ok(&json!({"ok":true,"transaction_id":txid}))
}

async fn settle_debt(
    req: &mut Request,
    db: &D1Database,
    owner: &str,
    id: &str,
) -> Result<Response> {
    let input: NewSettlement = match req.json().await {
        Ok(v) => v,
        Err(_) => return invalid("Invalid settlement request"),
    };
    let debt = match query!(
        db,
        "SELECT direction,principal_vnd,settled_vnd FROM debts
        WHERE owner_id=?1 AND id=?2 AND archived_at IS NULL",
        owner,
        id
    )?
    .first::<Value>(None)
    .await?
    {
        Some(d) => d,
        None => return not_found(),
    };
    let kind = if debt["direction"] == "receivable" {
        TxKind::DebtCollection
    } else {
        TxKind::DebtPayment
    };
    let tx = NewTransaction {
        request_id: input.request_id,
        occurred_at: input.occurred_at,
        kind,
        amount_vnd: input.amount_vnd,
        account_id: input.account_id,
        other_account_id: None,
        category_id: None,
        counterparty_id: None,
        debt_id: Some(id.into()),
        merchant: String::new(),
        note: String::new(),
    };
    if let Err(e) = tx.validate() {
        return invalid(e);
    }
    let principal = debt["principal_vnd"].as_i64().unwrap_or(0);
    let settled = debt["settled_vnd"].as_i64().unwrap_or(0);
    if let Some(previous) = query!(
        db,
        "SELECT id,kind,amount_vnd,account_id,debt_id,occurred_at
           FROM transactions WHERE owner_id=?1 AND request_id=?2 LIMIT 1",
        owner,
        &tx.request_id
    )?
    .first::<Value>(None)
    .await?
    {
        let same = previous["kind"].as_str() == Some(kind.as_str())
            && previous["amount_vnd"].as_i64() == Some(tx.amount_vnd)
            && previous["account_id"].as_str() == Some(tx.account_id.as_str())
            && previous["debt_id"].as_str() == Some(id)
            && previous["occurred_at"].as_str() == Some(tx.occurred_at.as_str());
        if !same {
            return conflict("request_id already used for another debt settlement");
        }
        return json_ok(&json!({"ok":true,"transaction_id":previous["id"],"idempotent":true}));
    }
    if tx.amount_vnd > principal - settled {
        return invalid("Settlement amount exceeds remaining debt");
    }
    let account = match query!(
        db,
        "SELECT kind FROM accounts WHERE owner_id=?1 AND id=?2 AND archived_at IS NULL",
        owner,
        &tx.account_id
    )?
    .first::<Value>(None)
    .await?
    {
        Some(v) => v,
        None => return invalid("Settlement account not found"),
    };
    if !matches!(account["kind"].as_str(), Some("cash" | "bank")) {
        return invalid("Debt payments require a cash or bank account");
    }
    let txid = uid()?;
    let auditid = uid()?;
    db.batch(vec![
        query!(db,"INSERT INTO transactions(id,owner_id,request_id,occurred_at,kind,amount_vnd,account_id,debt_id)
                  VALUES(?1,?2,?3,?4,?5,?6,?7,?8)",
             &txid,owner,&tx.request_id,&tx.occurred_at,kind.as_str(),tx.amount_vnd,&tx.account_id,id)?,
        query!(db,"INSERT INTO audit_log(id,owner_id,entity_kind,entity_id,action)
                  VALUES(?1,?2,'debt',?3,'settle')",&auditid,owner,id)?
    ]).await?;
    json_ok(&json!({"ok":true,"transaction_id":txid,"idempotent":false}))
}

#[event(fetch)]
pub async fn main(mut req: Request, env: Env, _ctx: Context) -> Result<Response> {
    let path = req.path();
    if !path.starts_with("/api/") {
        return not_found();
    }
    // Both edge Access and this *cryptographic JWT check* must succeed.
    let user = match auth::require_user(&req, &env).await {
        Ok(u) => u,
        Err(_) => return Response::error("Unauthorized - Cloudflare Access required", 401),
    };
    let method = req.method();
    if !matches!(method, Method::Get | Method::Head) {
        let expected = env
            .secret("PUBLIC_ORIGIN")
            .map_err(|_| Error::RustError("Missing PUBLIC_ORIGIN secret".into()))?
            .to_string();
        let origin = req.headers().get("Origin")?;
        if origin.as_deref() != Some(expected.as_str()) {
            return Response::error("Origin not allowed", 403);
        }
    }
    let db = match env.d1("DB") {
        Ok(v) => v,
        Err(_) => return Response::error("D1 binding missing", 503),
    };
    let owner = &user.sub;
    let parts: Vec<_> = path.trim_matches('/').split('/').collect();
    let response = match (method, parts.as_slice()) {
        (Method::Get, ["api", "me"]) => json_ok(&json!({"ok":true,"email":user.email})),
        (Method::Get, ["api", "bootstrap"]) => bootstrap(&db, &user).await,
        (Method::Post, ["api", "accounts"]) => create_account(&mut req, &db, owner).await,
        (Method::Post, ["api", "categories"]) => create_category(&mut req, &db, owner).await,
        (Method::Post, ["api", "counterparties"]) => {
            create_counterparty(&mut req, &db, owner).await
        }
        (Method::Post, ["api", "debts"]) => create_debt(&mut req, &db, owner).await,
        (Method::Post, ["api", "debts", id, "settle"]) => {
            settle_debt(&mut req, &db, owner, id).await
        }
        (Method::Post, ["api", "transactions"]) => create_tx(&mut req, &db, owner).await,
        (Method::Delete, ["api", "transactions", id]) => delete_tx(&db, owner, id).await,
        (Method::Post, ["api", "bank-inbox", "preview"]) => preview_notification(&mut req).await,
        (Method::Post, ["api", "bank-inbox"]) => create_bank_inbox(&mut req, &db, owner).await,
        (Method::Post, ["api", "bank-inbox", id, "ignore"]) => {
            ignore_bank_inbox(&db, owner, id).await
        }
        (Method::Post, ["api", "bank-inbox", id, "post"]) => {
            post_bank_inbox(&mut req, &db, owner, id).await
        }
        _ => not_found(),
    };
    // Do not leak SQL internals, schema or account identifiers to users.
    match response {
        Ok(v) => Ok(v),
        Err(_) => map_db_error(),
    }
}
