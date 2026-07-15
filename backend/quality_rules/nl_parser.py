"""Lightweight natural-language to quality-rule parser.

It deliberately returns a draft only. The user reviews the parsed rule in the
form before it is persisted.
"""
import re


FIELD_ALIASES = {
    "counterparty_info": ["交易对手", "对手方", "交易对手信息", "counterparty"],
    "phone": ["手机号", "手机号码", "联系电话", "电话"],
    "email": ["邮箱", "电子邮箱", "邮件"],
    "amount": ["金额", "交易金额", "支付金额"],
    "paid_amount": ["实付金额", "支付金额"],
    "customer_id": ["客户编号", "客户id", "客户id号"],
    "id_number": ["身份证号", "证件号码", "证件号"],
    "transaction_date": ["交易日期", "交易时间"],
    "status": ["状态", "订单状态"],
}


def _normalise(value: str) -> str:
    return re.sub(r"[\s_\-]", "", value.lower())


def _find_field(text: str, fields: list[str]) -> str | None:
    text_normalised = _normalise(text)
    # Prefer an actual uploaded field name when it appears in the request.
    for field in sorted(fields, key=len, reverse=True):
        if _normalise(field) in text_normalised:
            return field

    # Map common Chinese business terms to the uploaded field names.
    for field in fields:
        aliases = FIELD_ALIASES.get(field.lower(), [])
        if any(_normalise(alias) in text_normalised for alias in aliases):
            return field
    return None


def _first_number(text: str) -> float | None:
    match = re.search(r"-?\d+(?:\.\d+)?", text)
    return float(match.group()) if match else None


def _find_table(table_ref: str, tables: list[dict]) -> dict | None:
    normalised_ref = _normalise(table_ref)
    for table in tables:
        if normalised_ref in {_normalise(str(table.get("key", ""))), _normalise(str(table.get("name", "")))}:
            return table
    return None


def _parse_reference_rule(text: str, tables: list[dict]) -> dict | None:
    """Recognise expressions such as 账户表.customer_id 必须存在于 客户表.customer_id."""
    match = re.search(
        r"(?P<source_table>[^\s.．]+)[.．](?P<source_field>[A-Za-z_][\w]*)\s*(?:必须)?(?:存在于|在)\s*(?P<target_table>[^\s.．]+)[.．](?P<target_field>[A-Za-z_][\w]*)",
        text,
    )
    if not match:
        return None
    source_table = _find_table(match.group("source_table"), tables)
    target_table = _find_table(match.group("target_table"), tables)
    source_field = match.group("source_field")
    target_field = match.group("target_field")
    if not source_table or not target_table:
        raise ValueError("未能识别源表或目标表，请使用上传表的名称")
    if source_field not in source_table.get("headers", []):
        raise ValueError(f"源表中不存在字段 '{source_field}'")
    if target_field not in target_table.get("headers", []):
        raise ValueError(f"目标表中不存在字段 '{target_field}'")
    return {
        "rule_name": text,
        "rule_type": "reference_exists",
        "field_name": source_field,
        "dimension": "一致性",
        "severity": "高",
        "config": {
            "source_table_key": source_table["key"],
            "target_table_key": target_table["key"],
            "target_field": target_field,
        },
        "explanation": f"已识别跨表关联：{source_table['name']}.{source_field} 必须存在于 {target_table['name']}.{target_field}。",
    }


def parse_rule(text: str, fields: list[str], tables: list[dict] | None = None) -> dict:
    """Parse common Chinese data-quality expressions into a rule draft."""
    text = text.strip()
    if tables and re.search(r"(存在于|关联)", text):
        reference_rule = _parse_reference_rule(text, tables)
        if reference_rule:
            return reference_rule
    field = _find_field(text, fields)
    if not field:
        raise ValueError("未能识别目标字段，请使用上传数据中的字段名或常见业务名称")

    rule_type = None
    config = None
    dimension = "完整性"

    if re.search(r"(不能为空|不可为空|不得为空|不能为?空|不为?空|不允许为空|非空|必填)", text):
        rule_type = "not_null"
        dimension = "完整性"
    elif re.search(r"(不能重复|不可重复|唯一|去重)", text):
        rule_type = "unique"
        dimension = "一致性"
    elif re.search(r"(手机号|手机号码).*(11位|十一位|格式)", text):
        rule_type = "regex"
        config = {"pattern": r"^1[3-9]\d{9}$"}
        dimension = "准确性"
    elif re.search(r"(邮箱|电子邮箱).*(格式|有效|正确)", text):
        rule_type = "regex"
        config = {"pattern": r"^[^@]+@[^@]+\.[^@]+$"}
        dimension = "准确性"
    elif re.search(r"(长度|位数|\d+位)", text):
        number = _first_number(text)
        if number is None:
            raise ValueError("请在长度规则中说明具体长度，例如“身份证号长度为18位”")
        rule_type = "length"
        config = {"min_len": int(number), "max_len": int(number)}
        dimension = "准确性"
    elif re.search(r"(大于|小于|不少于|不低于|不超过|至多|范围|介于|>=|<=|>|<)", text):
        number = _first_number(text)
        if number is None:
            raise ValueError("请在范围规则中提供数值，例如“交易金额必须大于0”")
        rule_type = "range"
        config = {}
        if re.search(r"(不少于|不低于|>=)", text):
            config["min"] = number
        elif re.search(r"(大于|>)", text):
            config.update({"min": number, "min_exclusive": True})
        elif re.search(r"(不超过|至多|<=)", text):
            config["max"] = number
        elif re.search(r"(小于|<)", text):
            config.update({"max": number, "max_exclusive": True})
        else:
            config["max"] = number
        dimension = "准确性"
    else:
        raise ValueError("暂未识别规则类型。可尝试：不能为空、不能重复、必须大于0、长度为18位")

    severity = "高" if any(term in text for term in ["身份证", "手机号", "金额", "交易", "必须"]) else "中"
    return {
        "rule_name": text,
        "rule_type": rule_type,
        "field_name": field,
        "dimension": dimension,
        "severity": severity,
        "config": config,
        "explanation": f"已识别字段“{field}”和{rule_type}规则，请确认后保存。",
    }
