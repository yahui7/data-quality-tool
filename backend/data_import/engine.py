"""
数据导入引擎
- CSV 文件解析与编码检测
- 行业模板管理
- 数据预览与存储
"""
import csv
import io
import json
import os

from backend.database import get_connection

# ── 模板目录 ─────────────────────────────────

TEMPLATES_DIR = os.path.join(
    os.path.dirname(os.path.dirname(os.path.dirname(__file__))),
    "data", "templates",
)

# ── 解析引擎 ─────────────────────────────────

class ImportEngine:
    """CSV 数据导入引擎"""

    def __init__(self):
        self.conn = get_connection()

    # ── 模板管理 ──

    def list_templates(self) -> list[dict]:
        """列出所有行业模板"""
        os.makedirs(TEMPLATES_DIR, exist_ok=True)
        templates = []
        if os.path.exists(TEMPLATES_DIR):
            for fname in sorted(os.listdir(TEMPLATES_DIR)):
                if fname.endswith(".json"):
                    with open(os.path.join(TEMPLATES_DIR, fname), "r", encoding="utf-8") as f:
                        templates.append(json.load(f))
        return templates

    def get_template(self, template_id: str) -> dict | None:
        """获取单个模板"""
        path = os.path.join(TEMPLATES_DIR, f"{template_id}.json")
        if os.path.exists(path):
            with open(path, "r", encoding="utf-8") as f:
                return json.load(f)
        return None

    # ── CSV 解析 ──

    def detect_encoding(self, file_bytes: bytes) -> str:
        """检测文件编码（UTF-8 / GBK / GB2312）"""
        import chardet
        result = chardet.detect(file_bytes)
        encoding = result.get("encoding", "utf-8")
        confidence = result.get("confidence", 0)

        # 低置信度时回退到 UTF-8
        if confidence < 0.7:
            # 尝试 UTF-8
            try:
                file_bytes.decode("utf-8")
                return "utf-8"
            except UnicodeDecodeError:
                pass
            # 尝试 GBK
            try:
                file_bytes.decode("gbk")
                return "gbk"
            except UnicodeDecodeError:
                pass

        return encoding or "utf-8"

    def parse_csv(self, content: str) -> dict:
        """解析 CSV 内容，返回 headers + rows"""
        reader = csv.DictReader(io.StringIO(content))
        headers = reader.fieldnames or []
        rows = []
        for row in reader:
            rows.append({k.strip(): (v or "").strip() for k, v in row.items()})
        return {"headers": headers, "rows": rows, "total": len(rows)}

    # ── 预览 ──

    def get_preview(self, session_id: str, limit: int = 5) -> dict:
        """获取已上传数据的前 N 行预览"""
        cursor = self.conn.cursor()

        # 获取总数
        cursor.execute(
            "SELECT COUNT(*) AS cnt FROM uploaded_data WHERE session_id = ?",
            (session_id,),
        )
        total = cursor.fetchone()["cnt"]

        # 获取预览行
        cursor.execute(
            "SELECT row_index, fields FROM uploaded_data WHERE session_id = ? ORDER BY row_index LIMIT ?",
            (session_id, limit),
        )
        rows = cursor.fetchall()
        preview = []
        headers = set()
        for r in rows:
            fields = json.loads(r["fields"])
            headers.update(fields.keys())
            preview.append({"row_index": r["row_index"], **fields})

        return {
            "total": total,
            "preview": preview,
            "headers": sorted(headers),
        }

    # ── 写入数据库 ──

    def save_to_db(self, session_id: str, rows: list[dict], table_key: str = "") -> int:
        """将解析后的行存入数据库，返回写入行数"""
        cursor = self.conn.cursor()

        # 清除该 session 中该表的旧数据
        cursor.execute(
            "DELETE FROM uploaded_data WHERE session_id = ? AND table_key = ?",
            (session_id, table_key),
        )

        # 批量写入
        for i, row in enumerate(rows):
            cursor.execute(
                "INSERT INTO uploaded_data (session_id, table_key, row_index, fields) VALUES (?, ?, ?, ?)",
                (session_id, table_key, i, json.dumps(row, ensure_ascii=False)),
            )

        self.conn.commit()
        return len(rows)

    # ── 获取全部数据 ──

    def get_all_data(self, session_id: str) -> list[dict]:
        """获取 session 的全部数据（用于检测）"""
        cursor = self.conn.cursor()
        cursor.execute(
            "SELECT row_index, fields FROM uploaded_data WHERE session_id = ? ORDER BY row_index",
            (session_id,),
        )
        rows = cursor.fetchall()
        return [{"row_index": r["row_index"], **json.loads(r["fields"])} for r in rows]

    # ── 清理 ──

    def cleanup_session(self, session_id: str):
        """清除 session 相关数据"""
        cursor = self.conn.cursor()
        cursor.execute("DELETE FROM uploaded_data WHERE session_id = ?", (session_id,))
        cursor.execute("DELETE FROM quality_rule WHERE session_id = ?", (session_id,))
        cursor.execute("DELETE FROM check_result WHERE session_id = ?", (session_id,))
        self.conn.commit()

    def close(self):
        self.conn.close()
