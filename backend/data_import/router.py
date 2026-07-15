"""
数据导入 API 路由
"""
import csv
import io
import uuid
from fastapi import APIRouter, UploadFile, File, Form
from fastapi.responses import JSONResponse, StreamingResponse

from .engine import ImportEngine

router = APIRouter()

# 存储已上传文件的 session 映射（生产环境可改为 Redis）
_session_store: dict[str, dict] = {}


@router.get("/templates")
async def list_templates():
    """获取行业模板列表"""
    engine = ImportEngine()
    templates = engine.list_templates()
    engine.close()
    return {"status": "ok", "templates": templates}


@router.get("/templates/{template_id}")
async def get_template(template_id: str):
    """获取单个模板详情"""
    engine = ImportEngine()
    tpl = engine.get_template(template_id)
    engine.close()
    if not tpl:
        return JSONResponse({"status": "error", "message": "模板不存在"}, status_code=404)
    return {"status": "ok", "template": tpl}


@router.get("/templates/{template_id}/download/{table_key}")
async def download_template_csv(template_id: str, table_key: str):
    """下载指定表的CSV模板（仅含表头）"""
    engine = ImportEngine()
    tpl = engine.get_template(template_id)
    engine.close()

    if not tpl:
        return JSONResponse({"status": "error", "message": "模板不存在"}, status_code=404)

    # 查找对应表
    table = None
    for t in tpl.get("tables", []):
        if t.get("table_key") == table_key:
            table = t
            break

    if not table:
        return JSONResponse({"status": "error", "message": "表不存在"}, status_code=404)

    # 生成 CSV（仅表头行）
    field_names = [f["name"] for f in table.get("fields", [])]
    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow(field_names)
    csv_bytes = ("" + output.getvalue()).encode("utf-8")
    output.close()

    from urllib.parse import quote
    filename = f"{table['name']}_模板.csv"

    return StreamingResponse(
        io.BytesIO(csv_bytes),
        media_type="text/csv; charset=utf-8",
        headers={
            "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
        },
    )


@router.post("/preview-csv")
async def preview_csv(
    file: UploadFile = File(...),
):
    """预览CSV文件（仅解析，不存储）"""
    engine = ImportEngine()
    file_bytes = await file.read()
    if len(file_bytes) == 0:
        engine.close()
        return JSONResponse({"status": "error", "message": "文件为空"}, status_code=400)

    encoding = engine.detect_encoding(file_bytes)
    try:
        content = file_bytes.decode(encoding)
    except (UnicodeDecodeError, LookupError):
        content = file_bytes.decode("utf-8", errors="replace")

    parsed = engine.parse_csv(content)
    engine.close()

    if not parsed["headers"]:
        return JSONResponse({"status": "error", "message": "CSV无有效表头"}, status_code=400)

    return {
        "status": "ok",
        "filename": file.filename,
        "encoding": encoding,
        "headers": parsed["headers"],
        "total_rows": parsed["total"],
        "preview_rows": parsed["rows"][:5],
    }


@router.post("/upload")
async def upload_csv(
    file: UploadFile = File(...),
    template_id: str = Form("custom"),
    table_key: str = Form(""),
    session_id: str = Form(""),
):
    """上传 CSV 文件并解析（支持多表上传）"""
    engine = ImportEngine()

    # 读取文件
    file_bytes = await file.read()
    if len(file_bytes) == 0:
        engine.close()
        return JSONResponse({"status": "error", "message": "文件为空"}, status_code=400)

    # 检测编码
    encoding = engine.detect_encoding(file_bytes)

    # 解码并解析
    try:
        content = file_bytes.decode(encoding)
    except (UnicodeDecodeError, LookupError):
        content = file_bytes.decode("utf-8", errors="replace")

    parsed = engine.parse_csv(content)

    if not parsed["headers"]:
        engine.close()
        return JSONResponse({"status": "error", "message": "CSV文件没有有效的表头"}, status_code=400)

    # 使用已有 session_id 或生成新的
    sid = session_id or str(uuid.uuid4())[:8]
    count = engine.save_to_db(sid, parsed["rows"], table_key)

    # 获取预览
    preview_data = engine.get_preview(sid, limit=5)

    engine.close()

    # 存储 session 信息（支持多表）
    if sid not in _session_store:
        _session_store[sid] = {"template_id": template_id, "tables": {}}
    tbl_key = table_key or file.filename
    _session_store[sid]["tables"][tbl_key] = {
        "filename": file.filename,
        "encoding": encoding,
        "total_rows": count,
        "headers": parsed["headers"],
    }

    return {
        "status": "ok",
        "session_id": sid,
        "table_key": tbl_key,
        "filename": file.filename,
        "encoding": encoding,
        "total_rows": count,
        "headers": parsed["headers"],
        "preview": preview_data["preview"],
        "message": f"成功导入 {count} 行数据（编码: {encoding}）",
    }


@router.get("/preview/{session_id}")
async def get_preview(session_id: str, limit: int = 5):
    """获取已上传数据的预览"""
    session = _session_store.get(session_id)
    if not session:
        return JSONResponse({"status": "error", "message": "会话不存在，请重新上传"}, status_code=404)

    engine = ImportEngine()
    preview = engine.get_preview(session_id, limit=limit)
    engine.close()

    return {
        "status": "ok",
        "session_id": session_id,
        "filename": session["filename"],
        "headers": session["headers"],
        **preview,
    }


@router.delete("/session/{session_id}")
async def cleanup_session(session_id: str):
    """清除会话数据"""
    engine = ImportEngine()
    engine.cleanup_session(session_id)
    engine.close()
    _session_store.pop(session_id, None)
    return {"status": "ok", "message": "会话数据已清除"}
