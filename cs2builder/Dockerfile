FROM python:3.12-slim-bookworm

WORKDIR /app
ENV PYTHONUNBUFFERED=1
ENV PLAYWRIGHT_BROWSERS_PATH=/app/pw-browsers

COPY requirements.txt /app/requirements.txt
RUN python -m pip install --no-cache-dir -r /app/requirements.txt \
    && patchright install --with-deps chromium

COPY . /app

CMD ["sh","-lc","uvicorn browser_probe:app --host 0.0.0.0 --port ${PORT:-8080}"]
