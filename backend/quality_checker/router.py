"""
质量检测 API 路由
"""
from fastapi import APIRouter
from fastapi.responses import JSONResponse
from pydantic import BaseModel

from .engine import QualityEngine

router = APIRouter()


class CheckRequest(BaseModel):
    """检测请求"""
    session_id: str


# ── 执行检测 ──

@router.post("/run")
async def run_check(req: CheckRequest):
    """执行数据质量检测"""
    try:
        engine = QualityEngine(req.session_id)
        result = engine.run_check()
        engine.close()

        if result.get("status") == "error":
            return JSONResponse(
                {"status": "error", "message": result.get("message", "检测失败")},
                status_code=400,
            )

        # 移除引擎内部的 status/state 字段，避免覆盖外层 API status
        engine_status = result.pop("status", None) or result.pop("state", None)
        return {"status": "ok", "engine_state": engine_status, **result}
    except Exception as e:
        return JSONResponse(
            {"status": "error", "message": f"检测异常: {str(e)}"},
            status_code=500,
        )


# ── 查询进度 ──

@router.get("/status/{session_id}")
async def get_status(session_id: str):
    """获取检测进度和结果"""
    progress = QualityEngine.get_progress(session_id)

    if progress["status"] == "idle":
        # 检查是否有历史结果
        engine = QualityEngine(session_id)
        result = engine.get_latest_result()
        engine.close()
        if result:
            return {"status": "ok", "progress": {"status": "completed"}, "result": result}
        return {"status": "ok", "progress": progress, "result": None}

    if progress["status"] == "completed":
        engine = QualityEngine(session_id)
        result = engine.get_latest_result()
        engine.close()
        return {"status": "ok", "progress": progress, "result": result}

    return {"status": "ok", "progress": progress, "result": None}
