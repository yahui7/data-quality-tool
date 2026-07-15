"""
数据质量检测核心引擎
- 逐行应用规则
- 四维度评分计算
- 进度追踪
"""
import json
import re
from datetime import datetime
from typing import Optional

from backend.database import get_connection
from backend.quality_rules.engine import RuleEngine


# ── 进度存储（内存）──
_progress_store: dict[str, dict] = {}


class QualityEngine:
    """数据质量检测核心引擎"""

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.conn = get_connection()
        self.progress = {
            "status": "idle",
            "checked": 0,
            "total": 0,
            "issues": 0,
            "start_time": None,
        }
        _progress_store[session_id] = self.progress

    # ── 执行检测 ──

    def run_check(self, rules: list[dict] | None = None) -> dict:
        """执行全量质量检测"""
        self.progress["status"] = "running"
        self.progress["start_time"] = datetime.now().isoformat()

        # 1. 获取启用规则
        if rules is None:
            rule_engine = RuleEngine()
            all_rules = rule_engine.get_rules(self.session_id)
            rules = [r for r in all_rules if r["enabled"] == 1]
            rule_engine.close()

        if not rules:
            self.progress["status"] = "completed"
            return {
                "status": "error",
                "message": "没有启用的规则，请先配置规则",
            }

        # 2. 获取全部数据
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT table_key, row_index, fields FROM uploaded_data WHERE session_id = ? ORDER BY table_key, row_index",
            (self.session_id,),
        )
        rows = cursor.fetchall()

        total_rows = len(rows)
        self.progress["total"] = total_rows

        if total_rows == 0:
            self.progress["status"] = "completed"
            return {
                "status": "error",
                "message": "没有数据，请先导入CSV文件",
            }

        # 3. 过滤：跳过所有上传表中都不存在的字段规则。
        # 一个 session 可包含多张表，不能只用第一行的字段判断。
        available_fields = set()
        fields_by_table = {}
        for row in rows:
            row_fields = json.loads(row["fields"])
            available_fields.update(row_fields.keys())
            fields_by_table.setdefault(row["table_key"], set()).update(row_fields.keys())
        skipped_rules = []
        active_rules = []
        for rule in rules:
            config = rule.get("config") or {}
            if isinstance(config, str):
                config = json.loads(config) if config else {}
            source_table = config.get("source_table_key") if rule["rule_type"] == "reference_exists" else None
            target_table = config.get("target_table_key") if rule["rule_type"] == "reference_exists" else None
            target_field = config.get("target_field") if rule["rule_type"] == "reference_exists" else None
            source_missing = (
                rule["field_name"] not in available_fields
                if not source_table else rule["field_name"] not in fields_by_table.get(source_table, set())
            )
            target_missing = target_table and target_field not in fields_by_table.get(target_table, set())
            if source_missing or target_missing:
                skipped_rules.append(rule)
            else:
                if rule["rule_type"] == "reference_exists":
                    # Build the referenced-value set once per rule, not once per row.
                    referenced_values = set()
                    for row in rows:
                        if row["table_key"] != target_table:
                            continue
                        value = json.loads(row["fields"]).get(target_field)
                        if value is not None and str(value).strip() != "":
                            referenced_values.add(str(value).strip())
                    rule["_reference_values"] = referenced_values
                active_rules.append(rule)

        # 4. 逐行逐规则检测
        # 初始化统计结构
        rule_stats = {}
        for rule in active_rules:
            rule_stats[rule["rule_id"]] = {
                "rule_id": rule["rule_id"],
                "rule_name": rule["rule_name"],
                "rule_type": rule["rule_type"],
                "field_name": rule["field_name"],
                "dimension": rule["dimension"],
                "severity": rule["severity"],
                "pass_count": 0,
                "fail_count": 0,
            }

        # 被跳过的规则也加入统计（标记为跳过）
        for rule in skipped_rules:
            rule_stats[rule["rule_id"]] = {
                "rule_id": rule["rule_id"],
                "rule_name": rule["rule_name"],
                "rule_type": rule["rule_type"],
                "field_name": rule["field_name"],
                "dimension": rule["dimension"],
                "severity": rule["severity"],
                "pass_count": 0,
                "fail_count": 0,
                "skipped": True,
                "skip_reason": f"字段'{rule['field_name']}'不在数据中",
            }

        issue_details = []
        issue_rows = set()  # 去重问题行

        for row in rows:
            fields = json.loads(row["fields"])
            row_idx = row["row_index"]
            table_key = row["table_key"]

            for rule in active_rules:
                # 当前行可能属于另一张表；只在该字段存在的行上执行规则。
                if rule["field_name"] not in fields:
                    continue
                config = rule.get("config") or {}
                if rule["rule_type"] == "reference_exists" and config.get("source_table_key") != table_key:
                    continue
                result = self._apply_rule(rule, fields, rows)
                if result["pass"]:
                    rule_stats[rule["rule_id"]]["pass_count"] += 1
                else:
                    rule_stats[rule["rule_id"]]["fail_count"] += 1
                    # row_index starts from zero for every uploaded table, so the
                    # table key is part of the identity for cross-table sessions.
                    issue_rows.add((table_key, row_idx))
                    issue_details.append({
                        "table_key": table_key,
                        "row_index": row_idx + 1,  # 显示行号从1开始
                        "field": rule["field_name"],
                        "value": str(fields.get(rule["field_name"], ""))[:100],
                        "rule_id": rule["rule_id"],
                        "rule_name": rule["rule_name"],
                        "dimension": rule["dimension"],
                        "severity": rule["severity"],
                        "message": result["message"],
                        "row_data": {k: str(v)[:80] for k, v in fields.items()},
                    })

            self.progress["checked"] += 1
            self.progress["issues"] = len(issue_details)

        # 4. 计算评分
        health_score = round(100 - (len(issue_rows) / max(total_rows, 1) * 100), 1)
        health_score = max(0, min(100, health_score))

        dimension_scores = self._compute_dimension_scores(
            rule_stats, total_rows, len(rules)
        )

        # 5. 保存结果
        check_time = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
        rule_results_list = list(rule_stats.values())

        cursor.execute("""
            INSERT INTO check_result
                (session_id, check_time, total_rows, total_issues,
                 health_score, dimension_scores, rule_results, issue_details)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            self.session_id,
            check_time,
            total_rows,
            len(issue_details),
            health_score,
            json.dumps(dimension_scores, ensure_ascii=False),
            json.dumps(rule_results_list, ensure_ascii=False),
            json.dumps(issue_details, ensure_ascii=False),
        ))
        self.conn.commit()

        # 清理旧结果（保留最近5次）
        cursor.execute("""
            DELETE FROM check_result
            WHERE session_id = ? AND id NOT IN (
                SELECT id FROM check_result
                WHERE session_id = ?
                ORDER BY id DESC LIMIT 5
            )
        """, (self.session_id, self.session_id))
        self.conn.commit()

        self.progress["status"] = "completed"

        result = {
            "state": "completed",  # 内部状态，由 router 处理为 engine_state
            "check_time": check_time,
            "session_id": self.session_id,
            "total_rows": total_rows,
            "total_rules": len(active_rules),
            "skipped_rules": len(skipped_rules),
            "total_issues": len(issue_details),
            "health_score": health_score,
            "health_level": self._get_health_level(health_score),
            "dimension_scores": dimension_scores,
            "rule_results": rule_results_list,
            "issue_details": issue_details[:200],  # 前端最多展示200条明细
            "issue_count": len(issue_details),
        }

        return result

    # ── 单规则应用 ──

    def _apply_rule(self, rule: dict, fields: dict, all_rows: list) -> dict:
        """将单条规则应用到单行数据"""
        field_value = fields.get(rule["field_name"])
        rule_type = rule["rule_type"]

        config = rule.get("config")
        if isinstance(config, str) and config:
            config = json.loads(config)

        # ── not_null ──
        if rule_type == "not_null":
            if field_value is None or str(field_value).strip() == "":
                return {
                    "pass": False,
                    "message": f"'{rule['field_name']}' 不能为空",
                }
            return {"pass": True}

        # ── regex ──
        if rule_type == "regex":
            if field_value is None or str(field_value).strip() == "":
                return {"pass": True}  # 空值由 not_null 处理
            if config and "pattern" in config:
                if not re.match(config["pattern"], str(field_value)):
                    return {
                        "pass": False,
                        "message": f"'{rule['field_name']}' 格式不符合要求: {field_value}",
                    }
            return {"pass": True}

        # ── range ──
        if rule_type == "range":
            if field_value is None or str(field_value).strip() == "":
                return {"pass": True}
            try:
                val = float(field_value)
                if config:
                    if config.get("min_exclusive") and val <= config.get("min", 0):
                        return {
                            "pass": False,
                            "message": f"'{rule['field_name']}' 必须大于{config['min']}: {val}",
                        }
                    if "min" in config and not config.get("min_exclusive") and val < config["min"]:
                        return {
                            "pass": False,
                            "message": f"'{rule['field_name']}' 不能小于{config['min']}: {val}",
                        }
                    if "max" in config:
                        max_value = config["max"]
                        if config.get("max_exclusive") and val >= max_value:
                            return {
                                "pass": False,
                                "message": f"'{rule['field_name']}' 必须小于{max_value}: {val}",
                            }
                        if not config.get("max_exclusive") and val > max_value:
                            return {
                                "pass": False,
                                "message": f"'{rule['field_name']}' 不能大于{max_value}: {val}",
                            }
            except (ValueError, TypeError):
                return {
                    "pass": False,
                    "message": f"'{rule['field_name']}' 不是有效的数值: {field_value}",
                }
            return {"pass": True}

        # ── length ──
        if rule_type == "length":
            if field_value is None or str(field_value).strip() == "":
                return {"pass": True}
            str_val = str(field_value)
            if config:
                if "min_len" in config and len(str_val) < config["min_len"]:
                    return {
                        "pass": False,
                        "message": f"'{rule['field_name']}' 长度不足（需{config['min_len']}位）: {len(str_val)}位",
                    }
                if "max_len" in config and len(str_val) > config["max_len"]:
                    return {
                        "pass": False,
                        "message": f"'{rule['field_name']}' 长度超出（最多{config['max_len']}位）: {len(str_val)}位",
                    }
            return {"pass": True}

        # ── unique ──
        if rule_type == "unique":
            if field_value is None or str(field_value).strip() == "":
                return {"pass": True}
            # 统计当前值在所有行中出现的次数
            count = sum(
                1 for r in all_rows
                if json.loads(r["fields"]).get(rule["field_name"]) == field_value
            )
            if count > 1:
                return {
                    "pass": False,
                    "message": f"'{rule['field_name']}' 重复（出现{count}次）: {field_value}",
                }
            return {"pass": True}

        # ── reference_exists ──
        if rule_type == "reference_exists":
            if field_value is None or str(field_value).strip() == "":
                return {"pass": True}  # Empty values are handled by a separate not_null rule.
            target_field = (config or {}).get("target_field", "目标字段")
            if str(field_value).strip() not in rule.get("_reference_values", set()):
                return {
                    "pass": False,
                    "message": f"'{rule['field_name']}' 的值 '{field_value}' 不存在于目标表字段 '{target_field}'",
                }
            return {"pass": True}

        # 未知规则类型
        return {"pass": True}

    # ── 维度评分 ──

    def _compute_dimension_scores(
        self, rule_stats: dict, total_rows: int, total_rules: int
    ) -> dict:
        """计算四维度得分"""
        dim_issues = {"完整性": 0, "准确性": 0, "一致性": 0, "逻辑性": 0}
        dim_totals = {"完整性": 0, "准确性": 0, "一致性": 0, "逻辑性": 0}

        for stat in rule_stats.values():
            dim = stat["dimension"]
            total = stat["pass_count"] + stat["fail_count"]
            dim_issues[dim] += stat["fail_count"]
            dim_totals[dim] += total

        scores = {}
        for dim in dim_issues:
            if dim_totals[dim] > 0:
                score = round(100 - (dim_issues[dim] / dim_totals[dim] * 100), 1)
            else:
                score = 100.0
            scores[dim] = {
                "score": max(0, min(100, score)),
                "issues": dim_issues[dim],
                "total_checks": dim_totals[dim],
            }

        return scores

    def _get_health_level(self, score: float) -> dict:
        """根据评分返回等级"""
        if score >= 90:
            return {"level": "优秀", "color": "#52c41a"}
        elif score >= 70:
            return {"level": "良好", "color": "#4a90d9"}
        elif score >= 50:
            return {"level": "一般", "color": "#e67e22"}
        else:
            return {"level": "较差", "color": "#e74c3c"}

    # ── 进度查询 ──

    @staticmethod
    def get_progress(session_id: str) -> dict:
        """获取检测进度"""
        return _progress_store.get(session_id, {"status": "idle", "checked": 0, "total": 0, "issues": 0})

    # ── 历史结果 ──

    def get_latest_result(self) -> dict | None:
        """获取最近一次检测结果"""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT * FROM check_result WHERE session_id = ? ORDER BY id DESC LIMIT 1",
            (self.session_id,),
        )
        row = cursor.fetchone()
        if not row:
            return None

        result = dict(row)
        result["dimension_scores"] = json.loads(result["dimension_scores"])
        result["rule_results"] = json.loads(result["rule_results"])
        result["issue_details"] = json.loads(result["issue_details"])
        result["health_level"] = self._get_health_level(result["health_score"])
        return result

    def close(self):
        self.conn.close()
