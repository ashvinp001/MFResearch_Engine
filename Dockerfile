# The Prosperr website + API: the Node server (server/) serves the site files and /api/*, and runs the
# Python data-pipeline scripts it needs. Secrets come in as environment variables (see server/lib/env.js).
FROM python:3.12-slim-bookworm

# Node 20 is copied from the official image (the Python image has no Node).
COPY --from=node:20-bookworm-slim /usr/local/bin/node /usr/local/bin/node

ENV PYTHON=/usr/local/bin/python3 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    NODE_ENV=production

WORKDIR /app

# Python dependencies first, so code changes do not reinstall them.
COPY data-pipeline/requirements.txt data-pipeline/requirements.txt
RUN python3 -m pip install --no-cache-dir -r data-pipeline/requirements.txt

# The website, the server and the data pipeline (everything else is left out by .dockerignore).
COPY . .

RUN useradd --system --uid 10001 prosperr && chown -R prosperr /app
USER prosperr

EXPOSE 8080
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s \
  CMD node -e "require('http').get('http://127.0.0.1:8080/',r=>process.exit(r.statusCode<500?0:1)).on('error',()=>process.exit(1))"

CMD ["node", "server/index.js", "--port=8080", "--lan"]
