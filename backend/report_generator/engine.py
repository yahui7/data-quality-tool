"""
报告生成引擎
- 统计汇总与图表数据
- PDF 报告导出（Jinja2 + WeasyPrint）
"""
import json
from datetime import datetime
from io import BytesIO

from jinja2 import Environment, FileSystemLoader
from backend.database import get_connection


class ReportEngine:
    """报告生成引擎"""

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.conn = get_connection()

    # ── 获取检测结果 ──

    def get_result(self) -> dict | None:
        """获取最新检测结果"""
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
        return result

    # ── 报告 JSON ──

    def generate_report(self) -> dict:
        """生成完整报告数据（前端渲染用）"""
        result = self.get_result()
        if not result:
            return {"status": "error", "message": "没有检测结果，请先执行检测"}

        # 只保留实际执行过的规则；历史结果中可能包含因字段缺失而跳过的规则。
        executed_rules = [
            rule for rule in result["rule_results"]
            if not rule.get("skipped")
            and rule.get("pass_count", 0) + rule.get("fail_count", 0) > 0
        ]

        # 按维度汇总
        dim_summary = {}
        for r in executed_rules:
            dim = r["dimension"]
            if dim not in dim_summary:
                dim_summary[dim] = {"total_rules": 0, "total_issues": 0}
            dim_summary[dim]["total_rules"] += 1
            dim_summary[dim]["total_issues"] += r["fail_count"]

        # 按严重程度汇总
        severity_summary = {"高": 0, "中": 0, "低": 0}
        for issue in result["issue_details"]:
            sev = issue.get("severity", "中")
            if sev in severity_summary:
                severity_summary[sev] += 1

        # 图表数据
        charts = {
            "pie_data": [
                {"name": dim, "value": info["total_issues"]}
                for dim, info in dim_summary.items()
            ],
            "bar_data": {
                "categories": list(result["dimension_scores"].keys()),
                "scores": [
                    result["dimension_scores"][d]["score"]
                    for d in result["dimension_scores"]
                ],
                "issues": [
                    result["dimension_scores"][d]["issues"]
                    for d in result["dimension_scores"]
                ],
            },
            "severity_data": [
                {"name": "高", "value": severity_summary["高"]},
                {"name": "中", "value": severity_summary["中"]},
                {"name": "低", "value": severity_summary["低"]},
            ],
        }

        # 修复建议
        recommendations = self._build_recommendations(result)

        return {
            "status": "ok",
            "check_time": result["check_time"],
            "total_rows": result["total_rows"],
            "total_rules": len(executed_rules),
            "total_issues": result["total_issues"],
            "health_score": result["health_score"],
            "dimension_scores": result["dimension_scores"],
            "rule_results": executed_rules,
            "issue_details": result["issue_details"],
            "dim_summary": dim_summary,
            "severity_summary": severity_summary,
            "charts": charts,
            "recommendations": recommendations,
        }

    # ── 修复建议 ──

    def _build_recommendations(self, result: dict) -> list[dict]:
        """根据检测结果生成修复建议"""
        recommendations = []

        # 按维度分组问题
        dim_issues = {}
        for r in result["rule_results"]:
            if r["fail_count"] > 0:
                dim = r["dimension"]
                if dim not in dim_issues:
                    dim_issues[dim] = []
                dim_issues[dim].append(r)

        # 完整性建议
        if "完整性" in dim_issues:
            recommendations.append({
                "priority": "高",
                "category": "完整性",
                "title": "补全缺失的关键字段",
                "detail": f"共 {sum(r['fail_count'] for r in dim_issues['完整性'])} 处字段缺失。"
                         f"建议优先补全姓名、手机号、身份证号等关键信息，可通过客户回访或系统校验提醒完成。",
            })

        # 准确性建议
        if "准确性" in dim_issues:
            recommendations.append({
                "priority": "高",
                "category": "准确性",
                "title": "修正格式错误数据",
                "detail": f"共 {sum(r['fail_count'] for r in dim_issues['准确性'])} 处格式错误。"
                         f"建议在前端表单增加格式校验（如手机号11位、邮箱格式），从源头减少脏数据。",
            })

        # 一致性建议
        if "一致性" in dim_issues:
            recommendations.append({
                "priority": "中",
                "category": "一致性",
                "title": "清除重复数据",
                "detail": f"共 {sum(r['fail_count'] for r in dim_issues['一致性'])} 处重复记录。"
                         f"建议建立唯一索引约束，对历史重复数据进行合并或删除。",
            })

        # 逻辑性建议
        if "逻辑性" in dim_issues:
            recommendations.append({
                "priority": "中",
                "category": "逻辑性",
                "title": "修复逻辑矛盾数据",
                "detail": f"共 {sum(r['fail_count'] for r in dim_issues['逻辑性'])} 处逻辑错误。"
                         f"建议增加业务规则校验（如日期先后关系、状态取值），定期执行数据质量扫描。",
            })

        # 综合建议
        if result["health_score"] < 70:
            recommendations.append({
                "priority": "高",
                "category": "综合",
                "title": "建立数据质量管理制度",
                "detail": f"当前数据健康度仅 {result['health_score']} 分，建议建立定期数据质量巡检机制，"
                         f"指定数据负责人，每周进行数据质量复查。",
            })

        return recommendations

    # ── PDF 导出 ──

    def export_pdf(self) -> BytesIO:
        """生成 PDF 报告"""
        report = self.generate_report()
        if report.get("status") == "error":
            raise ValueError(report.get("message", "报告生成失败"))

        # 准备模板数据
        dim_scores = report["dimension_scores"]
        dim_score_rows = "\n".join([
            f'<tr><td>{dim}</td><td style="color:{self._score_color(info["score"])}"><b>{info["score"]}%</b></td><td>{info["issues"]} 个问题</td></tr>'
            for dim, info in dim_scores.items()
        ])

        rule_result_rows = "\n".join([
            f'<tr><td>{r["rule_name"]}</td><td>{r["dimension"]}</td><td>{r["severity"]}</td><td>{r["pass_count"]}</td><td style="color:{"#e74c3c" if r["fail_count"] > 0 else "#52c41a"}">{r["fail_count"]}</td></tr>'
            for r in report["rule_results"]
        ])

        issue_rows = "\n".join([
            f'<tr><td>{i["row_index"]}</td><td>{i["field"]}</td><td>{i["value"]}</td><td>{i["rule_name"]}</td><td>{i["severity"]}</td></tr>'
            for i in report["issue_details"][:50]
        ])

        rec_rows = "\n".join([
            f'<div class="rec-item"><span class="rec-priority {r["priority"]}">{r["priority"]}</span><b>{r["title"]}</b><p>{r["detail"]}</p></div>'
            for r in report["recommendations"]
        ])

        html_template = f"""<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<style>
    body {{ font-family: "Microsoft YaHei", "PingFang SC", sans-serif; color: #333; line-height: 1.8; padding: 40px; }}
    .cover {{ text-align: center; padding: 80px 0; page-break-after: always; }}
    .cover h1 {{ font-size: 28px; color: #0a0e27; margin-bottom: 20px; }}
    .cover .subtitle {{ font-size: 16px; color: #888; margin-bottom: 40px; }}
    .cover .meta {{ font-size: 13px; color: #aaa; }}
    h2 {{ color: #0a0e27; border-bottom: 2px solid #4a90d9; padding-bottom: 8px; margin-top: 30px; }}
    .score-card {{ background: linear-gradient(135deg, #0a0e27 0%, #1a1f3a 100%); color: #fff; padding: 24px; border-radius: 12px; margin: 20px 0; text-align: center; }}
    .score-card .big-score {{ font-size: 48px; font-weight: 700; color: {self._score_color(report['health_score'])}; }}
    .score-card .level {{ font-size: 18px; margin-top: 8px; }}
    .stats {{ display: flex; gap: 16px; margin: 20px 0; }}
    .stat-item {{ flex: 1; background: #f8f9fa; border-radius: 8px; padding: 16px; text-align: center; }}
    .stat-item .num {{ font-size: 24px; font-weight: 700; color: #1a1f3a; }}
    .stat-item .lbl {{ font-size: 12px; color: #999; }}
    table {{ width: 100%; border-collapse: collapse; margin: 16px 0; font-size: 13px; }}
    th {{ background: #f0f2f5; padding: 10px 12px; text-align: left; font-weight: 600; }}
    td {{ padding: 8px 12px; border-bottom: 1px solid #f0f0f0; }}
    .rec-item {{ background: #f8f9fa; border-radius: 8px; padding: 16px; margin: 12px 0; }}
    .rec-priority {{ display: inline-block; padding: 2px 10px; border-radius: 12px; font-size: 12px; margin-right: 8px; color: #fff; }}
    .rec-priority.高 {{ background: #e74c3c; }} .rec-priority.中 {{ background: #e67e22; }} .rec-priority.低 {{ background: #52c41a; }}
    .rec-item p {{ margin: 8px 0 0 0; color: #666; font-size: 13px; }}
    .footer {{ margin-top: 40px; padding-top: 20px; border-top: 1px solid #e8e8e8; text-align: center; font-size: 11px; color: #bbb; }}
</style>
</head>
<body>
<div class="cover">
    <h1>📊 数据质量检测报告</h1>
    <div class="subtitle">数据健康体检 · 质量智能诊断</div>
    <div class="meta">
        <p>检测日期：{report["check_time"]}</p>
        <p>数据总量：{report["total_rows"]} 条 · 检测规则：{report["total_rules"]} 条</p>
    </div>
</div>

<h2>一、检测总览</h2>
<div class="score-card">
    <div class="big-score">{report["health_score"]}%</div>
    <div class="level">数据健康度等级：{report.get("health_level", {}).get("level", "-")}</div>
</div>
<div class="stats">
    <div class="stat-item"><div class="num">{report["total_rows"]}</div><div class="lbl">数据总行数</div></div>
    <div class="stat-item"><div class="num">{report["total_issues"]}</div><div class="lbl">发现问题数</div></div>
    <div class="stat-item"><div class="num">{report["total_rules"]}</div><div class="lbl">检测规则数</div></div>
</div>

<h2>二、维度得分</h2>
<table>
    <tr><th>维度</th><th>得分</th><th>问题数</th></tr>
    {dim_score_rows}
</table>

<h2>三、规则检测明细</h2>
<table>
    <tr><th>规则名称</th><th>维度</th><th>严重程度</th><th>通过数</th><th>失败数</th></tr>
    {rule_result_rows}
</table>

<h2>四、问题数据明细（前50条）</h2>
<table>
    <tr><th>行号</th><th>字段</th><th>当前值</th><th>违反规则</th><th>严重程度</th></tr>
    {issue_rows}
</table>

<h2>五、修复建议</h2>
{rec_rows}

<div class="footer">
    <p>本报告由「数据质量智能检测工具」自动生成</p>
    <p>如有数据治理需求，请联系我们获取专业咨询服务</p>
</div>
</body>
</html>"""

        # WeasyPrint 转换
        try:
            from weasyprint import HTML
            pdf_bytes = HTML(string=html_template).write_pdf()
        except ImportError:
            # WeasyPrint 不可用时的回退：返回 HTML
            raise RuntimeError("WeasyPrint 未安装，无法生成PDF。请运行: pip install weasyprint")

        buf = BytesIO(pdf_bytes)
        buf.seek(0)
        return buf

    def _score_color(self, score: float) -> str:
        if score >= 90:
            return "#52c41a"
        elif score >= 70:
            return "#4a90d9"
        elif score >= 50:
            return "#e67e22"
        else:
            return "#e74c3c"

    def close(self):
        self.conn.close()
