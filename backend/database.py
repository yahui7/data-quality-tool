"""
数据库连接与初始化
"""
import sqlite3
import os

DB_DIR = os.path.join(os.path.dirname(os.path.dirname(__file__)), "data")
DB_PATH = os.path.join(DB_DIR, "data_quality.db")


def get_connection() -> sqlite3.Connection:
    """获取数据库连接"""
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA foreign_keys = ON")
    return conn


def init_db():
    """初始化数据库表结构"""
    os.makedirs(DB_DIR, exist_ok=True)
    conn = get_connection()
    cursor = conn.cursor()

    # ── 上传数据存储（每行存为 JSON）──
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS uploaded_data (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id VARCHAR(50) NOT NULL,
            table_key VARCHAR(50) DEFAULT '',
            row_index INTEGER NOT NULL,
            fields TEXT NOT NULL,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )
    """)
    # Add table_key column if missing (migration)
    try:
        cursor.execute("ALTER TABLE uploaded_data ADD COLUMN table_key VARCHAR(50) DEFAULT ''")
    except:
        pass
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_uploaded_session
        ON uploaded_data(session_id)
    """)

    # ── 质量规则配置 ──
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS quality_rule (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            rule_id VARCHAR(20) UNIQUE NOT NULL,
            session_id VARCHAR(50),
            rule_name VARCHAR(100) NOT NULL,
            rule_type VARCHAR(30) NOT NULL,
            field_name VARCHAR(100) NOT NULL,
            config TEXT,
            dimension VARCHAR(20) NOT NULL,
            severity VARCHAR(10) DEFAULT '中',
            enabled INTEGER DEFAULT 1,
            is_default INTEGER DEFAULT 1
        )
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_rule_session
        ON quality_rule(session_id)
    """)

    # ── 检测结果 ──
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS check_result (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id VARCHAR(50) NOT NULL,
            check_time DATETIME DEFAULT CURRENT_TIMESTAMP,
            total_rows INTEGER NOT NULL,
            total_issues INTEGER NOT NULL,
            health_score DECIMAL(5,1) NOT NULL,
            dimension_scores TEXT NOT NULL,
            rule_results TEXT NOT NULL,
            issue_details TEXT NOT NULL
        )
    """)
    cursor.execute("""
        CREATE INDEX IF NOT EXISTS idx_check_session
        ON check_result(session_id)
    """)

    conn.commit()
    conn.close()
    print(f"[OK] 数据库已初始化: {DB_PATH}")
