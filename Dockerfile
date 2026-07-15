# 数据质量智能检测工具（需要 WeasyPrint PDF 生成）
FROM python:3.13-slim

WORKDIR /app

# WeasyPrint 系统依赖
RUN apt-get update && apt-get install -y --no-install-recommends \
    libpango-1.0-0 \
    libpangocairo-1.0-0 \
    libcairo2 \
    libgdk-pixbuf2.0-0 \
    libffi8 \
    shared-mime-info \
    && rm -rf /var/lib/apt/lists/*

COPY requirements.txt .
RUN pip config set global.index-url https://mirrors.aliyun.com/pypi/simple/ && \
    pip install --no-cache-dir -r requirements.txt

COPY . .
RUN mkdir -p data/templates

EXPOSE 8002

CMD ["python", "main.py"]
