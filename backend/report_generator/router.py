"""
报告生成 API 路由
"""
from fastapi import APIRouter, Query
from fastapi.responses import StreamingResponse, JSONResponse

from .engine import ReportEngine

router = APIRouter()


# ── 报告数据 ──

@router.get("/{session_id}")
async def get_report(session_id: str):
    """获取报告完整数据（JSON，前端渲染用）"""
    engine = ReportEngine(session_id)
    report = engine.generate_report()
    engine.close()

    if report.get("status") == "error":
        return JSONResponse(
            {"status": "error", "message": report.get("message")},
            status_code=404,
        )

    return {"status": "ok", "report": report}


# ── 图表数据 ──

@router.get("/{session_id}/charts")
async def get_charts(session_id: str):
    """获取图表数据（ECharts 消费）"""
    engine = ReportEngine(session_id)
    report = engine.generate_report()
    engine.close()

    if report.get("status") == "error":
        return JSONResponse(
            {"status": "error", "message": report.get("message")},
            status_code=404,
        )

    return {
        "status": "ok",
        "charts": report["charts"],
        "health_score": report["health_score"],
        "dimension_scores": report["dimension_scores"],
    }


# ── PDF 下载 ──

@router.get("/{session_id}/pdf")
async def download_pdf(session_id: str):
    """下载 PDF 报告"""
    try:
        engine = ReportEngine(session_id)
        buf = engine.export_pdf()
        engine.close()

        from urllib.parse import quote
        filename = f"数据质量检测报告_{session_id}.pdf"

        return StreamingResponse(
            buf,
            media_type="application/pdf",
            headers={
                "Content-Disposition": f"attachment; filename*=UTF-8''{quote(filename)}",
            },
        )
    except ValueError as e:
        return JSONResponse(
            {"status": "error", "message": str(e)},
            status_code=404,
        )
    except RuntimeError as e:
        return JSONResponse(
            {"status": "error", "message": str(e)},
            status_code=500,
        )
    except Exception as e:
        return JSONResponse(
            {"status": "error", "message": f"PDF生成失败: {str(e)}"},
            status_code=500,
        )
