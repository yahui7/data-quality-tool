"""
数据质量智能检测工具 — 后端主应用
FastAPI + SQLite · 本地部署 / Railway
"""
from contextlib import asynccontextmanager
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from backend.database import init_db
from backend.data_import.router import router as import_router
from backend.quality_rules.router import router as rules_router
from backend.quality_checker.router import router as checker_router
from backend.report_generator.router import router as report_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    """应用生命周期：启动时初始化数据库"""
    init_db()
    print("[OK] 数据质量检测工具启动完成")
    yield


app = FastAPI(
    title="数据质量智能检测工具",
    description="轻量级数据健康体检工具 · 4步发现数据质量问题",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS — 允许前端跨域访问
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# 注册各模块路由
app.include_router(import_router, prefix="/api/import", tags=["数据导入"])
app.include_router(rules_router, prefix="/api/rules", tags=["规则管理"])
app.include_router(checker_router, prefix="/api/check", tags=["质量检测"])
app.include_router(report_router, prefix="/api/report", tags=["报告生成"])


@app.get("/api/health")
async def health_check():
    """健康检查"""
    return {"status": "ok", "message": "数据质量智能检测工具运行中"}


# 前端静态文件 — 放在最后，避免拦截 API 路由
app.mount("/", StaticFiles(directory="frontend", html=True), name="frontend")


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8002)
