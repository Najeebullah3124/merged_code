FROM python:3.11-slim

RUN useradd --create-home --shell /usr/sbin/nologin sis

WORKDIR /app
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY app ./app
COPY public ./public

ENV SIS_HOST=0.0.0.0
ENV SIS_PORT=8090
ENV PYTHONUNBUFFERED=1

RUN chown -R sis:sis /app
USER sis

EXPOSE 8090

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
  CMD python -c "import urllib.request; urllib.request.urlopen('http://127.0.0.1:8090/health', timeout=4)"

CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8090", "--workers", "1"]
