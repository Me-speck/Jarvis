FROM python:3.12-slim

RUN apt-get update \
    && apt-get install -y --no-install-recommends ffmpeg build-essential cmake \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY requirements.txt requirements-model.txt requirements-voice.txt ./
ARG INSTALL_MODEL_RUNTIME=0
RUN pip install --no-cache-dir -r requirements.txt \
    && if [ "$INSTALL_MODEL_RUNTIME" = 1 ]; then \
        pip install --no-cache-dir -r requirements-model.txt -r requirements-voice.txt; \
    fi

COPY app.py local_runtime.py ./
COPY templates ./templates
COPY static ./static

EXPOSE 5000
CMD ["python", "-B", "app.py"]
