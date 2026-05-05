FROM tfy.jfrog.io/tfy-mirror/python:3.11-slim

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1

WORKDIR /app

COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

COPY server.py .

ENV TRANSPORT=streamable-http
EXPOSE 8000

CMD python server.py ${TRANSPORT}
