"""
质量规则管理引擎
- 预置规则库（20+ 条）
- 规则 CRUD
- 规则启用/停用
"""
import json
import uuid

from backend.database import get_connection

# ── 预置规则库 ─────────────────────────────────

DEFAULT_RULES = [
    # ═══ 完整性（Completeness）═══
    {
        "rule_id": "R001",
        "rule_name": "姓名字段不可为空",
        "rule_type": "not_null",
        "field_name": "姓名",
        "config": None,
        "dimension": "完整性",
        "severity": "高",
    },
    {
        "rule_id": "R002",
        "rule_name": "手机号字段不可为空",
        "rule_type": "not_null",
        "field_name": "手机号",
        "config": None,
        "dimension": "完整性",
        "severity": "高",
    },
    {
        "rule_id": "R003",
        "rule_name": "邮箱字段不可为空",
        "rule_type": "not_null",
        "field_name": "邮箱",
        "config": None,
        "dimension": "完整性",
        "severity": "中",
    },
    {
        "rule_id": "R004",
        "rule_name": "身份证号不可为空",
        "rule_type": "not_null",
        "field_name": "身份证号",
        "config": None,
        "dimension": "完整性",
        "severity": "高",
    },
    {
        "rule_id": "R005",
        "rule_name": "地址字段不可为空",
        "rule_type": "not_null",
        "field_name": "地址",
        "config": None,
        "dimension": "完整性",
        "severity": "低",
    },
    {
        "rule_id": "R006",
        "rule_name": "关键编号字段不可为空",
        "rule_type": "not_null",
        "field_name": "客户编号",
        "config": None,
        "dimension": "完整性",
        "severity": "高",
    },
    # ═══ 准确性（Accuracy）═══
    {
        "rule_id": "R007",
        "rule_name": "手机号必须为11位数字",
        "rule_type": "regex",
        "field_name": "手机号",
        "config": json.dumps({"pattern": "^1[3-9]\\d{9}$"}),
        "dimension": "准确性",
        "severity": "高",
    },
    {
        "rule_id": "R008",
        "rule_name": "邮箱必须包含@符号",
        "rule_type": "regex",
        "field_name": "邮箱",
        "config": json.dumps({"pattern": "^[^@]+@[^@]+\\.[^@]+$"}),
        "dimension": "准确性",
        "severity": "中",
    },
    {
        "rule_id": "R009",
        "rule_name": "身份证号需为18位",
        "rule_type": "length",
        "field_name": "身份证号",
        "config": json.dumps({"min_len": 18, "max_len": 18}),
        "dimension": "准确性",
        "severity": "高",
    },
    {
        "rule_id": "R010",
        "rule_name": "交易金额必须大于0",
        "rule_type": "range",
        "field_name": "金额",
        "config": json.dumps({"min": 0, "min_exclusive": True}),
        "dimension": "准确性",
        "severity": "高",
    },
    {
        "rule_id": "R011",
        "rule_name": "日期格式需为YYYY-MM-DD",
        "rule_type": "regex",
        "field_name": "日期",
        "config": json.dumps({"pattern": "^\\d{4}-\\d{2}-\\d{2}$"}),
        "dimension": "准确性",
        "severity": "中",
    },
    # ═══ 一致性（Consistency）═══
    {
        "rule_id": "R012",
        "rule_name": "身份证号不可重复",
        "rule_type": "unique",
        "field_name": "身份证号",
        "config": None,
        "dimension": "一致性",
        "severity": "高",
    },
    {
        "rule_id": "R013",
        "rule_name": "手机号不可重复",
        "rule_type": "unique",
        "field_name": "手机号",
        "config": None,
        "dimension": "一致性",
        "severity": "中",
    },
    {
        "rule_id": "R014",
        "rule_name": "邮箱不可重复",
        "rule_type": "unique",
        "field_name": "邮箱",
        "config": None,
        "dimension": "一致性",
        "severity": "低",
    },
    {
        "rule_id": "R015",
        "rule_name": "客户编号不可重复",
        "rule_type": "unique",
        "field_name": "客户编号",
        "config": None,
        "dimension": "一致性",
        "severity": "高",
    },
    # ═══ 逻辑性（Logical）═══
    {
        "rule_id": "R016",
        "rule_name": "出生日期不应在未来",
        "rule_type": "range",
        "field_name": "出生日期",
        "config": None,
        "dimension": "逻辑性",
        "severity": "中",
    },
    {
        "rule_id": "R017",
        "rule_name": "销户日期不应早于开户日期",
        "rule_type": "range",
        "field_name": "销户日期",
        "config": None,
        "dimension": "逻辑性",
        "severity": "中",
    },
    {
        "rule_id": "R018",
        "rule_name": "实付金额不应大于订单金额",
        "rule_type": "range",
        "field_name": "实付金额",
        "config": None,
        "dimension": "逻辑性",
        "severity": "中",
    },
    {
        "rule_id": "R019",
        "rule_name": "风险等级应在有效范围内",
        "rule_type": "regex",
        "field_name": "风险等级",
        "config": json.dumps({"pattern": "^(低|中|高)$"}),
        "dimension": "逻辑性",
        "severity": "低",
    },
    {
        "rule_id": "R020",
        "rule_name": "订单状态应在有效范围内",
        "rule_type": "regex",
        "field_name": "订单状态",
        "config": json.dumps({"pattern": "^(待付款|已付款|已发货|已完成|已取消|退款中|已退款)$"}),
        "dimension": "逻辑性",
        "severity": "低",
    },
]

# ── 规则引擎 ──────────────────────────────────

class RuleEngine:
    """质量规则管理引擎"""

    def __init__(self):
        self.conn = get_connection()

    # ── 种子数据 ──

    def seed_default_rules(self):
        """预置规则写入数据库（仅首次）"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT COUNT(*) AS cnt FROM quality_rule WHERE is_default = 1")
        if cursor.fetchone()["cnt"] > 0:
            return  # 已存在，跳过

        for rule in DEFAULT_RULES:
            cursor.execute("""
                INSERT OR IGNORE INTO quality_rule
                    (rule_id, session_id, rule_name, rule_type, field_name,
                     config, dimension, severity, enabled, is_default)
                VALUES (?, NULL, ?, ?, ?, ?, ?, ?, 1, 1)
            """, (
                rule["rule_id"],
                rule["rule_name"],
                rule["rule_type"],
                rule["field_name"],
                rule["config"],
                rule["dimension"],
                rule["severity"],
            ))

        self.conn.commit()
        print(f"[OK] 预置 {len(DEFAULT_RULES)} 条质量规则已写入")

    # ── 查询 ──

    def get_rules(self, session_id: str | None = None) -> list[dict]:
        """获取规则列表（全局 + session 自定义）"""
        self.seed_default_rules()

        cursor = self.conn.cursor()
        # 全局规则 + 指定 session 的自定义规则
        if session_id:
            cursor.execute("""
                SELECT * FROM quality_rule
                WHERE session_id IS NULL OR session_id = ?
                ORDER BY
                    CASE severity WHEN '高' THEN 1 WHEN '中' THEN 2 ELSE 3 END,
                    dimension, rule_id
            """, (session_id,))
        else:
            cursor.execute("""
                SELECT * FROM quality_rule WHERE session_id IS NULL
                ORDER BY
                    CASE severity WHEN '高' THEN 1 WHEN '中' THEN 2 ELSE 3 END,
                    dimension, rule_id
            """)

        rows = cursor.fetchall()
        rules = []
        for r in rows:
            rule = dict(r)
            rule["config"] = json.loads(rule["config"]) if rule["config"] else None
            rules.append(rule)

        return rules

    def get_rule(self, rule_id: str) -> dict | None:
        """获取单条规则"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM quality_rule WHERE rule_id = ?", (rule_id,))
        row = cursor.fetchone()
        if not row:
            return None
        rule = dict(row)
        rule["config"] = json.loads(rule["config"]) if rule["config"] else None
        return rule

    # ── 规则开关 ──

    def toggle_rule(self, rule_id: str, enabled: bool) -> bool:
        """启用/停用规则"""
        cursor = self.conn.cursor()
        cursor.execute(
            "UPDATE quality_rule SET enabled = ? WHERE rule_id = ?",
            (1 if enabled else 0, rule_id),
        )
        self.conn.commit()
        return cursor.rowcount > 0

    # ── 自定义规则 ──

    def add_custom_rule(self, session_id: str, rule: dict) -> dict:
        """新增自定义规则"""
        cursor = self.conn.cursor()

        rule_id = f"C{str(uuid.uuid4())[:6].upper()}"
        config = json.dumps(rule.get("config"), ensure_ascii=False) if rule.get("config") else None

        cursor.execute("""
            INSERT INTO quality_rule
                (rule_id, session_id, rule_name, rule_type, field_name,
                 config, dimension, severity, enabled, is_default)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 0)
        """, (
            rule_id,
            session_id,
            rule["rule_name"],
            rule["rule_type"],
            rule["field_name"],
            config,
            rule["dimension"],
            rule.get("severity", "中"),
        ))

        self.conn.commit()
        return self.get_rule(rule_id)

    # ── 编辑规则 ──

    def update_rule(self, rule_id: str, data: dict) -> bool:
        """编辑已有规则（支持预置和自定义）"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM quality_rule WHERE rule_id = ?", (rule_id,))
        row = cursor.fetchone()
        if not row:
            return False

        config_val = json.dumps(data.get("config"), ensure_ascii=False) if data.get("config") else None
        cursor.execute("""
            UPDATE quality_rule
            SET rule_name = ?, rule_type = ?, field_name = ?,
                config = ?, dimension = ?, severity = ?
            WHERE rule_id = ?
        """, (
            data.get("rule_name", row["rule_name"]),
            data.get("rule_type", row["rule_type"]),
            data.get("field_name", row["field_name"]),
            config_val,
            data.get("dimension", row["dimension"]),
            data.get("severity", row["severity"]),
            rule_id,
        ))
        self.conn.commit()
        return True

    # ── 删除自定义规则 ──

    def delete_rule(self, rule_id: str) -> bool:
        """删除规则（预置规则也可删除）"""
        cursor = self.conn.cursor()
        cursor.execute("SELECT * FROM quality_rule WHERE rule_id = ?", (rule_id,))
        if not cursor.fetchone():
            return False

        cursor.execute("DELETE FROM quality_rule WHERE rule_id = ?", (rule_id,))
        self.conn.commit()
        return True

    # ── 规则统计 ──

    def get_stats(self, session_id: str | None = None) -> dict:
        """获取规则统计"""
        rules = self.get_rules(session_id)
        total = len(rules)
        enabled = sum(1 for r in rules if r["enabled"] == 1)
        by_dim = {}
        for r in rules:
            dim = r["dimension"]
            if dim not in by_dim:
                by_dim[dim] = 0
            by_dim[dim] += 1

        return {
            "total": total,
            "enabled": enabled,
            "disabled": total - enabled,
            "by_dimension": by_dim,
        }

    def close(self):
        self.conn.close()
