"""
质量规则管理 API 路由
"""
from fastapi import APIRouter, Query
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from typing import Optional

from .engine import RuleEngine
from .nl_parser import parse_rule

router = APIRouter()


class CustomRuleRequest(BaseModel):
    """自定义规则请求"""
    session_id: str
    rule_name: str
    rule_type: str
    field_name: str
    dimension: str
    severity: str = "中"
    config: Optional[dict] = None


class ToggleRequest(BaseModel):
    """规则开关请求"""
    enabled: bool


class NaturalLanguageRuleRequest(BaseModel):
    text: str
    fields: list[str] = []
    tables: list[dict] = []


@router.post("/parse")
async def parse_natural_language_rule(body: NaturalLanguageRuleRequest):
    """Convert a natural-language request to a rule draft without saving it."""
    if not body.text.strip():
        return JSONResponse({"status": "error", "message": "请输入规则描述"}, status_code=400)
    if not body.fields:
        return JSONResponse({"status": "error", "message": "请先上传数据，以便识别目标字段"}, status_code=400)
    try:
        return {"status": "ok", "rule": parse_rule(body.text, body.fields, body.tables)}
    except ValueError as exc:
        return JSONResponse({"status": "error", "message": str(exc)}, status_code=400)


# ── 规则列表 ──

@router.get("")
async def get_rules(session_id: Optional[str] = Query(default=None)):
    """获取规则列表（含启用状态和统计）"""
    engine = RuleEngine()
    rules = engine.get_rules(session_id)
    stats = engine.get_stats(session_id)
    engine.close()

    return {
        "status": "ok",
        "rules": rules,
        "stats": stats,
    }


@router.get("/{rule_id}")
async def get_rule(rule_id: str):
    """获取单条规则"""
    engine = RuleEngine()
    rule = engine.get_rule(rule_id)
    engine.close()

    if not rule:
        return JSONResponse({"status": "error", "message": "规则不存在"}, status_code=404)
    return {"status": "ok", "rule": rule}


# ── 规则开关 ──

@router.put("/{rule_id}/toggle")
async def toggle_rule(rule_id: str, body: ToggleRequest):
    """启用/停用规则"""
    engine = RuleEngine()
    ok = engine.toggle_rule(rule_id, body.enabled)
    engine.close()

    if not ok:
        return JSONResponse({"status": "error", "message": "规则不存在"}, status_code=404)
    return {"status": "ok", "rule_id": rule_id, "enabled": body.enabled}


# ── 编辑规则 ──

class UpdateRuleRequest(BaseModel):
    rule_name: str = ""
    rule_type: str = ""
    field_name: str = ""
    dimension: str = ""
    severity: str = "中"
    config: Optional[dict] = None


@router.put("/{rule_id}")
async def update_rule(rule_id: str, data: UpdateRuleRequest):
    """编辑已有规则（支持预置和自定义）"""
    engine = RuleEngine()
    ok = engine.update_rule(rule_id, data.model_dump())
    engine.close()

    if not ok:
        return JSONResponse({"status": "error", "message": "规则不存在"}, status_code=404)
    return {"status": "ok", "rule_id": rule_id, "message": "规则已更新"}


# ── 自定义规则 ──

@router.post("/custom")
async def add_custom_rule(rule: CustomRuleRequest):
    """新增自定义规则"""
    # 校验规则类型
    valid_types = ["not_null", "unique", "regex", "range", "length", "reference_exists"]
    if rule.rule_type not in valid_types:
        return JSONResponse(
            {"status": "error", "message": f"无效的规则类型，支持: {valid_types}"},
            status_code=400,
        )

    if rule.rule_type == "reference_exists":
        config = rule.config or {}
        required_config = ["source_table_key", "target_table_key", "target_field"]
        if any(not config.get(key) for key in required_config):
            return JSONResponse(
                {"status": "error", "message": "跨表关联校验需要选择源表、目标表和目标字段"},
                status_code=400,
            )

    # 校验维度
    valid_dimensions = ["完整性", "准确性", "一致性", "逻辑性"]
    if rule.dimension not in valid_dimensions:
        return JSONResponse(
            {"status": "error", "message": f"无效的维度，支持: {valid_dimensions}"},
            status_code=400,
        )

    engine = RuleEngine()
    result = engine.add_custom_rule(rule.session_id, rule.model_dump())
    engine.close()

    return {"status": "ok", "rule": result}


@router.delete("/{rule_id}")
async def delete_rule(rule_id: str):
    """删除自定义规则"""
    engine = RuleEngine()
    ok = engine.delete_rule(rule_id)
    engine.close()

    if not ok:
        return JSONResponse(
            {"status": "error", "message": "规则不存在或预置规则不可删除"},
            status_code=400,
        )
    return {"status": "ok", "message": "规则已删除"}


# ── 规则类型说明 ──

@router.get("/meta/types")
async def get_rule_types():
    """获取支持的规则类型说明"""
    return {
        "status": "ok",
        "types": [
            {"key": "not_null", "name": "非空校验", "description": "字段值不能为空", "config_fields": []},
            {"key": "unique", "name": "唯一性校验", "description": "字段值在所有记录中不能重复", "config_fields": []},
            {"key": "regex", "name": "正则格式校验", "description": "字段值需匹配正则表达式", "config_fields": [{"name": "pattern", "label": "正则表达式", "example": "^1[3-9]\\d{9}$"}]},
            {"key": "range", "name": "数值范围校验", "description": "数值需在指定范围内", "config_fields": [{"name": "min", "label": "最小值", "example": "0"}, {"name": "max", "label": "最大值", "example": "999999"}]},
            {"key": "length", "name": "长度校验", "description": "字符串长度需在指定范围内", "config_fields": [{"name": "min_len", "label": "最小长度", "example": "1"}, {"name": "max_len", "label": "最大长度", "example": "100"}]},
            {"key": "reference_exists", "name": "跨表关联校验", "description": "源表字段值必须存在于目标表字段中", "config_fields": [{"name": "source_table_key", "label": "源表", "example": "account"}, {"name": "target_table_key", "label": "目标表", "example": "customer"}, {"name": "target_field", "label": "目标字段", "example": "customer_id"}]},
        ],
        "dimensions": ["完整性", "准确性", "一致性", "逻辑性"],
        "severities": ["高", "中", "低"],
    }
