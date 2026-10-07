# WealthOS as one image: the web app, built, and the API that serves it.
#
#   docker build -t wealthos .
#   docker run -p 8000:8000 --env-file backend/.env wealthos     then open http://localhost:8000
#
# Every setting is an ordinary environment variable read when the container
# starts (see "Deploy" in the README). Nothing is fixed at build time, so the
# same image suits any deployment.

# ---- 1. Build the web app
FROM node:22-slim AS web
WORKDIR /web
COPY frontend/package.json frontend/package-lock.json ./
RUN npm ci
COPY frontend/ ./
RUN npm run build

# ---- 2. The API, with the built app beside it
FROM python:3.13-slim
ENV PYTHONUNBUFFERED=1
ENV PYTHONDONTWRITEBYTECODE=1
# The numeric libraries start a thread for every processor of the host machine,
# each with its own memory. One is plenty here and keeps a small instance small.
ENV OMP_NUM_THREADS=1
ENV OPENBLAS_NUM_THREADS=1
# Serve the web app from the same address as the API.
ENV WEB_DIR=/app/web
# Downloaded market history and demo workspaces. Mount a disk at /data to keep them across restarts.
ENV DATA_DIR=/data/store
ENV CACHE_DIR=/data/cache
ENV PORT=8000

WORKDIR /app
COPY backend/requirements.txt ./
RUN pip install --no-cache-dir -r requirements.txt
COPY backend/app ./app
COPY --from=web /web/dist ./web
RUN mkdir -p /data

EXPOSE 8000
# One process on purpose: prices are held in memory and refreshed on background
# threads, which several workers would each repeat.
CMD ["sh", "-c", "exec uvicorn app.main:app --host 0.0.0.0 --port ${PORT} --proxy-headers --forwarded-allow-ips='*'"]
