//! Finance Manager v2: business/UI actions implemented in Rust/WASM.
//! HTML/CSS are assets, JS is only wasm-bindgen bootstrap glue.
#![forbid(unsafe_code)]
use js_sys::Date;
use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use std::{cell::RefCell, fmt::Write as _};
use wasm_bindgen::{closure::Closure, prelude::*, JsCast};
use wasm_bindgen_futures::{spawn_local, JsFuture};
use web_sys::{
    Document, Element, Event, HtmlInputElement, HtmlSelectElement, HtmlTextAreaElement, Request,
    RequestInit, Response,
};

thread_local! {
    static MODEL: RefCell<Value> = RefCell::new(json!({}));
    static TAB: RefCell<String> = RefCell::new("cash".into());
    static STATUS: RefCell<String> = RefCell::new("Đang tải dữ liệu từ Cloudflare D1…".into());
}

fn document() -> Document {
    web_sys::window()
        .expect("browser window")
        .document()
        .expect("document")
}
fn esc(text: &str) -> String {
    text.replace('&', "&amp;")
        .replace('<', "&lt;")
        .replace('>', "&gt;")
        .replace('"', "&quot;")
        .replace('\'', "&#39;")
}
fn str_field<'a>(v: &'a Value, key: &str) -> &'a str {
    v.get(key).and_then(Value::as_str).unwrap_or("")
}
fn int_field(v: &Value, key: &str) -> i64 {
    v.get(key).and_then(Value::as_i64).unwrap_or(0)
}
fn arr<'a>(v: &'a Value, key: &str) -> &'a [Value] {
    v.get(key)
        .and_then(Value::as_array)
        .map(Vec::as_slice)
        .unwrap_or(&[])
}
fn vnd(x: i64) -> String {
    let digits = x.unsigned_abs().to_string();
    let mut out = String::new();
    for (i, c) in digits.chars().enumerate() {
        if i > 0 && (digits.len() - i) % 3 == 0 {
            out.push('.');
        }
        out.push(c);
    }
    format!("{}{} đ", if x < 0 { "−" } else { "" }, out)
}
fn status(text: &str) {
    STATUS.with(|s| *s.borrow_mut() = text.into());
}
fn option_list(v: &[Value], selected: &str, label_key: &str) -> String {
    let mut result = "<option value=\"\">-- Chọn --</option>".to_owned();
    for item in v {
        let id = str_field(item, "id");
        let label = str_field(item, label_key);
        let selection = if id == selected { " selected" } else { "" };
        write!(
            &mut result,
            "<option value=\"{}\"{}>{}</option>",
            esc(id),
            selection,
            esc(label)
        )
        .ok();
    }
    result
}
fn row_list(model: &Value) -> String {
    let mut out = String::new();
    for tx in arr(model, "transactions") {
        let kind = str_field(tx, "kind");
        let inbound = matches!(kind, "income" | "debt_collection");
        let label = match kind {
            "income" => "Thu",
            "expense" => "Chi",
            "transfer" => "Chuyển khoản",
            "card_charge" => "Chi thẻ",
            "card_payment" => "Thanh toán thẻ",
            "debt_collection" => "Thu nợ",
            "debt_payment" => "Trả nợ",
            _ => "Giao dịch",
        };
        let id = esc(str_field(tx, "id"));
        let note = esc(str_field(tx, "merchant"));
        let sign = if inbound { "+" } else { "−" };
        write!(&mut out,"<div class=\"fm-row\"><div><strong>{} · {}</strong><br><small>{} {}</small></div><div class=\"text-end\"><strong class=\"fm-amount {}\">{}{}</strong><br><button class=\"btn btn-link text-danger btn-sm p-0\" data-action=\"delete-tx\" data-id=\"{}\">Xóa</button></div></div>",
            esc(str_field(tx,"occurred_at")),label,note,esc(str_field(tx,"note")),
            if inbound{"in"}else{"out"},sign,vnd(int_field(tx,"amount_vnd")),id).ok();
    }
    if out.is_empty() {
        out.push_str("<p class=\"fm-muted mb-0\">Chưa có giao dịch.</p>");
    }
    out
}
fn cash_tab(model: &Value) -> String {
    let accounts = arr(model, "accounts");
    let categories = arr(model, "categories");
    let balances = arr(model, "balances");
    let mut balance_list = String::new();
    for a in balances {
        write!(&mut balance_list,"<div class=\"fm-row\"><div><strong>{}</strong><br><small>{}</small></div><strong>{}</strong></div>",
            esc(str_field(a,"name")),esc(str_field(a,"kind")),vnd(int_field(a,"balance_vnd"))).ok();
    }
    format!(
        r#"
        <div class="fm-kpis">
          <div class="fm-kpi green"><div class="label">TỔNG THU</div><div class="number">{}</div></div>
          <div class="fm-kpi orange"><div class="label">TỔNG CHI</div><div class="number">{}</div></div>
        </div>
        <section class="fm-panel"><h6>Tiền mặt & ngân hàng</h6>{}</section>
        <section class="fm-panel"><h6>Nhập giao dịch thu / chi</h6>
          <div class="fm-inputs">
            <div class="fm-2"><div><label>Loại</label><select class="form-select" id="tx-kind"><option value="expense">Chi</option><option value="income">Thu</option><option value="transfer">Chuyển khoản</option></select></div>
            <div><label>Số tiền (VND)</label><input class="form-control" id="tx-amount" inputmode="numeric" type="number" min="1" step="1" placeholder="100000"></div></div>
            <div class="fm-2"><div><label>Từ tài khoản</label><select class="form-select" id="tx-account">{}</select></div>
            <div><label>Đến tài khoản (nếu chuyển)</label><select class="form-select" id="tx-other-account">{}</select></div></div>
            <div><label>Danh mục</label><select class="form-select" id="tx-category">{}</select></div>
            <div class="fm-2"><div><label>Ngày</label><input class="form-control" type="date" id="tx-date" value="{}"></div>
            <div><label>Đối tác / Merchant</label><input class="form-control" id="tx-merchant" placeholder="Tên giao dịch"></div></div>
            <div><label>Ghi chú</label><input class="form-control" id="tx-note" placeholder="Nội dung"></div>
            <button class="btn btn-success w-100 fw-bold" data-action="save-tx">Lưu vào D1</button>
          </div></section>
        <section class="fm-panel"><h6>Lịch sử giao dịch</h6>{}</section>
        <section class="fm-panel"><h6>Tạo tài khoản / danh mục</h6>
          <div class="fm-inputs">
            <div class="fm-2"><input class="form-control" id="new-account-name" placeholder="Tên tài khoản"><select class="form-select" id="new-account-kind"><option value="bank">Ngân hàng</option><option value="cash">Tiền mặt</option><option value="credit_card">Thẻ tín dụng</option></select></div>
            <button class="btn btn-outline-primary btn-sm" data-action="new-account">Thêm tài khoản</button>
            <div class="fm-2"><input class="form-control" id="new-category-name" placeholder="Tên danh mục"><select class="form-select" id="new-category-kind"><option value="expense">Chi</option><option value="income">Thu</option><option value="both">Cả hai</option></select></div>
            <button class="btn btn-outline-primary btn-sm" data-action="new-category">Thêm danh mục</button>
          </div></section>
        "#,
        vnd(int_field(&model["totals"], "income_vnd")),
        vnd(int_field(&model["totals"], "expense_vnd")),
        balance_list,
        option_list(accounts, "", "name"),
        option_list(accounts, "", "name"),
        option_list(categories, "", "name"),
        today(),
        row_list(model)
    )
}
fn cards_tab(model: &Value) -> String {
    let cards: Vec<_> = arr(model, "accounts")
        .iter()
        .filter(|a| str_field(a, "kind") == "credit_card")
        .cloned()
        .collect();
    let charge = int_field(&model["totals"], "card_charge_vnd");
    let paid = int_field(&model["totals"], "card_payment_vnd");
    let mut list = String::new();
    for a in &cards {
        write!(&mut list,"<div class=\"fm-row\"><div><strong>{}</strong><br><small>Thẻ tín dụng</small></div><strong>{}</strong></div>",
            esc(str_field(a,"name")),
            vnd(-arr(model,"balances").iter().find(|row|str_field(row,"id")==str_field(a,"id"))
              .map(|row|int_field(row,"balance_vnd")).unwrap_or(0))).ok();
    }
    format!(
        r#"<div class="fm-kpis">
         <div class="fm-kpi orange"><div class="label">CHI TIÊU THẺ</div><div class="number">{}</div></div>
         <div class="fm-kpi green"><div class="label">ĐÃ THANH TOÁN</div><div class="number">{}</div></div>
         </div>
         <section class="fm-panel"><h6>Thẻ tín dụng</h6>{}</section>
         <section class="fm-panel"><h6>Giao dịch thẻ</h6>
          <div class="fm-inputs">
            <div class="fm-2"><div><label>Loại</label><select class="form-select" id="card-kind"><option value="card_charge">Chi tiêu</option><option value="card_payment">Thanh toán thẻ</option></select></div>
            <div><label>Số tiền VND</label><input class="form-control" type="number" id="card-amount" min="1"></div></div>
            <div><label>Thẻ</label><select class="form-select" id="card-account">{}</select></div>
            <div><label>Nguồn tiền thanh toán</label><select class="form-select" id="card-from">{}</select></div>
            <div><label>Ngày</label><input class="form-control" id="card-date" type="date" value="{}"></div>
            <div><label>Nơi chi / Ghi chú</label><input class="form-control" id="card-merchant"></div>
            <button class="btn btn-primary fw-bold" data-action="save-card">Lưu giao dịch thẻ</button>
          </div></section>
         "#,
        vnd(charge),
        vnd(paid),
        if list.is_empty() {
            "<p class=\"fm-muted\">Chưa có thẻ, hãy thêm tại tab Dòng tiền.</p>".into()
        } else {
            list
        },
        option_list(&cards, "", "name"),
        option_list(arr(model, "accounts"), "", "name"),
        today()
    )
}
fn debts_tab(model: &Value) -> String {
    let mut debts = String::new();
    for d in arr(model, "debts") {
        let principal = int_field(d, "principal_vnd");
        let settled = int_field(d, "settled_vnd");
        write!(&mut debts,"<div class=\"fm-row\"><div><strong>{}</strong><br><small>{} · {} · đến hạn {}</small></div><div class=\"text-end\"><strong class=\"fm-danger\">{}</strong><br><small>Gốc {}</small></div></div>",
            esc(str_field(d,"title")),esc(str_field(d,"counterparty_name")),
            if str_field(d,"direction")=="receivable"{"Phải thu"}else{"Phải trả"},
            esc(str_field(d,"due_date")),vnd(principal-settled),vnd(principal)).ok();
    }
    let people = option_list(arr(model, "counterparties"), "", "name");
    format!(
        r#"<section class="fm-panel"><h6>Công nợ phải thu / phải trả</h6>{}</section>
       <section class="fm-panel"><h6>Tạo khoản nợ mới</h6>
       <div class="fm-inputs">
         <div class="fm-2"><input class="form-control" id="new-person" placeholder="Tên đối tác">
          <button class="btn btn-outline-primary" data-action="new-person">Thêm đối tác</button></div>
         <div><label>Đối tác</label><select class="form-select" id="debt-person">{}</select></div>
         <div class="fm-2"><div><label>Loại</label><select class="form-select" id="debt-direction"><option value="receivable">Phải thu</option><option value="payable">Phải trả</option></select></div>
         <div><label>Gốc nợ (VND)</label><input class="form-control" id="debt-amount" type="number" min="1"></div></div>
         <div><label>Diễn giải</label><input class="form-control" id="debt-title"></div>
         <div><label>Ngày đến hạn</label><input class="form-control" id="debt-due" type="date"></div>
         <button class="btn btn-primary" data-action="new-debt">Lưu khoản nợ</button>
       </div></section>"#,
        if debts.is_empty() {
            "<p class=\"fm-muted\">Chưa có công nợ.</p>".into()
        } else {
            debts
        },
        people
    )
}
fn bank_tab(model: &Value) -> String {
    let mut list = String::new();
    for item in arr(model, "bank_inbox") {
        let id = esc(str_field(item, "id"));
        write!(&mut list,
           "<div class=\"fm-row\"><div><strong>{}</strong><br><small>{}</small></div><div class=\"text-end\"><strong>{}</strong><br><button class=\"fm-action bg-secondary-subtle\" data-action=\"ignore-bank\" data-id=\"{}\">Bỏ qua</button></div></div>",
           esc(str_field(item,"redacted_summary")),esc(str_field(item,"source_package")),
           vnd(int_field(item,"amount_vnd")),id).ok();
    }
    format!(
        r#"<section class="fm-panel"><h6>Thông báo ngân hàng chờ đối soát</h6>
      <p class="fm-muted">Không tự ghi nợ hoặc tự hạch toán khi chưa xác định chính xác đối tác và nội dung.</p>{}</section>
      <section class="fm-panel"><h6>Thử trích xuất thông báo (thủ công)</h6>
        <div class="fm-inputs"><textarea id="bank-text" class="form-control" rows="3" placeholder="Ví dụ: TK ghi có, Số tiền: 1.250.000 VND…"></textarea>
          <button class="btn btn-outline-primary" data-action="preview-bank">Phân tích</button>
          <div id="bank-preview" class="fm-muted"></div>
        </div>
      </section>"#,
        if list.is_empty() {
            "<p class=\"fm-muted\">Chưa có thông báo đang chờ.</p>".into()
        } else {
            list
        }
    )
}
fn today() -> String {
    Date::new_0()
        .to_iso_string()
        .as_string()
        .unwrap_or_default()
        .chars()
        .take(10)
        .collect()
}
fn render() {
    let model = MODEL.with(|m| m.borrow().clone());
    let tab = TAB.with(|t| t.borrow().clone());
    let view = match tab.as_str() {
        "cards" => cards_tab(&model),
        "debts" => debts_tab(&model),
        "bank" => bank_tab(&model),
        _ => cash_tab(&model),
    };
    let btn = |name: &str, label: &str| -> String {
        format!(
            "<button data-action=\"tab\" data-tab=\"{}\" class=\"{}\">{}</button>",
            name,
            if tab == name { "active" } else { "" },
            label
        )
    };
    let user = esc(str_field(&model["user"], "email"));
    let status = STATUS.with(|s| esc(&s.borrow()));
    let markup = format!(
        r#"<div class="fm-shell p-3 p-md-4">
      <div class="d-flex justify-content-between align-items-center mb-1">
        <div class="fm-brand text-primary"><i class="bi bi-wallet2"></i> QUẢN LÝ CHI TIÊU</div>
        <span class="fm-badge">RUST + D1</span>
      </div>
      <div class="fm-muted mb-3">Cloudflare Access: {} · Dữ liệu riêng tư</div>
      <div class="fm-nav mb-3">{}{}{}{}</div>
      <div class="fm-status mb-2" role="status">{}</div>
      {}
      <div class="d-flex justify-content-between align-items-center mt-3">
         <span class="fm-muted">Không sử dụng Google Sheets · API Rust/WASM</span>
         <button class="btn btn-outline-secondary btn-sm" data-action="refresh">Làm mới</button>
      </div></div>"#,
        user,
        btn("cash", "DÒNG TIỀN"),
        btn("cards", "THẺ"),
        btn("debts", "CÔNG NỢ"),
        btn("bank", "NGÂN HÀNG"),
        status,
        view
    );
    if let Some(root) = document().get_element_by_id("app") {
        root.set_inner_html(&markup);
    }
}
async fn request(path: &str, post: Option<Value>, method: &str) -> Result<Value, String> {
    let window = web_sys::window().ok_or("Window unavailable")?;
    let init = RequestInit::new();
    init.set_method(method);
    init.set_credentials(web_sys::RequestCredentials::SameOrigin);
    if let Some(body) = post {
        init.set_body(&JsValue::from_str(&body.to_string()));
    }
    let req =
        Request::new_with_str_and_init(path, &init).map_err(|_| "Cannot create HTTP request")?;
    req.headers()
        .set("Content-Type", "application/json")
        .map_err(|_| "Cannot set headers")?;
    let raw = JsFuture::from(window.fetch_with_request(&req))
        .await
        .map_err(|_| "Network unavailable")?;
    let response: Response = raw.dyn_into().map_err(|_| "Invalid HTTP response")?;
    let text = JsFuture::from(response.text().map_err(|_| "Cannot decode response")?)
        .await
        .map_err(|_| "Cannot read response body")?
        .as_string()
        .unwrap_or_default();
    let value: Value = serde_json::from_str(&text).unwrap_or(json!({"error":text}));
    if !response.ok() || value.get("ok") == Some(&Value::Bool(false)) {
        return Err(format!(
            "HTTP {}: {}",
            response.status(),
            str_field(&value, "error")
        ));
    }
    Ok(value)
}
async fn refresh() {
    status("Đang đồng bộ Cloudflare D1…");
    render();
    match request("/api/bootstrap", None, "GET").await {
        Ok(v) => {
            MODEL.with(|m| *m.borrow_mut() = v);
            status("Dữ liệu mới nhất từ D1 · Đã đồng bộ");
        }
        Err(e) => status(&format!("Không tải được: {}", e)),
    }
    render();
}
fn value(id: &str) -> String {
    document()
        .get_element_by_id(id)
        .and_then(|node| {
            if let Some(v) = node.dyn_ref::<HtmlInputElement>() {
                Some(v.value())
            } else if let Some(v) = node.dyn_ref::<HtmlSelectElement>() {
                Some(v.value())
            } else {
                node.dyn_ref::<HtmlTextAreaElement>().map(|v| v.value())
            }
        })
        .unwrap_or_default()
}
fn uuid() -> String {
    web_sys::window()
        .and_then(|w| w.crypto().ok())
        .map(|c| c.random_uuid())
        .unwrap_or_else(|| format!("req-{}", Date::now()))
}
fn date_or_today(input: &str) -> String {
    let v = value(input);
    if v.is_empty() {
        today()
    } else {
        v
    }
}
fn amount(input: &str) -> Result<i64, String> {
    let n = value(input)
        .parse::<i64>()
        .map_err(|_| "Số tiền phải là số nguyên VND")?;
    if n <= 0 || n > finance_core::MAX_AMOUNT_VND {
        Err("Số tiền không hợp lệ".into())
    } else {
        Ok(n)
    }
}
async fn execute(action: String, id: String) {
    if action == "refresh" {
        refresh().await;
        return;
    }
    let operation: Result<(&'static str, Option<Value>, String), String> = (|| match action.as_str()
    {
        "save-tx" => {
            let kind = value("tx-kind");
            if value("tx-account").is_empty() {
                return Err("Chọn tài khoản".into());
            }
            Ok((
                "/api/transactions",
                Some(json!({
                   "request_id":uuid(),"occurred_at":date_or_today("tx-date"),
                   "kind":kind,"amount_vnd":amount("tx-amount")?,
                   "account_id":value("tx-account"),
                   "other_account_id":if kind=="transfer" && !value("tx-other-account").is_empty(){Some(value("tx-other-account"))}else{None},
                   "category_id":if value("tx-category").is_empty(){None}else{Some(value("tx-category"))},
                   "merchant":value("tx-merchant"),"note":value("tx-note")
                })),
                "POST".into(),
            ))
        }
        "save-card" => {
            let kind = value("card-kind");
            Ok((
                "/api/transactions",
                Some(json!({
                   "request_id":uuid(),"occurred_at":date_or_today("card-date"),
                   "kind":kind,"amount_vnd":amount("card-amount")?,
                   "account_id":if kind=="card_payment"{value("card-from")}else{value("card-account")},
                   "other_account_id":if kind=="card_payment"{Some(value("card-account"))}else{None},
                   "merchant":value("card-merchant")
                })),
                "POST".into(),
            ))
        }
        "new-account" => Ok((
            "/api/accounts",
            Some(json!({"name":value("new-account-name"),
                "kind":value("new-account-kind"),"opening_balance_vnd":0})),
            "POST".into(),
        )),
        "new-category" => Ok((
            "/api/categories",
            Some(json!({"name":value("new-category-name"),
                "kind":value("new-category-kind")})),
            "POST".into(),
        )),
        "new-person" => Ok((
            "/api/counterparties",
            Some(json!({"name":value("new-person")})),
            "POST".into(),
        )),
        "new-debt" => Ok((
            "/api/debts",
            Some(json!({
                "counterparty_id":value("debt-person"),"direction":value("debt-direction"),
                "title":value("debt-title"),"principal_vnd":amount("debt-amount")?,
                "due_date":if value("debt-due").is_empty(){None}else{Some(value("debt-due"))}
            })),
            "POST".into(),
        )),
        "preview-bank" => Ok((
            "/api/bank-inbox/preview",
            Some(json!({"text":value("bank-text")})),
            "POST".into(),
        )),
        "delete-tx" => Ok(("", None, "DELETE".into())),
        "ignore-bank" => Ok(("", None, "POST".into())),
        _ => Err("Hành động chưa hỗ trợ".into()),
    })();
    let (path, body, method) = match operation {
        Ok(v) => v,
        Err(e) => {
            status(&e);
            render();
            return;
        }
    };
    let path = if action == "delete-tx" {
        format!("/api/transactions/{id}")
    } else if action == "ignore-bank" {
        format!("/api/bank-inbox/{id}/ignore")
    } else {
        path.to_string()
    };
    if action == "delete-tx"
        && !web_sys::window()
            .map(|w| {
                w.confirm_with_message("Xóa giao dịch khỏi sổ D1?")
                    .unwrap_or(false)
            })
            .unwrap_or(false)
    {
        return;
    }
    status("Đang cập nhật…"); // Preserve input form until server confirms.
    match request(&path, body, &method).await {
        Ok(result) if action == "preview-bank" => {
            let candidate = &result["candidate"];
            let t = format!(
                "{} · {} · Chưa hạch toán",
                vnd(int_field(candidate, "amount_vnd")),
                esc(str_field(candidate, "flow"))
            );
            if let Some(el) = document().get_element_by_id("bank-preview") {
                el.set_text_content(Some(&t));
            }
            status("Đã nhận dạng. Phê duyệt và nhập thủ công để tránh phát sinh nợ sai.");
        }
        Ok(_) => {
            refresh().await;
        }
        Err(e) => {
            status(&format!("Lỗi: {e}"));
            render();
        }
    }
}
#[wasm_bindgen(start)]
pub fn start() -> Result<(), JsValue> {
    render();
    let handler = Closure::<dyn FnMut(Event)>::new(move |event: Event| {
        let element = event.target().and_then(|v| v.dyn_into::<Element>().ok());
        let node = element.and_then(|v| v.closest("[data-action]").ok().flatten());
        if let Some(node) = node {
            let action = node.get_attribute("data-action").unwrap_or_default();
            let id = node.get_attribute("data-id").unwrap_or_default();
            if action == "tab" {
                let tab = node.get_attribute("data-tab").unwrap_or_default();
                TAB.with(|t| *t.borrow_mut() = tab);
                render();
            } else {
                spawn_local(execute(action, id));
            }
        }
    });
    document().add_event_listener_with_callback("click", handler.as_ref().unchecked_ref())?;
    handler.forget();
    spawn_local(refresh());
    Ok(())
}
